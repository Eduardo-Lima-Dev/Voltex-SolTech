import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  BUILT_IN_HOMOLOGATION_RULES,
  checklistDeadlineSchema,
  checklistItemRuleSchema,
  type CreateHomologationChecklistData,
  type HomologationChecklistDto,
  type HomologationRules,
} from '@voltex/shared';
import type { HomologationChecklist } from '@voltex/database';
import { z } from 'zod';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';

const itemsSchema = z.array(checklistItemRuleSchema);
const deadlinesSchema = z.array(checklistDeadlineSchema);

/**
 * Regras do checklist de homologação como **dado versionado com fonte**. Vale a versão mais recente da
 * distribuidora; sem ela, a padrão da empresa; sem nenhuma, a base EnergIF 2023 (com ressalvas).
 */
@Injectable()
export class HomologationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async resolve(distributorId: string | null): Promise<HomologationRules> {
    const [forDistributor, tenantDefault] = await Promise.all([
      distributorId
        ? this.prisma.db.homologationChecklist.findFirst({
            where: { distributorId },
            orderBy: { version: 'desc' },
          })
        : null,
      this.prisma.db.homologationChecklist.findFirst({
        where: { distributorId: null },
        orderBy: { version: 'desc' },
      }),
    ]);
    const row = forDistributor ?? tenantDefault;
    return row ? this.toRules(row) : BUILT_IN_HOMOLOGATION_RULES;
  }

  /** Base embutida + todas as versões publicadas (da mais nova para a mais antiga). */
  async list(): Promise<HomologationChecklistDto[]> {
    const rows = await this.prisma.db.homologationChecklist.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
    const ids = [...new Set(rows.map((r) => r.distributorId).filter((id): id is string => !!id))];
    const distributors = ids.length
      ? await this.prisma.db.distributor.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(distributors.map((d) => [d.id, d.name]));
    return [
      ...rows.map((row) => ({
        ...this.toRules(row),
        id: row.id,
        distributorId: row.distributorId,
        distributorName: row.distributorId ? (names.get(row.distributorId) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
      })),
      {
        ...BUILT_IN_HOMOLOGATION_RULES,
        id: null,
        distributorId: null,
        distributorName: null,
        createdAt: null,
      },
    ];
  }

  async publish(data: CreateHomologationChecklistData): Promise<HomologationChecklistDto> {
    let distributorName: string | null = null;
    if (data.distributorId) {
      const distributor = await this.prisma.db.distributor.findFirst({
        where: { id: data.distributorId, deletedAt: null },
        select: { name: true },
      });
      if (!distributor) throw new NotFoundException('Concessionária não encontrada');
      distributorName = distributor.name;
    }
    const codes = data.items.map((i) => i.code);
    const duplicated = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (duplicated.length)
      throw new UnprocessableEntityException(
        `Códigos repetidos no checklist: ${[...new Set(duplicated)].join(', ')}`,
      );
    const kinds = data.deadlines.map((d) => d.code);
    if (new Set(kinds).size !== kinds.length)
      throw new UnprocessableEntityException(
        'Há prazos repetidos: informe cada tipo de prazo uma vez',
      );

    const row = await this.prisma.db.$transaction(async (tx) => {
      const last = await tx.homologationChecklist.findFirst({
        where: { distributorId: data.distributorId ?? null },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.homologationChecklist.create({
        data: {
          tenantId: this.context.requireTenantId(),
          distributorId: data.distributorId ?? null,
          version: (last?.version ?? 0) + 1,
          items: data.items as object,
          deadlines: data.deadlines as object,
          source: data.source,
          notes: data.notes ?? null,
          reviewedBy: data.reviewedBy ?? null,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'homologation_checklist.published',
          entity: 'HomologationChecklist',
          entityId: created.id,
          after: {
            distributorId: created.distributorId,
            version: created.version,
            items: data.items.length,
            source: data.source,
            reviewedBy: data.reviewedBy ?? null,
          },
        },
        tx,
      );
      return created;
    });
    return {
      ...this.toRules(row),
      id: row.id,
      distributorId: row.distributorId,
      distributorName,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRules(row: HomologationChecklist): HomologationRules {
    return {
      ref: row.distributorId
        ? `distribuidora:${row.distributorId}@${row.version}`
        : `empresa@${row.version}`,
      version: row.version,
      scope: row.distributorId ? 'DISTRIBUTOR' : 'TENANT',
      source: row.source,
      reviewedBy: row.reviewedBy,
      notes: row.notes,
      items: itemsSchema.parse(row.items),
      deadlines: deadlinesSchema.parse(row.deadlines),
    };
  }
}
