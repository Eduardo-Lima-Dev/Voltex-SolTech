import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AssetWarranty, ManufacturerWarrantyTerm, PlantAsset } from '@voltex/database';
import type {
  AssetCategory,
  CreateManualWarrantyInput,
  CreateWarrantyTermInput,
  ListWarrantiesQuery,
  WarrantyDto,
  WarrantyRowDto,
  WarrantyTermDto,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { addYears, dateOnly, daysLeft, isoDay } from './dates';

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];

export const toTermDto = (t: ManufacturerWarrantyTerm): WarrantyTermDto => ({
  id: t.id,
  manufacturer: t.manufacturer,
  category: t.category as AssetCategory,
  productYears: t.productYears,
  performanceYears: t.performanceYears,
  performanceEndPct: t.performanceEndPct,
  conditions: t.conditions,
  documentId: t.documentId,
  source: t.source,
  reviewedBy: t.reviewedBy,
  validFrom: isoDay(t.validFrom),
  supersededAt: t.supersededAt?.toISOString() ?? null,
});

export const toWarrantyDto = (w: AssetWarranty, now: Date = new Date()): WarrantyDto => ({
  id: w.id,
  assetId: w.assetId,
  kind: w.kind,
  startsOn: isoDay(w.startsOn),
  endsOn: isoDay(w.endsOn),
  daysLeft: daysLeft(w.endsOn, now),
  performanceEndPct: w.performanceEndPct,
  origin: w.origin,
  termId: w.termId,
  note: w.note,
});

/**
 * Garantias por fabricante. A empresa cadastra o **termo padrão** do fabricante (com o documento e a fonte); o
 * sistema não traz prazo nenhum. Ao ativar a planta (e ao cadastrar um termo novo) cada ativo recebe as garantias do
 * termo vigente; sem termo, o ativo fica "garantia não cadastrada". A ficha técnica aprovada no catálogo (módulo com
 * `powerWarrantyYears`) serve de alternativa, marcada como tal.
 */
