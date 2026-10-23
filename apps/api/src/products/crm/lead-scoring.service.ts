import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  leadScoringConfigSchema,
  type LeadScoringConfig,
  type LeadScoringConfigInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import type { ScopedPrismaClient } from '../../platform/prisma/prisma.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { nextInRotation, scoreLead, type ScorableLead } from './lead-scoring';

type Db = Pick<ScopedPrismaClient, 'lead' | 'user'>;

const EMPTY: LeadScoringConfig = {
  criteria: [],
  routing: { method: 'NONE', userIds: [], regions: [] },
};

/** Critérios de pontuação e regra de distribuição de leads: ambos definidos pela empresa (`settings.leadScoring`). */
@Injectable()
export class LeadScoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async getConfig(): Promise<LeadScoringConfig> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    const parsed = leadScoringConfigSchema.safeParse(
      (tenant.settings as Record<string, unknown> | null)?.leadScoring,
    );
    return parsed.success ? parsed.data : EMPTY;
  }

  async setConfig(input: LeadScoringConfigInput): Promise<LeadScoringConfig> {
    const config = leadScoringConfigSchema.parse(input);
    const ids = [
      ...new Set([...config.routing.userIds, ...config.routing.regions.flatMap((r) => r.userIds)]),
    ];
    if (ids.length) {
      const active = await this.prisma.db.user.count({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
      });
      if (active !== ids.length)
        throw new UnprocessableEntityException({
          code: 'INVALID_ROUTING_USER',
          message: 'Há responsáveis na distribuição que não existem ou estão inativos.',
        });
    }
    const tenantId = this.context.requireTenantId();
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          settings: {
            ...((tenant.settings as Record<string, unknown> | null) ?? {}),
            leadScoring: config,
          } as object,
        },
      });
      await this.audit.record(
        {
          action: 'lead_scoring.config_saved',
          entity: 'Tenant',
          entityId: tenantId,
          after: { criteria: config.criteria.map((c) => c.key), routing: config.routing.method },
        },
        tx,
      );
    });
    return config;
  }

  /** Campos da pontuação para gravar no lead. */
  scoreFields(config: LeadScoringConfig, lead: ScorableLead) {
    const { score, breakdown } = scoreLead(config, lead);
    return {
      score,
      scoreBreakdown:
        score === null ? Prisma.DbNull : (breakdown as unknown as Prisma.InputJsonValue),
      scoredAt: new Date(),
    };
  }

  /**
   * Responsável sugerido pela regra de distribuição, ou `null` (sem regra, sem região para o estado ou grupo vazio:
   * o lead fica sem responsável, à espera de uma pessoa). `db`: a transação, para enxergar os leads já atribuídos
   * no mesmo lote.
   */
  async pickOwner(
    config: LeadScoringConfig,
    lead: { state: string | null },
    db: Db = this.prisma.db,
  ): Promise<string | null> {
    const { method } = config.routing;
    if (method === 'NONE') return null;
    let candidates: string[];
    if (method === 'REGION') {
      const region = lead.state
        ? config.routing.regions.find((r) => r.states.includes(lead.state!.toUpperCase()))
        : undefined;
      if (!region) return null;
      candidates = region.userIds;
    } else candidates = config.routing.userIds;

    const users = await db.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(candidates.length ? { id: { in: candidates } } : { role: 'SALESPERSON' }),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    // Mantém a ordem cadastrada pela empresa quando há lista; senão, a ordem de criação.
    const pool = candidates.length
      ? candidates.filter((id) => users.some((u) => u.id === id))
      : users.map((u) => u.id);
    if (pool.length === 0) return null;
    const last = await db.lead.groupBy({
      by: ['ownerId'],
      where: { ownerId: { in: pool }, deletedAt: null },
      _max: { createdAt: true },
    });
    return nextInRotation(
      pool,
      new Map(
        last.flatMap((g) => (g.ownerId && g._max.createdAt ? [[g.ownerId, g._max.createdAt]] : [])),
      ),
    );
  }

  /** Pontua de novo os leads em aberto (depois de mudar os critérios). Não troca responsável. */
  async rescoreOpen(): Promise<{ updated: number }> {
    const config = await this.getConfig();
    const leads = await this.prisma.db.lead.findMany({
      where: { deletedAt: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } },
      select: { id: true, source: true, segment: true, state: true, monthlyBillCents: true },
    });
    let updated = 0;
    for (const lead of leads) {
      await this.prisma.db.lead.update({
        where: { id: lead.id },
        data: this.scoreFields(config, lead),
      });
      updated += 1;
    }
    await this.audit.record({
      action: 'lead_scoring.rescored',
      entity: 'Tenant',
      entityId: this.context.requireTenantId(),
      after: { updated },
    });
    return { updated };
  }
}
