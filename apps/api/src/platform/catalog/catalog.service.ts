import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  DomainEvent,
  SPEC_SCHEMAS,
  type CreateEquipmentData,
  type EquipmentDetailDto,
  type EquipmentDto,
  type InmetroCheckData,
  type ListEquipmentQuery,
  type Paginated,
  type SpecIssue,
  type UpdateEquipmentInput,
} from '@voltex/shared';
import { hasBlockingIssue, validateSpec } from '@voltex/solar-engine';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { PrismaService, type ScopedPrismaClient } from '../prisma/prisma.service';
import { UpdateProposalsService } from '../data-hub/update-proposals.service';
import { toEquipmentDto, type EquipmentRow } from './equipment.mapper';

type Tx = Pick<ScopedPrismaClient, 'equipmentItem'>;

/** Dias sem conferir o registro INMETRO até a revalidação (semestral). */
export const INMETRO_REVALIDATION_DAYS = 183;

/** Validação de formato (Zod) convertida em 422 com os campos. */
function parseSpec(kind: EquipmentRow['kind'], spec: unknown): Record<string, unknown> {
  try {
    return SPEC_SCHEMAS[kind].parse(spec) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ZodError) throw new ZodValidationException(error);
    throw error;
  }
}

/**
 * Catálogo técnico por empresa (ADR-0017): governança (rascunho → aprovado → aposentado), revisões, conferência
 * física antes de aprovar e registro do INMETRO. Depois de aprovado, a ficha é imutável (gatilho no banco).
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly proposals: UpdateProposalsService,
    private readonly events: EventBus,
  ) {}

  async list(query: ListEquipmentQuery): Promise<Paginated<EquipmentDto>> {
    const where: Prisma.EquipmentItemWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { manufacturer: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.equipmentItem.findMany({
        where,
        orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }, { revision: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.db.equipmentItem.count({ where }),
    ]);
    return toPaginated(rows.map(toEquipmentDto), total, query);
  }

  async require(id: string): Promise<EquipmentRow> {
    const row = await this.prisma.db.equipmentItem.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Equipamento não encontrado');
    return row;
  }

  /** Conferência física + avisos de cadastro (INMETRO) do item. */
  issuesOf(row: EquipmentRow): SpecIssue[] {
    const issues = validateSpec(row.kind, row.spec);
    if ((row.kind === 'MODULE' || row.kind === 'INVERTER') && row.inmetroStatus === 'NOT_VERIFIED')
      issues.push({
        code: 'INMETRO_NOT_VERIFIED',
        severity: 'WARNING',
        field: 'inmetroStatus',
        message: 'O registro no INMETRO ainda não foi conferido na consulta oficial.',
      });
    return issues;
  }

  async get(id: string): Promise<EquipmentDetailDto> {
    const row = await this.require(id);
    const revisions = await this.prisma.db.equipmentItem.findMany({
      where: {
        kind: row.kind,
        manufacturer: row.manufacturer,
        model: row.model,
        NOT: { id },
      },
      orderBy: { revision: 'desc' },
      select: { id: true, revision: true, status: true, approvedAt: true },
    });
    return {
      ...toEquipmentDto(row),
      issues: this.issuesOf(row),
      revisions: revisions.map((r) => ({
        id: r.id,
        revision: r.revision,
        status: r.status,
        approvedAt: r.approvedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Cria um rascunho. Se o fabricante e o modelo já existem: com `asRevision` vira a próxima revisão (importações);
   * sem ele é conflito (cadastro manual: use "Nova revisão").
   */
  async createDraft(
    data: CreateEquipmentData,
    options: { asRevision?: boolean; tx?: Tx } = {},
  ): Promise<EquipmentDto> {
    const client: Tx = options.tx ?? this.prisma.db;
    const last = await client.equipmentItem.findFirst({
      where: { kind: data.kind, manufacturer: data.manufacturer, model: data.model },
      orderBy: { revision: 'desc' },
    });
    if (last && !options.asRevision)
      throw new ConflictException(
        `${data.manufacturer} ${data.model} já está no catálogo: crie uma nova revisão.`,
      );
    if (last?.status === 'DRAFT')
      throw new ConflictException(
        `${data.manufacturer} ${data.model} já tem um rascunho (revisão ${last.revision}): conclua ou exclua antes.`,
      );
    const created = await client.equipmentItem.create({
      data: {
        tenantId: this.context.requireTenantId(),
        kind: data.kind,
        manufacturer: data.manufacturer,
        model: data.model,
        spec: data.spec as Prisma.InputJsonValue,
        origin: data.origin,
        fieldConfidence: data.fieldConfidence as Prisma.InputJsonValue,
        referenceCostCents: data.referenceCostCents ?? null,
        externalRecordId: data.externalRecordId ?? null,
        notes: data.notes ?? null,
        revision: (last?.revision ?? 0) + 1,
        supersedesId: last?.id ?? null,
        createdById: this.context.userId ?? null,
      },
    });
    await this.audit.record(
      {
        action: 'equipment.created',
        entity: 'EquipmentItem',
        entityId: created.id,
        after: {
          kind: created.kind,
          manufacturer: created.manufacturer,
          model: created.model,
          origin: created.origin,
          revision: created.revision,
        },
      },
      options.tx as never,
    );
    return toEquipmentDto(created);
  }

  async create(data: CreateEquipmentData): Promise<EquipmentDto> {
    return this.prisma.db.$transaction((tx) => this.createDraft(data, { tx }));
  }

  async update(id: string, input: UpdateEquipmentInput): Promise<EquipmentDto> {
    const row = await this.require(id);
    if (row.status !== 'DRAFT')
      throw new ConflictException('Só rascunhos podem ser editados; crie uma nova revisão.');
    const spec = input.spec ? parseSpec(row.kind, input.spec) : undefined;
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.equipmentItem.update({
        where: { id },
        data: {
          ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(spec ? { spec: spec as Prisma.InputJsonValue } : {}),
          ...(input.referenceCostCents !== undefined
            ? { referenceCostCents: input.referenceCostCents }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'equipment.updated',
          entity: 'EquipmentItem',
          entityId: id,
          after: { fields: Object.keys(input) },
        },
        tx,
      );
      return result;
    });
    return toEquipmentDto(updated);
  }

  async remove(id: string): Promise<{ id: string }> {
    const row = await this.require(id);
    if (row.status !== 'DRAFT')
      throw new ConflictException('Só rascunhos podem ser excluídos; aposente o item.');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.equipmentItem.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'equipment.deleted',
          entity: 'EquipmentItem',
          entityId: id,
          before: { model: row.model, revision: row.revision },
        },
        tx,
      );
    });
    return { id };
  }

  /**
   * Aprova o rascunho: a conferência física não pode ter erro (aviso não bloqueia), a revisão aprovada anterior do
   * mesmo modelo é aposentada, e a ficha passa a ser imutável.
   */
  async approve(id: string): Promise<EquipmentDetailDto> {
    const row = await this.require(id);
    if (row.status !== 'DRAFT') throw new ConflictException('Só rascunhos podem ser aprovados');
    const issues = this.issuesOf(row);
    if (hasBlockingIssue(issues))
      throw new UnprocessableEntityException({
        message: 'A ficha tem erros que impedem a aprovação',
        code: 'EQUIPMENT_HAS_ERRORS',
        data: { issues: issues.filter((i) => i.severity === 'ERROR') },
      });
    const userId = this.context.userId;
    if (!userId) throw new BadRequestException('Aprovação exige um usuário autenticado');
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      const previous = await tx.equipmentItem.findFirst({
        where: {
          kind: row.kind,
          manufacturer: row.manufacturer,
          model: row.model,
          status: 'APPROVED',
        },
      });
      if (previous)
        await tx.equipmentItem.update({
          where: { id: previous.id },
          data: { status: 'RETIRED', retiredAt: now },
        });
      await tx.equipmentItem.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: now, approvedById: userId },
      });
      await this.audit.record(
        {
          action: 'equipment.approved',
          entity: 'EquipmentItem',
          entityId: id,
          before: previous ? { retiredRevision: previous.revision } : null,
          after: { revision: row.revision, warnings: issues.map((i) => i.code) },
        },
        tx,
      );
      if (previous)
        await this.events.publish(
          {
            type: DomainEvent.EQUIPMENT_REVISION_APPROVED,
            payload: {
              equipmentId: id,
              retiredEquipmentId: previous.id,
              kind: row.kind,
              label: `${row.manufacturer} ${row.model}`,
              revision: row.revision,
            },
          },
          tx,
        );
    });
    return this.get(id);
  }

  async retire(id: string): Promise<EquipmentDto> {
    const row = await this.require(id);
    if (row.status !== 'APPROVED')
      throw new ConflictException('Só itens aprovados podem ser aposentados');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.equipmentItem.update({
        where: { id },
        data: { status: 'RETIRED', retiredAt: new Date() },
      });
      await this.audit.record(
        { action: 'equipment.retired', entity: 'EquipmentItem', entityId: id },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.EQUIPMENT_RETIRED,
          payload: { equipmentId: id, kind: row.kind, label: `${row.manufacturer} ${row.model}` },
        },
        tx,
      );
      return result;
    });
    return toEquipmentDto(updated);
  }

  /** Nova revisão em rascunho, copiando a ficha da revisão indicada (para corrigir um item aprovado). */
  async revise(id: string): Promise<EquipmentDto> {
    const row = await this.require(id);
    if (row.status === 'DRAFT') throw new ConflictException('Este item já é um rascunho: edite-o.');
    return this.prisma.db.$transaction((tx) =>
      this.createDraft(
        {
          kind: row.kind,
          manufacturer: row.manufacturer,
          model: row.model,
          spec: row.spec,
          origin: row.origin,
          fieldConfidence: row.fieldConfidence as never,
          referenceCostCents: row.referenceCostCents ?? undefined,
          notes: row.notes ?? undefined,
        } as unknown as CreateEquipmentData,
        { asRevision: true, tx },
      ),
    );
  }

  async setInmetro(id: string, input: InmetroCheckData): Promise<EquipmentDto> {
    const row = await this.require(id);
    if (row.kind !== 'MODULE' && row.kind !== 'INVERTER')
      throw new BadRequestException('O INMETRO só se aplica a módulos e inversores');
    const checkedAt = input.checkedAt ? new Date(input.checkedAt) : new Date();
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.equipmentItem.update({
        where: { id },
        data: {
          inmetroStatus: input.status,
          inmetroRegistration: input.registration ?? row.inmetroRegistration,
          inmetroCheckedAt: checkedAt,
          inmetroCheckedBy: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'equipment.inmetro_checked',
          entity: 'EquipmentItem',
          entityId: id,
          after: { status: input.status, registration: input.registration ?? null, checkedAt },
        },
        tx,
      );
      return result;
    });
    return toEquipmentDto(updated);
  }

  async attachDatasheet(id: string, documentId: string): Promise<EquipmentDto> {
    await this.require(id);
    const document = await this.prisma.db.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');
    if (document.mimeType !== 'application/pdf')
      throw new BadRequestException('A ficha técnica anexada precisa ser um PDF');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.equipmentItem.update({
        where: { id },
        data: { datasheetDocumentId: documentId },
      });
      await this.audit.record(
        {
          action: 'equipment.datasheet_attached',
          entity: 'EquipmentItem',
          entityId: id,
          after: { documentId },
        },
        tx,
      );
      return result;
    });
    return toEquipmentDto(updated);
  }

  /**
   * Itens aprovados (módulos e inversores) cuja conferência do INMETRO nunca foi feita ou venceu: abre uma proposta
   * de revisão para a empresa do contexto. Uma por item e por vencimento (não duplica).
   */
  async flagInmetroDue(now: Date = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - INMETRO_REVALIDATION_DAYS * 86_400_000);
    const due = await this.prisma.db.equipmentItem.findMany({
      where: {
        status: 'APPROVED',
        kind: { in: ['MODULE', 'INVERTER'] },
        inmetroStatus: { not: 'NOT_APPLICABLE' },
        OR: [{ inmetroCheckedAt: null }, { inmetroCheckedAt: { lt: limit } }],
      },
    });
    let created = 0;
    for (const item of due) {
      const since = item.inmetroCheckedAt ?? item.approvedAt ?? item.createdAt;
      const proposal = await this.proposals.create({
        type: 'CATALOG_ITEM',
        title: `Conferir o registro INMETRO de ${item.manufacturer} ${item.model}`,
        target: { equipmentId: item.id },
        proposed: {
          reason: 'INMETRO_DUE',
          equipmentId: item.id,
          lastCheckedAt: item.inmetroCheckedAt?.toISOString() ?? null,
        },
        origin: { source: 'catalog', collectedAt: now.toISOString() },
        dedupeKey: `inmetro:${item.id}:${since.toISOString().slice(0, 10)}`,
      });
      if (proposal) created += 1;
    }
    return created;
  }
}