@Injectable()
export class WarrantiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  // --- termos -----------------------------------------------------------------------------------------------

  async listTerms(includeSuperseded = false): Promise<WarrantyTermDto[]> {
    const rows = await this.prisma.db.manufacturerWarrantyTerm.findMany({
      where: includeSuperseded ? {} : { supersededAt: null },
      orderBy: [{ manufacturer: 'asc' }, { category: 'asc' }, { validFrom: 'desc' }],
    });
    return rows.map(toTermDto);
  }

  /** Cadastra um termo; o anterior do mesmo fabricante e categoria é aposentado (o histórico fica). */
  async createTerm(
    input: CreateWarrantyTermInput,
    actorId: string | null,
  ): Promise<WarrantyTermDto> {
    const tenantId = this.context.requireTenantId();
    if (input.documentId) {
      const doc = await this.prisma.db.document.findFirst({
        where: { id: input.documentId, deletedAt: null },
        select: { id: true },
      });
      if (!doc) throw new UnprocessableEntityException('O documento do termo não existe.');
    }
    const term = await this.prisma.db.$transaction(async (tx) => {
      await tx.manufacturerWarrantyTerm.updateMany({
        where: {
          manufacturer: { equals: input.manufacturer, mode: 'insensitive' },
          category: input.category,
          supersededAt: null,
        },
        data: { supersededAt: new Date() },
      });
      const created = await tx.manufacturerWarrantyTerm.create({
        data: {
          tenantId,
          manufacturer: input.manufacturer,
          category: input.category,
          productYears: input.productYears ?? null,
          performanceYears: input.performanceYears ?? null,
          performanceEndPct: input.performanceEndPct ?? null,
          conditions: input.conditions ?? null,
          documentId: input.documentId ?? null,
          source: input.source,
          reviewedBy: input.reviewedBy ?? null,
          validFrom: dateOnly(input.validFrom ?? new Date()),
          createdById: actorId,
        },
      });
      await this.audit.record(
        {
          action: 'warranty_term.created',
          entity: 'ManufacturerWarrantyTerm',
          entityId: created.id,
          after: {
            manufacturer: created.manufacturer,
            category: created.category,
            source: created.source,
          },
        },
        tx,
      );
      return created;
    });
    // Ativos que ainda não tinham garantia ganham a do termo novo.
    await this.coverUncovered(input.manufacturer, input.category);
    return toTermDto(term);
  }

  async retireTerm(id: string): Promise<WarrantyTermDto> {
    const term = await this.prisma.db.manufacturerWarrantyTerm.findFirst({ where: { id } });
    if (!term) throw new NotFoundException('Termo não encontrado');
    if (term.supersededAt) return toTermDto(term);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.manufacturerWarrantyTerm.update({
        where: { id },
        data: { supersededAt: new Date() },
      });
      await this.audit.record(
        { action: 'warranty_term.retired', entity: 'ManufacturerWarrantyTerm', entityId: id },
        tx,
      );
      return next;
    });
    return toTermDto(updated);
  }

  // --- cobertura dos ativos ---------------------------------------------------------------------------------

  /** Termo vigente do fabricante e da categoria (sem diferenciar maiúsculas no nome do fabricante). */
  private async activeTerm(manufacturer: string, category: string, tx?: Tx) {
    return (tx ?? this.prisma.db).manufacturerWarrantyTerm.findFirst({
      where: {
        manufacturer: { equals: manufacturer, mode: 'insensitive' },
        category,
        supersededAt: null,
      },
      orderBy: { validFrom: 'desc' },
    });
  }

  /**
   * Cria as garantias que faltam de um ativo: do termo vigente do fabricante ou, na falta dele, da ficha técnica do
   * módulo aprovada no catálogo. Não duplica (uma por tipo). Devolve quantas criou.
   */
  async coverAsset(asset: PlantAsset, tx?: Tx): Promise<number> {
    const db = tx ?? this.prisma.db;
    const existing = await db.assetWarranty.findMany({
      where: { assetId: asset.id },
      select: { kind: true },
    });
    const has = new Set(existing.map((w) => w.kind));
    const term = await this.activeTerm(asset.manufacturer, asset.category, tx);
    const tenantId = this.context.requireTenantId();
    const start = dateOnly(asset.installedAt);
    const rows: {
      tenantId: string;
      assetId: string;
      termId: string | null;
      kind: 'PRODUCT' | 'PERFORMANCE';
      startsOn: Date;
      endsOn: Date;
      performanceEndPct: number | null;
      origin: string;
      note: string | null;
    }[] = [];
    if (term) {
      if (term.productYears && !has.has('PRODUCT'))
        rows.push({
          tenantId,
          assetId: asset.id,
          termId: term.id,
          kind: 'PRODUCT',
          startsOn: start,
          endsOn: addYears(start, term.productYears),
          performanceEndPct: null,
          origin: 'TERM',
          note: null,
        });
      if (term.performanceYears && !has.has('PERFORMANCE'))
        rows.push({
          tenantId,
          assetId: asset.id,
          termId: term.id,
          kind: 'PERFORMANCE',
          startsOn: start,
          endsOn: addYears(start, term.performanceYears),
          performanceEndPct: term.performanceEndPct,
          origin: 'TERM',
          note: null,
        });
    } else if (asset.category === 'MODULE' && asset.equipmentId && !has.has('PERFORMANCE')) {
      const item = await db.equipmentItem.findFirst({
        where: { id: asset.equipmentId, status: 'APPROVED' },
        select: { spec: true },
      });
      const spec = (item?.spec ?? {}) as {
        powerWarrantyYears?: unknown;
        powerWarrantyEndPct?: unknown;
      };
      if (typeof spec.powerWarrantyYears === 'number' && spec.powerWarrantyYears > 0)
        rows.push({
          tenantId,
          assetId: asset.id,
          termId: null,
          kind: 'PERFORMANCE',
          startsOn: start,
          endsOn: addYears(start, spec.powerWarrantyYears),
          performanceEndPct:
            typeof spec.powerWarrantyEndPct === 'number' ? spec.powerWarrantyEndPct : null,
          origin: 'SPEC',
          note: 'Prazo da ficha técnica aprovada no catálogo (cadastre o termo do fabricante para o prazo do produto).',
        });
    }
    if (rows.length > 0) await db.assetWarranty.createMany({ data: rows });
    return rows.length;
  }

  /** Aplica um termo novo aos ativos do fabricante e da categoria que ainda estão sem a garantia correspondente. */
  async coverUncovered(manufacturer: string, category: string): Promise<number> {
    const assets = await this.prisma.db.plantAsset.findMany({
      where: {
        manufacturer: { equals: manufacturer, mode: 'insensitive' },
        category,
        status: 'ACTIVE',
      },
    });
    let created = 0;
    for (const asset of assets) created += await this.coverAsset(asset);
    return created;
  }

  // --- garantias manuais e listagem -------------------------------------------------------------------------

  async addManual(assetId: string, input: CreateManualWarrantyInput): Promise<WarrantyDto> {
    const asset = await this.prisma.db.plantAsset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Ativo não encontrado');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.assetWarranty.create({
        data: {
          tenantId: asset.tenantId,
          assetId,
          kind: input.kind,
          startsOn: dateOnly(input.startsOn),
          endsOn: dateOnly(input.endsOn),
          performanceEndPct: input.performanceEndPct ?? null,
          origin: 'MANUAL',
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'asset_warranty.added',
          entity: 'AssetWarranty',
          entityId: created.id,
          after: { assetId, kind: input.kind },
        },
        tx,
      );
      return created;
    });
    return toWarrantyDto(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    const w = await this.prisma.db.assetWarranty.findFirst({ where: { id } });
    if (!w) throw new NotFoundException('Garantia não encontrada');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.assetWarranty.delete({ where: { id } });
      await this.audit.record(
        { action: 'asset_warranty.removed', entity: 'AssetWarranty', entityId: id },
        tx,
      );
    });
    return { id };
  }

  /** Garantias com a planta e o ativo, para acompanhar vencimentos. */
  async list(query: ListWarrantiesQuery): Promise<WarrantyRowDto[]> {
    const now = new Date();
    const today = dateOnly(now);
    // Filtro de vencimento: o prazo (hoje até hoje + N dias) e o estado (vigente ou vencida) se combinam.
    const endsOn: { gte?: Date; lt?: Date; lte?: Date } = {};
    if (query.status === 'ACTIVE') endsOn.gte = today;
    if (query.status === 'EXPIRED') endsOn.lt = today;
    if (query.expiringInDays) {
      endsOn.gte = today;
      endsOn.lte = new Date(today.getTime() + query.expiringInDays * 86_400_000);
    }
    const rows = await this.prisma.db.assetWarranty.findMany({
      where: {
        ...(Object.keys(endsOn).length > 0 ? { endsOn } : {}),
        asset: { status: 'ACTIVE', ...(query.plantId ? { plantId: query.plantId } : {}) },
      },
      include: { asset: true },
      orderBy: { endsOn: 'asc' },
      take: query.limit,
    });
    const plantIds = [...new Set(rows.map((r) => r.asset.plantId))];
    const plants = plantIds.length
      ? await this.prisma.db.plant.findMany({
          where: { id: { in: plantIds } },
          select: { id: true, name: true, accountId: true },
        })
      : [];
    const accounts = plants.length
      ? await this.prisma.db.account.findMany({
          where: { id: { in: plants.map((p) => p.accountId) } },
          select: { id: true, name: true },
        })
      : [];
    return rows.map((r) => {
      const plant = plants.find((p) => p.id === r.asset.plantId);
      return {
        ...toWarrantyDto(r, now),
        plantId: r.asset.plantId,
        plantName: plant?.name ?? '—',
        accountName: accounts.find((a) => a.id === plant?.accountId)?.name ?? '—',
        assetLabel: `${r.asset.manufacturer} ${r.asset.model} (${r.asset.category})`,
      };
    });
  }
}
