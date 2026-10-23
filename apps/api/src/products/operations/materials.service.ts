import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { MaterialItem } from '@voltex/database';
import type {
  BomLine,
  CreateMaterialItemInput,
  MaterialItemDto,
  MaterialQuoteDto,
  OrderMaterialItemInput,
  UpdateMaterialItemInput,
} from '@voltex/shared';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { InstallationsService } from './installations.service';
import { toMaterialDto } from './operations.mapper';

/** Lê as linhas da lista de materiais do snapshot aprovado, sem confiar no formato: linha inválida é ignorada. */
export function bomLinesOf(content: unknown): BomLine[] {
  const lines = (content as { version?: { results?: { bom?: { lines?: unknown } } } } | null)
    ?.version?.results?.bom?.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (l): l is BomLine =>
      typeof l === 'object' &&
      l !== null &&
      typeof (l as BomLine).description === 'string' &&
      typeof (l as BomLine).quantity === 'number' &&
      (l as BomLine).quantity > 0 &&
      typeof (l as BomLine).category === 'string' &&
      typeof (l as BomLine).unit === 'string',
  );
}

/** Lista de materiais da instalação: gerada do snapshot técnico aprovado e ajustada à mão, com pedido e recebimento. */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly installations: InstallationsService,
  ) {}

  private async requireItem(id: string): Promise<MaterialItem> {
    const item = await this.prisma.db.materialItem.findFirst({ where: { id } });
    if (!item) throw new NotFoundException('Item de material não encontrado');
    return item;
  }

  async list(installationId: string): Promise<MaterialItemDto[]> {
    await this.installations.require(installationId);
    const rows = await this.prisma.db.materialItem.findMany({
      where: { installationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toMaterialDto);
  }

  /**
   * Gera os itens a partir da lista de materiais do snapshot técnico aprovado. Só gera uma vez por instalação
   * (idempotente); sem snapshot, a lista é montada à mão.
   */
  async generateFromSnapshot(installationId: string): Promise<{ created: number }> {
    const inst = await this.installations.require(installationId);
    if (inst.materialsGeneratedAt) return { created: 0 };
    if (!inst.engineeringSnapshotId)
      throw new UnprocessableEntityException({
        code: 'NO_TECHNICAL_SNAPSHOT',
        message:
          'A cotação do contrato não veio de um projeto técnico aprovado: lance os itens à mão.',
      });
    const snapshot = await this.prisma.db.engineeringSnapshot.findFirst({
      where: { id: inst.engineeringSnapshotId },
      select: { content: true },
    });
    const lines = bomLinesOf(snapshot?.content);
    if (lines.length === 0)
      throw new UnprocessableEntityException({
        code: 'EMPTY_BOM',
        message: 'O projeto técnico aprovado não traz lista de materiais.',
      });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.materialItem.createMany({
        data: lines.map((l) => ({
          tenantId: inst.tenantId,
          installationId,
          category: l.category,
          equipmentId: l.equipmentId,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitCostCents: l.unitCostCents,
          note: l.note,
        })),
      });
      await tx.installation.update({
        where: { id: installationId },
        data: { materialsGeneratedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'installation.materials_generated',
          entity: 'Installation',
          entityId: installationId,
          after: { items: lines.length, snapshotId: inst.engineeringSnapshotId },
        },
        tx,
      );
    });
    return { created: lines.length };
  }

  async add(installationId: string, input: CreateMaterialItemInput): Promise<MaterialItemDto> {
    const inst = await this.installations.require(installationId);
    if (['DONE', 'CANCELLED'].includes(inst.status))
      throw new UnprocessableEntityException('A instalação já foi encerrada.');
    const item = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.materialItem.create({
        data: {
          tenantId: inst.tenantId,
          installationId,
          category: input.category,
          description: input.description,
          quantity: input.quantity,
          unit: input.unit,
          unitCostCents: input.unitCostCents ?? null,
          equipmentId: input.equipmentId ?? null,
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'installation.material_added',
          entity: 'MaterialItem',
          entityId: created.id,
          after: { description: created.description, quantity: created.quantity },
        },
        tx,
      );
      return created;
    });
    await this.installations.syncMaterials(installationId);
    return toMaterialDto(item);
  }

  async update(id: string, input: UpdateMaterialItemInput): Promise<MaterialItemDto> {
    const item = await this.requireItem(id);
    if (item.status === 'CANCELLED' || item.status === 'SEPARATED')
      throw new UnprocessableEntityException('Este item não pode mais ser alterado.');
    const updated = await this.prisma.db.materialItem.update({
      where: { id },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.unitCostCents !== undefined ? { unitCostCents: input.unitCostCents } : {}),
        ...(input.equipmentId !== undefined ? { equipmentId: input.equipmentId } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    return toMaterialDto(updated);
  }

  /** Registra o pedido de compra. O sistema não compra nada: é só o registro do pedido feito pela empresa. */
  async order(id: string, input: OrderMaterialItemInput): Promise<MaterialItemDto> {
    const item = await this.requireItem(id);
    if (item.status !== 'PENDING')
      throw new UnprocessableEntityException('Só um item pendente pode ser pedido.');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.materialItem.update({
        where: { id },
        data: {
          status: 'ORDERED',
          supplier: input.supplier,
          purchaseOrder: input.purchaseOrder ?? null,
          orderedCents: input.orderedCents ?? null,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        },
      });
      await this.audit.record(
        {
          action: 'installation.material_ordered',
          entity: 'MaterialItem',
          entityId: id,
          after: { supplier: input.supplier, purchaseOrder: input.purchaseOrder ?? null },
        },
        tx,
      );
      return next;
    });
    return toMaterialDto(updated);
  }

  async receive(id: string): Promise<MaterialItemDto> {
    const item = await this.requireItem(id);
    // Material que chega sem pedido registrado (retirada no balcão) também pode ser recebido.
    if (!['PENDING', 'ORDERED'].includes(item.status))
      throw new UnprocessableEntityException('Só um item pendente ou pedido pode ser recebido.');
    const updated = await this.prisma.db.materialItem.update({
      where: { id },
      data: { status: 'RECEIVED', receivedAt: new Date() },
    });
    await this.audit.record({
      action: 'installation.material_received',
      entity: 'MaterialItem',
      entityId: id,
    });
    await this.installations.syncMaterials(item.installationId);
    return toMaterialDto(updated);
  }

  async separate(id: string): Promise<MaterialItemDto> {
    const item = await this.requireItem(id);
    if (item.status !== 'RECEIVED')
      throw new UnprocessableEntityException('Só um item recebido pode ser separado.');
    const updated = await this.prisma.db.materialItem.update({
      where: { id },
      data: { status: 'SEPARATED', separatedAt: new Date() },
    });
    await this.audit.record({
      action: 'installation.material_separated',
      entity: 'MaterialItem',
      entityId: id,
    });
    await this.installations.syncMaterials(item.installationId);
    return toMaterialDto(updated);
  }

  async cancel(id: string): Promise<MaterialItemDto> {
    const item = await this.requireItem(id);
    if (item.status === 'CANCELLED')
      throw new UnprocessableEntityException('O item já está cancelado.');
    if (item.status === 'SEPARATED')
      throw new UnprocessableEntityException('Um item separado não pode ser cancelado.');
    const updated = await this.prisma.db.materialItem.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      action: 'installation.material_cancelled',
      entity: 'MaterialItem',
      entityId: id,
    });
    await this.installations.syncMaterials(item.installationId);
    return toMaterialDto(updated);
  }

  /** Comparação de preços (RF-CRM-054): as ofertas vigentes de cada equipamento nas tabelas dos fornecedores. */
  async quotes(installationId: string): Promise<MaterialQuoteDto[]> {
    await this.installations.require(installationId);
    const items = await this.prisma.db.materialItem.findMany({
      where: { installationId, status: { in: ['PENDING', 'ORDERED'] }, equipmentId: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    if (items.length === 0) return [];
    const now = new Date();
    const prices = await this.prisma.db.priceListItem.findMany({
      where: {
        equipmentId: { in: items.map((i) => i.equipmentId!) },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { priceCents: 'asc' },
    });
    return items.map((item) => {
      // Uma oferta por fornecedor: a mais recente vigente.
      const bySupplier = new Map<string, (typeof prices)[number]>();
      for (const p of prices.filter((x) => x.equipmentId === item.equipmentId)) {
        const current = bySupplier.get(p.supplier);
        if (!current || p.validFrom > current.validFrom) bySupplier.set(p.supplier, p);
      }
      const offers = [...bySupplier.values()].sort((a, b) => a.priceCents - b.priceCents);
      return {
        materialItemId: item.id,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        plannedUnitCostCents: item.unitCostCents,
        offers: offers.map((p, index) => ({
          priceListItemId: p.id,
          supplier: p.supplier,
          sku: p.sku,
          unitPriceCents: p.priceCents,
          totalCents: Math.round(p.priceCents * item.quantity),
          validTo: p.validTo?.toISOString() ?? null,
          best: index === 0,
        })),
      };
    });
  }
}
