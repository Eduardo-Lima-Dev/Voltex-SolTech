import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Plant, PlantAsset, AssetWarranty } from '@voltex/database';
import {
  DomainEvent,
  TimelineEventType,
  type AssetCategory,
  type CreateAssetInput,
  type ListPlantsQuery,
  type PlantAssetDto,
  type PlantDetailDto,
  type PlantEventDto,
  type PlantSummaryDto,
  type ReplaceAssetInput,
  type UpdateAssetInput,
  type UpdatePlantInput,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../../common/pagination';
import { AuditService } from '../../../platform/audit/audit.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { TimelineService } from '../../crm/support/timeline.service';
import { InstallationsService } from '../installations.service';
import { siteLabelOf } from '../operations.mapper';
import { dateOnly, daysLeft, isoDay } from './dates';
import { MaintenanceService, toPlanDto } from './maintenance.service';
import { OmContractsService, toContractDto } from './om-contracts.service';
import { TicketsService } from './tickets.service';
import { WarrantiesService, toWarrantyDto } from './warranties.service';

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];

/** Categorias de material que viram ativo com garantia (cabo e outros ficam de fora). */
const ASSET_CATEGORIES_FROM_MATERIALS: readonly string[] = [
  'MODULE',
  'INVERTER',
  'BATTERY',
  'PROTECTION',
];

const toAssetDto = (asset: PlantAsset, warranties: AssetWarranty[]): PlantAssetDto => ({
  id: asset.id,
  equipmentId: asset.equipmentId,
  category: asset.category as AssetCategory,
  manufacturer: asset.manufacturer,
  model: asset.model,
  quantity: asset.quantity,
  serials: Array.isArray(asset.serials) ? (asset.serials as string[]) : [],
  installedAt: isoDay(asset.installedAt),
  status: asset.status,
  notes: asset.notes,
  warranties: warranties.map((w) => toWarrantyDto(w)),
  warrantyMissing: asset.status === 'ACTIVE' && warranties.length === 0,
});

/**
 * Planta instalada (ADR-0023): nasce do aceite do cliente, com os ativos da lista de materiais recebida, as garantias
 * pelos termos dos fabricantes e a geração esperada do projeto técnico. Mantém o histórico (trocas, seriais, notas).
 */
