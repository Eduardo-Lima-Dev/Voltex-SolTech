import { Injectable } from '@nestjs/common';
import {
  OpportunityStage,
  TimelineEventType,
  type CommercialDashboardDto,
  type CommercialDashboardQuery,
  type LeadSource,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { PrismaService } from '../../../platform/prisma/prisma.service';

const DAY = 86_400_000;
const FUNNEL: OpportunityStage[] = Object.values(OpportunityStage).filter(
  (s) => s !== OpportunityStage.LOST,
);

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  /** Painel comercial (RF-CRM-100). Tudo calculado dos registros existentes; nada é estimado por estatística. */
  async commercial(query: CommercialDashboardQuery): Promise<CommercialDashboardDto> {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY);
    const inRange = { gte: from, lte: to };
    const db = this.prisma.db;

    const [leads, events, generated, sent, viewed, accepted, signed, open, tenant] =
      await Promise.all([
        db.lead.groupBy({
          by: ['source'],
          where: { createdAt: inRange, deletedAt: null },
          _count: { _all: true },
        }),
        db.timelineEvent.findMany({
          where: {
            type: { in: [TimelineEventType.CREATED, TimelineEventType.STAGE_CHANGED] },
            createdAt: inRange,
          },
          select: { opportunityId: true, type: true, data: true },
        }),
        db.proposal.count({ where: { createdAt: inRange } }),
        db.proposal.count({ where: { sentAt: inRange } }),
        db.proposal.count({ where: { firstViewedAt: inRange } }),
        db.proposal.count({ where: { acceptedAt: inRange } }),
        db.contract.findMany({
          where: { status: 'SIGNED', signedAt: inRange },
          select: { valueCents: true },
        }),
        db.opportunity.findMany({
          where: { status: 'OPEN', deletedAt: null },
          select: { id: true, stage: true, expectedCloseDate: true },
        }),
        this.prisma.system.tenant.findUniqueOrThrow({
          where: { id: this.context.requireTenantId() },
          select: { settings: true },
        }),
      ]);

    // Funil: quantas oportunidades chegaram a cada etapa no período (as criadas contam na etapa inicial).
    const reachedBy = new Map<OpportunityStage, Set<string>>(FUNNEL.map((s) => [s, new Set()]));
    for (const event of events) {
      const data = (event.data ?? {}) as { stage?: string; to?: string };
      const stage = (
        event.type === TimelineEventType.CREATED
          ? (data.stage ?? OpportunityStage.NEW_LEAD)
          : data.to
      ) as OpportunityStage;
      reachedBy.get(stage)?.add(event.opportunityId);
    }
    // Conversão sobre a etapa anterior que teve passagem: etapas opcionais (negociação, financiamento) não zeram a conta.
    let previous: number | null = null;
    const funnel = FUNNEL.map((stage) => {
      const reached = reachedBy.get(stage)?.size ?? 0;
      const conversionFromPrevious =
        previous !== null && previous > 0 && reached > 0 ? Math.min(1, reached / previous) : null;
      if (reached > 0) previous = reached;
      return { stage, reached, conversionFromPrevious };
    });

    // Previsão: pipeline aberto por mês de fechamento esperado (valor = preço da cotação mais recente).
    const ids = open.map((o) => o.id);
    const quotes = ids.length
      ? await db.quote.findMany({
          where: { opportunityId: { in: ids }, deletedAt: null },
          orderBy: { version: 'desc' },
          select: { opportunityId: true, priceCents: true },
        })
      : [];
    const value = new Map<string, number>();
    for (const q of quotes)
      if (!value.has(q.opportunityId)) value.set(q.opportunityId, q.priceCents);

    const weights =
      (tenant.settings as { forecastWeights?: Record<string, number> } | null)?.forecastWeights ??
      null;
    const months = new Map<string, { count: number; totalCents: number }>();
    let openTotal = 0;
    let withoutValue = 0;
    let withoutDate = 0;
    let weighted = 0;
    for (const o of open) {
      const cents = value.get(o.id);
      if (cents === undefined) withoutValue += 1;
      else {
        openTotal += cents;
        weighted += cents * Math.min(1, Math.max(0, weights?.[o.stage] ?? 0));
      }
      if (!o.expectedCloseDate) {
        withoutDate += 1;
        continue;
      }
      const month = o.expectedCloseDate.toISOString().slice(0, 7);
      const entry = months.get(month) ?? { count: 0, totalCents: 0 };
      entry.count += 1;
      entry.totalCents += cents ?? 0;
      months.set(month, entry);
    }

    const wonTotal = signed.reduce((sum, c) => sum + c.valueCents, 0);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      leadsBySource: leads
        .map((l) => ({ source: l.source as LeadSource, count: l._count._all }))
        .sort((a, b) => b.count - a.count),
      totalLeads: leads.reduce((sum, l) => sum + l._count._all, 0),
      funnel,
      proposals: { generated, sent, viewed, accepted },
      won: {
        count: signed.length,
        totalCents: wonTotal,
        averageTicketCents: signed.length ? Math.round(wonTotal / signed.length) : null,
      },
      forecast: {
        openCount: open.length,
        openTotalCents: openTotal,
        withoutValueCount: withoutValue,
        byMonth: [...months.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, v]) => ({ month, ...v })),
        withoutExpectedDateCount: withoutDate,
        weightedTotalCents: weights && Object.keys(weights).length ? Math.round(weighted) : null,
      },
    };
  }
}