@Injectable()
export class PlantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly timeline: TimelineService,
    private readonly installations: InstallationsService,
    private readonly warranties: WarrantiesService,
    private readonly tickets: TicketsService,
    private readonly maintenance: MaintenanceService,
    private readonly contracts: OmContractsService,
  ) {}

  // --- ativação ---------------------------------------------------------------------------------------------

  /** Cria a planta da instalação aceita. Idempotente: se já existe, devolve a mesma. */
  async activateFromInstallation(installationId: string): Promise<Plant> {
    const existing = await this.prisma.db.plant.findFirst({ where: { installationId } });
    if (existing) return existing;
    const inst = await this.installations.require(installationId);
    if (!inst.acceptedAt)
      throw new UnprocessableEntityException('A planta só nasce depois do aceite do cliente.');
    const db = this.prisma.db;
    const [account, site, materials, snapshot] = await Promise.all([
      db.account.findFirst({ where: { id: inst.accountId }, select: { name: true } }),
      inst.siteId
        ? db.site.findFirst({ where: { id: inst.siteId }, select: { name: true } })
        : null,
      db.materialItem.findMany({
        where: {
          installationId,
          status: { in: ['RECEIVED', 'SEPARATED'] },
          category: { in: [...ASSET_CATEGORIES_FROM_MATERIALS] },
        },
        orderBy: { createdAt: 'asc' },
      }),
      inst.engineeringSnapshotId
        ? db.engineeringSnapshot.findFirst({
            where: { id: inst.engineeringSnapshotId },
            select: { content: true },
          })
        : null,
    ]);
    const equipmentIds = [
      ...new Set(materials.map((m) => m.equipmentId).filter((x): x is string => !!x)),
    ];
    const equipment = equipmentIds.length
      ? await db.equipmentItem.findMany({
          where: { id: { in: equipmentIds } },
          select: { id: true, manufacturer: true, model: true },
        })
      : [];

    const results = (snapshot?.content as { version?: { results?: unknown } } | null)?.version
      ?.results as
      | {
          totals?: { powerKwp?: number | null };
          simulation?: { monthlyKwh?: number[]; energyKwh?: number | null };
        }
      | undefined;
    const monthly = Array.isArray(results?.simulation?.monthlyKwh)
      ? results!.simulation!.monthlyKwh!
      : [];
    const installedAt = inst.installedAt ?? inst.acceptedAt;
    const tenantId = this.context.requireTenantId();

    const plant = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.plant.create({
        data: {
          tenantId,
          installationId,
          projectId: inst.projectId,
          opportunityId: inst.opportunityId,
          projectCode: inst.projectCode,
          accountId: inst.accountId,
          siteId: inst.siteId,
          name: `${account?.name ?? 'Cliente'}${site ? ` — ${site.name}` : ''}`,
          powerKwp: results?.totals?.powerKwp ?? null,
          expectedMonthlyKwh: monthly.length === 12 ? monthly : [],
          expectedAnnualKwh:
            results?.simulation?.energyKwh ??
            (monthly.length === 12 ? monthly.reduce((a, b) => a + b, 0) : null),
          expectedSource: monthly.length === 12 ? 'ENGINEERING_SNAPSHOT' : null,
          engineeringSnapshotId: inst.engineeringSnapshotId,
          activatedAt: inst.acceptedAt!,
        },
      });
      for (const m of materials) {
        const item = m.equipmentId ? equipment.find((e) => e.id === m.equipmentId) : undefined;
        const asset = await tx.plantAsset.create({
          data: {
            tenantId,
            plantId: created.id,
            equipmentId: m.equipmentId,
            category: m.category,
            manufacturer: item?.manufacturer ?? 'Não informado',
            model: item?.model ?? m.description,
            quantity: Math.max(1, Math.round(m.quantity)),
            installedAt: dateOnly(installedAt),
          },
        });
        await this.warranties.coverAsset(asset, tx);
      }
      await this.addEvent(
        tx,
        created.id,
        'ACTIVATED',
        `Planta ativada com o aceite do cliente (${materials.length} ativo(s) listado(s)).`,
      );
      await this.events.publish(
        {
          type: DomainEvent.PLANT_ACTIVATED,
          projectCode: inst.projectCode,
          payload: {
            plantId: created.id,
            installationId,
            projectId: inst.projectId,
            opportunityId: inst.opportunityId,
          },
        },
        tx,
      );
      await this.timeline.record(
        {
          opportunityId: inst.opportunityId,
          type: TimelineEventType.PLANT_ACTIVATED,
          summary: 'Planta ativada: pós-venda e garantias abertos',
          data: { plantId: created.id },
          actorId: null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'plant.activated',
          entity: 'Plant',
          entityId: created.id,
          after: { projectCode: inst.projectCode, assets: materials.length },
        },
        tx,
      );
      return created;
    });
    return plant;
  }

  /** Cria a planta de instalações aceitas antes da fase (ou cujo evento se perdeu). */
  async reconcile(): Promise<{ created: number }> {
    const accepted = await this.prisma.db.installation.findMany({
      where: { acceptedAt: { not: null }, status: 'DONE' },
      select: { id: true },
    });
    const have = new Set(
      (await this.prisma.db.plant.findMany({ select: { installationId: true } })).map(
        (p) => p.installationId,
      ),
    );
    let created = 0;
    for (const i of accepted)
      if (!have.has(i.id)) {
        await this.activateFromInstallation(i.id);
        created += 1;
      }
    return { created };
  }

  // --- leitura ----------------------------------------------------------------------------------------------

  private async summarize(rows: Plant[]): Promise<PlantSummaryDto[]> {
    if (rows.length === 0) return [];
    const db = this.prisma.db;
    const ids = rows.map((r) => r.id);
    const [accounts, sites, open, assets] = await Promise.all([
      db.account.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } },
        select: { id: true, name: true },
      }),
      db.site.findMany({
        where: { id: { in: rows.map((r) => r.siteId).filter((x): x is string => !!x) } },
        select: { id: true, name: true, city: true, state: true },
      }),
      db.ticket.groupBy({
        by: ['plantId'],
        where: {
          plantId: { in: ids },
          status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] },
        },
        _count: { _all: true },
      }),
      db.plantAsset.findMany({
        where: { plantId: { in: ids }, status: 'ACTIVE' },
        select: { plantId: true, _count: { select: { warranties: true } } },
      }),
    ]);
    return rows.map((p) => ({
      id: p.id,
      installationId: p.installationId,
      projectId: p.projectId,
      projectCode: p.projectCode,
      accountId: p.accountId,
      accountName: accounts.find((a) => a.id === p.accountId)?.name ?? '—',
      siteLabel: siteLabelOf(sites.find((s) => s.id === p.siteId)),
      name: p.name,
      status: p.status,
      powerKwp: p.powerKwp,
      expectedAnnualKwh: p.expectedAnnualKwh,
      activatedAt: p.activatedAt.toISOString(),
      openTickets: open.find((o) => o.plantId === p.id)?._count._all ?? 0,
      assetsWithoutWarranty: assets.filter((a) => a.plantId === p.id && a._count.warranties === 0)
        .length,
    }));
  }

  async list(query: ListPlantsQuery) {
    const db = this.prisma.db;
    let accountIds: string[] | undefined;
    if (query.search) {
      accountIds = (
        await db.account.findMany({
          where: { name: { contains: query.search, mode: 'insensitive' } },
          select: { id: true },
          take: 200,
        })
      ).map((a) => a.id);
    }
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { projectCode: { contains: query.search, mode: 'insensitive' as const } },
              { accountId: { in: accountIds ?? [] } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.plant.findMany({ where, orderBy: { activatedAt: 'desc' }, ...toSkipTake(query) }),
      db.plant.count({ where }),
    ]);
    return toPaginated(await this.summarize(rows), total, query);
  }

  async require(id: string): Promise<Plant> {
    const plant = await this.prisma.db.plant.findFirst({ where: { id } });
    if (!plant) throw new NotFoundException('Planta não encontrada');
    return plant;
  }

  async get(id: string): Promise<PlantDetailDto> {
    const plant = await this.require(id);
    const db = this.prisma.db;
    const [summary] = await this.summarize([plant]);
    const [assets, events, plans, contracts, tickets] = await Promise.all([
      db.plantAsset.findMany({
        where: { plantId: id },
        include: { warranties: { orderBy: { endsOn: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.plantEvent.findMany({ where: { plantId: id }, orderBy: { createdAt: 'desc' }, take: 60 }),
      db.maintenancePlan.findMany({ where: { plantId: id }, orderBy: { nextDueAt: 'asc' } }),
      db.omContract.findMany({ where: { plantId: id }, orderBy: { endsOn: 'desc' } }),
      this.tickets.listForPlant(id),
    ]);
    return {
      ...summary!,
      opportunityId: plant.opportunityId,
      notes: plant.notes,
      expectedMonthlyKwh: Array.isArray(plant.expectedMonthlyKwh)
        ? (plant.expectedMonthlyKwh as number[])
        : [],
      expectedSource: plant.expectedSource,
      assets: assets.map((a) => toAssetDto(a, a.warranties)),
      events: events.map((e): PlantEventDto => ({
        id: e.id,
        type: e.type,
        text: e.text,
        actorId: e.actorId,
        createdAt: e.createdAt.toISOString(),
      })),
      plans: plans.map(toPlanDto),
      contracts: contracts.map((c) => toContractDto(c, plant.name)),
      tickets,
    };
  }

  async addEvent(
    tx: Tx | PrismaService['db'],
    plantId: string,
    type: string,
    text: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await tx.plantEvent.create({
      data: {
        tenantId: this.context.requireTenantId(),
        plantId,
        type,
        text,
        data: data as object,
        actorId: this.context.userId ?? null,
      },
    });
  }

  // --- edição -----------------------------------------------------------------------------------------------

  async update(id: string, input: UpdatePlantInput): Promise<PlantDetailDto> {
    const plant = await this.require(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.plant.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      if (input.status && input.status !== plant.status)
        await this.addEvent(
          tx,
          id,
          'STATUS',
          input.status === 'ACTIVE' ? 'Planta reativada.' : 'Planta desativada.',
        );
      await this.audit.record(
        {
          action: 'plant.updated',
          entity: 'Plant',
          entityId: id,
          before: { name: plant.name, status: plant.status },
          after: input,
        },
        tx,
      );
    });
    return this.get(id);
  }

  private async requireAsset(id: string): Promise<PlantAsset> {
    const asset = await this.prisma.db.plantAsset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundException('Ativo não encontrado');
    return asset;
  }

  private assertSerials(serials: string[] | undefined, quantity: number): void {
    if (serials && serials.length > quantity)
      throw new UnprocessableEntityException({
        code: 'TOO_MANY_SERIALS',
        message: `Há ${serials.length} números de série para ${quantity} unidade(s).`,
      });
    if (serials && new Set(serials.map((s) => s.toLowerCase())).size !== serials.length)
      throw new UnprocessableEntityException({
        code: 'DUPLICATE_SERIALS',
        message: 'Há números de série repetidos.',
      });
  }

  async addAsset(plantId: string, input: CreateAssetInput): Promise<PlantDetailDto> {
    const plant = await this.require(plantId);
    const quantity = input.quantity ?? 1;
    this.assertSerials(input.serials, quantity);
    await this.prisma.db.$transaction(async (tx) => {
      const asset = await tx.plantAsset.create({
        data: {
          tenantId: plant.tenantId,
          plantId,
          equipmentId: input.equipmentId ?? null,
          category: input.category,
          manufacturer: input.manufacturer,
          model: input.model,
          quantity,
          serials: (input.serials ?? []) as string[],
          installedAt: dateOnly(input.installedAt ?? new Date()),
          notes: input.notes ?? null,
        },
      });
      await this.warranties.coverAsset(asset, tx);
      await this.addEvent(
        tx,
        plantId,
        'ASSET_ADDED',
        `Ativo acrescentado: ${input.manufacturer} ${input.model} (${quantity}).`,
      );
      await this.audit.record(
        {
          action: 'plant_asset.added',
          entity: 'PlantAsset',
          entityId: asset.id,
          after: { manufacturer: input.manufacturer, model: input.model },
        },
        tx,
      );
    });
    return this.get(plantId);
  }

  async updateAsset(id: string, input: UpdateAssetInput): Promise<PlantDetailDto> {
    const asset = await this.requireAsset(id);
    if (asset.status === 'REPLACED')
      throw new UnprocessableEntityException(
        'Ativo substituído é histórico e não pode ser editado.',
      );
    const quantity = input.quantity ?? asset.quantity;
    const serials =
      input.serials ?? (Array.isArray(asset.serials) ? (asset.serials as string[]) : []);
    this.assertSerials(serials, quantity);
    await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.plantAsset.update({
        where: { id },
        data: {
          ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
          ...(input.serials !== undefined ? { serials: input.serials } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      if (input.serials !== undefined)
        await this.addEvent(
          tx,
          asset.plantId,
          'SERIALS',
          `Números de série de ${next.model}: ${input.serials.length} de ${next.quantity} informados.`,
        );
      if (input.status === 'REMOVED')
        await this.addEvent(
          tx,
          asset.plantId,
          'ASSET_REMOVED',
          `Ativo retirado: ${next.manufacturer} ${next.model}.`,
        );
      // Corrigir o fabricante pode finalmente casar com o termo cadastrado.
      if (input.manufacturer !== undefined && next.status === 'ACTIVE')
        await this.warranties.coverAsset(next, tx);
      await this.audit.record(
        { action: 'plant_asset.updated', entity: 'PlantAsset', entityId: id, after: input },
        tx,
      );
    });
    return this.get(asset.plantId);
  }

  /** Troca de equipamento: o antigo fica como "substituído" (com o motivo) e o novo recebe as garantias do termo. */
  async replaceAsset(id: string, input: ReplaceAssetInput): Promise<PlantDetailDto> {
    const old = await this.requireAsset(id);
    if (old.status !== 'ACTIVE')
      throw new UnprocessableEntityException('Só um ativo em uso pode ser substituído.');
    const quantity = input.quantity ?? old.quantity;
    const serials = input.serials ?? [];
    this.assertSerials(serials, quantity);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.plantAsset.update({
        where: { id },
        data: { status: 'REPLACED', notes: `Substituído: ${input.reason}` },
      });
      const created = await tx.plantAsset.create({
        data: {
          tenantId: old.tenantId,
          plantId: old.plantId,
          equipmentId: input.equipmentId === undefined ? old.equipmentId : input.equipmentId,
          category: old.category,
          manufacturer: input.manufacturer ?? old.manufacturer,
          model: input.model ?? old.model,
          quantity,
          serials,
          installedAt: dateOnly(new Date()),
        },
      });
      await this.warranties.coverAsset(created, tx);
      await this.addEvent(
        tx,
        old.plantId,
        'ASSET_REPLACED',
        `${old.manufacturer} ${old.model} substituído por ${created.manufacturer} ${created.model}: ${input.reason}`,
        { oldAssetId: old.id, newAssetId: created.id },
      );
      await this.audit.record(
        {
          action: 'plant_asset.replaced',
          entity: 'PlantAsset',
          entityId: id,
          after: { newAssetId: created.id, reason: input.reason },
        },
        tx,
      );
    });
    return this.get(old.plantId);
  }

  /** Dias restantes e demais valores derivados usados pelo painel. */
  static daysToEnd = daysLeft;
}
