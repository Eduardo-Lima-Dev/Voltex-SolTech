import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ANALYTICS_DEFAULT_MIN_SAMPLES,
  analyticsSettingsSchema,
  type AnalyticsResult,
  type AnalyticsSettings,
  type AnalyticsSettingsDto,
  type AnalyticsSettingsInput,
  type ClientMetricsRow,
  type ClientsQuery,
  type ClientsRankingDto,
  type FunnelByGroupDto,
  type FunnelQuery,
  type LeadsOverviewDto,
  type LossReasonsDto,
  type PotentialClientsDto,
  type PotentialQuery,
  type SalesCycleDto,
  type StalledOpportunitiesDto,
  type TasksOverviewDto,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  billBand,
  clientMetrics,
  funnelByGroup,
  leadsOverview,
  lossReasons,
  meta,
  potentialClients,
  rankClients,
  salesCycle,
  stalledOpportunities,
  tasksOverview,
  type Attributes,
  type ClientInputs,
  type LeadRow,
  type OpportunityRow,
  type PotentialCandidateInput,
  type PotentialClient,
} from './analytics-core';

const DAY = 86_400_000;
const DEFAULT_PERIOD_DAYS = 90;

/**
 * Camada analítica (Fase 12C, RF-PLAT-018). Lê os registros pelo cliente de banco da requisição, então a carteira do
 * vendedor (ADR-0028) vale sozinha: cada pessoa analisa só o que enxerga. As contas ficam em `analytics-core.ts`.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  // ---- Configuração -----------------------------------------------------------------------------------

  async settings(): Promise<AnalyticsSettings & { usingDefaults: boolean }> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    const raw = (tenant.settings as Record<string, unknown> | null)?.analytics;
    const parsed = analyticsSettingsSchema.safeParse(raw ?? {});
    const data = parsed.success ? parsed.data : analyticsSettingsSchema.parse({});
    const minSamples = { ...ANALYTICS_DEFAULT_MIN_SAMPLES } as AnalyticsSettings['minSamples'];
    for (const [k, v] of Object.entries(data.minSamples))
      if (typeof v === 'number') minSamples[k as keyof typeof minSamples] = v;
    return {
      minSamples,
      bestClientShare: data.bestClientShare,
      bestClientCriterion: data.bestClientCriterion,
      stalledDays: data.stalledDays,
      usingDefaults: raw === undefined,
    };
  }

  async settingsDto(): Promise<AnalyticsSettingsDto> {
    return this.settings();
  }

  async updateSettings(input: AnalyticsSettingsInput): Promise<AnalyticsSettingsDto> {
    const tenantId = this.context.requireTenantId();
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const before = settings.analytics;
    const next = analyticsSettingsSchema.parse(input);
    await this.prisma.db.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...settings, analytics: next } as object },
    });
    await this.audit.record({
      action: 'analytics.settings_updated',
      entity: 'Tenant',
      entityId: tenantId,
      before,
      after: next,
    });
    return this.settingsDto();
  }

  // ---- Auxiliares -------------------------------------------------------------------------------------

  private period(query: { from?: Date; to?: Date }, now: Date) {
    const to = query.to ?? now;
    const from = query.from ?? new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY);
    return { from, to };
  }

  private async userNames(
    ids: readonly (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private leadRows(
    rows: {
      id: string;
      source: string;
      segment: string | null;
      state: string | null;
      ownerId: string | null;
      status: string;
      createdAt: Date;
      firstContactAt: Date | null;
      firstContactDueAt: Date | null;
      monthlyBillCents: number | null;
      convertedOpportunityId: string | null;
    }[],
  ): LeadRow[] {
    return rows;
  }

  private oppSelect = {
    id: true,
    projectCode: true,
    title: true,
    stage: true,
    status: true,
    projectType: true,
    ownerId: true,
    accountId: true,
    siteId: true,
    leadId: true,
    lostReason: true,
    createdAt: true,
    stageChangedAt: true,
  } as const;

  // ---- Leads, funil e rotina comercial ----------------------------------------------------------------

  async leads(query: { from?: Date; to?: Date }): Promise<LeadsOverviewDto> {
    const now = new Date();
    const period = this.period(query, now);
    const rows = await this.prisma.db.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: period.from, lte: period.to } },
    });
    return leadsOverview(this.leadRows(rows), now, period, (await this.settings()).minSamples);
  }

  async funnel(query: FunnelQuery): Promise<FunnelByGroupDto> {
    const now = new Date();
    const period = this.period(query, now);
    const db = this.prisma.db;
    const opportunities = (await db.opportunity.findMany({
      where: { deletedAt: null, createdAt: { gte: period.from, lte: period.to } },
      select: this.oppSelect,
    })) as OpportunityRow[];
    const ids = opportunities.map((o) => o.id);
    const [proposals, contracts, leads, accounts, sites, originLeads, settings] = await Promise.all(
      [
        ids.length
          ? db.proposal.findMany({
              where: { opportunityId: { in: ids } },
              select: { opportunityId: true, sentAt: true, acceptedAt: true },
            })
          : [],
        ids.length
          ? db.contract.findMany({
              where: { opportunityId: { in: ids }, status: 'SIGNED', signedAt: { not: null } },
              select: { opportunityId: true, valueCents: true, signedAt: true },
            })
          : [],
        db.lead.findMany({
          where: { deletedAt: null, createdAt: { gte: period.from, lte: period.to } },
        }),
        db.account.findMany({
          where: { id: { in: [...new Set(opportunities.map((o) => o.accountId))] } },
          select: { id: true, segment: true },
        }),
        db.site.findMany({
          where: { id: { in: opportunities.flatMap((o) => (o.siteId ? [o.siteId] : [])) } },
          select: { id: true, state: true },
        }),
        db.lead.findMany({
          where: { id: { in: opportunities.flatMap((o) => (o.leadId ? [o.leadId] : [])) } },
          select: { id: true, source: true },
        }),
        this.settings(),
      ],
    );
    return funnelByGroup(
      query.groupBy,
      {
        opportunities,
        proposals,
        contracts: contracts.flatMap((c) => (c.signedAt ? [{ ...c, signedAt: c.signedAt }] : [])),
        leads: this.leadRows(leads),
        accountSegment: new Map(accounts.map((a) => [a.id, a.segment])),
        siteState: new Map(sites.map((s) => [s.id, s.state])),
        leadSource: new Map(originLeads.map((l) => [l.id, l.source])),
        userNames: await this.userNames(opportunities.map((o) => o.ownerId)),
      },
      now,
      period,
      settings.minSamples,
    );
  }

  async salesCycle(query: { from?: Date; to?: Date }): Promise<SalesCycleDto> {
    const now = new Date();
    const period = this.period(query, now);
    const contracts = await this.prisma.db.contract.findMany({
      where: { status: 'SIGNED', signedAt: { gte: period.from, lte: period.to } },
      select: { opportunityId: true, valueCents: true, signedAt: true },
    });
    const opps = await this.prisma.db.opportunity.findMany({
      where: { id: { in: contracts.map((c) => c.opportunityId) } },
      select: { id: true, createdAt: true },
    });
    return salesCycle(
      opps,
      contracts.flatMap((c) => (c.signedAt ? [{ ...c, signedAt: c.signedAt }] : [])),
      now,
      period,
      (await this.settings()).minSamples,
    );
  }

  async lossReasons(query: { from?: Date; to?: Date }): Promise<LossReasonsDto> {
    const now = new Date();
    const period = this.period(query, now);
    const lost = await this.prisma.db.opportunity.findMany({
      where: {
        deletedAt: null,
        status: 'LOST',
        stageChangedAt: { gte: period.from, lte: period.to },
      },
      select: { lostReason: true },
    });
    return lossReasons(lost, now, period);
  }

  async stalled(limit: number): Promise<StalledOpportunitiesDto> {
    const now = new Date();
    const [open, settings] = await Promise.all([
      this.prisma.db.opportunity.findMany({
        where: { deletedAt: null, status: 'OPEN' },
        select: this.oppSelect,
      }) as Promise<OpportunityRow[]>,
      this.settings(),
    ]);
    const tasks = open.length
      ? await this.prisma.db.task.findMany({
          where: { deletedAt: null, status: 'OPEN', opportunityId: { in: open.map((o) => o.id) } },
          select: { opportunityId: true },
        })
      : [];
    return stalledOpportunities(
      open,
      new Set(tasks.flatMap((t) => (t.opportunityId ? [t.opportunityId] : []))),
      await this.userNames(open.map((o) => o.ownerId)),
      now,
      settings.stalledDays,
      limit,
    );
  }

  async tasks(): Promise<TasksOverviewDto> {
    const now = new Date();
    const rows = await this.prisma.db.task.findMany({
      where: { deletedAt: null, status: 'OPEN' },
      select: { assigneeId: true, status: true, dueAt: true },
    });
    return tasksOverview(rows, await this.userNames(rows.map((r) => r.assigneeId)), now);
  }

  // ---- Clientes -----------------------------------------------------------------------------------------

  private async loadClients(accountId?: string): Promise<{
    inputs: ClientInputs;
    origin: Map<string, { source: string | null; monthlyBillCents: number | null }>;
  }> {
    const db = this.prisma.db;
    const projects = await db.project.findMany({
      where: accountId ? { accountId } : {},
      select: { id: true, accountId: true, opportunityId: true, valueCents: true },
    });
    const accountIds = [...new Set(projects.map((p) => p.accountId))];
    const projectIds = projects.map((p) => p.id);
    const oppIds = projects.map((p) => p.opportunityId);
    const [accounts, sites, receivables, costs, commissions, plants, omContracts, opps, contracts] =
      await Promise.all([
        db.account.findMany({
          where: { id: { in: accountIds }, deletedAt: null },
          select: { id: true, name: true, segment: true },
        }),
        db.site.findMany({
          where: { accountId: { in: accountIds }, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { accountId: true, state: true },
        }),
        db.receivable.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, amountCents: true, status: true, dueAt: true },
        }),
        db.projectCostEntry.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, actualCents: true },
        }),
        db.commission.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, amountCents: true },
        }),
        db.plant.findMany({
          where: { accountId: { in: accountIds } },
          select: { id: true, accountId: true },
        }),
        db.omContract.findMany({
          where: { accountId: { in: accountIds } },
          select: { accountId: true, status: true, endsOn: true },
        }),
        db.opportunity.findMany({
          where: { id: { in: oppIds } },
          select: { id: true, accountId: true, leadId: true, createdAt: true },
        }),
        db.contract.findMany({
          where: { opportunityId: { in: oppIds }, status: 'SIGNED', signedAt: { not: null } },
          select: { opportunityId: true, signedAt: true },
        }),
      ]);
    const tickets = plants.length
      ? await db.ticket.findMany({
          where: { plantId: { in: plants.map((p) => p.id) } },
          select: { plantId: true, status: true, resolvedAt: true },
        })
      : [];
    const plantAccount = new Map(plants.map((p) => [p.id, p.accountId]));
    const created = new Map(opps.map((o) => [o.id, o.createdAt]));
    const saleCycleDays = new Map<string, number>();
    for (const c of contracts) {
      const start = created.get(c.opportunityId);
      if (start && c.signedAt && !saleCycleDays.has(c.opportunityId))
        saleCycleDays.set(
          c.opportunityId,
          Math.max(0, (c.signedAt.getTime() - start.getTime()) / DAY),
        );
    }
    const leadIds = opps.flatMap((o) => (o.leadId ? [o.leadId] : []));
    const leads = leadIds.length
      ? await db.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, source: true, monthlyBillCents: true },
        })
      : [];
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const origin = new Map<string, { source: string | null; monthlyBillCents: number | null }>();
    for (const o of opps) {
      const lead = o.leadId ? leadById.get(o.leadId) : undefined;
      if (lead && !origin.has(o.accountId))
        origin.set(o.accountId, { source: lead.source, monthlyBillCents: lead.monthlyBillCents });
    }
    const accountState = new Map<string, string | null>();
    for (const s of sites)
      if (!accountState.has(s.accountId)) accountState.set(s.accountId, s.state);
    return {
      inputs: {
        accounts,
        accountState,
        projects,
        receivables,
        costs,
        commissions,
        plants,
        tickets: tickets.flatMap((t) => {
          const accountOfPlant = plantAccount.get(t.plantId);
          return accountOfPlant
            ? [{ accountId: accountOfPlant, status: t.status, resolvedAt: t.resolvedAt }]
            : [];
        }),
        omContracts,
        saleCycleDays,
        origin,
      },
      origin,
    };
  }

  async clients(query: ClientsQuery, includeFinance: boolean): Promise<ClientsRankingDto> {
    const now = new Date();
    const { inputs } = await this.loadClients();
    const all = clientMetrics(inputs, now, includeFinance);
    const rows = rankClients(all, query.sortBy, query.order, query.limit);
    const financeSort = ['margin', 'received', 'overdue'].includes(query.sortBy);
    return {
      meta: meta(now, null, null),
      sortBy: query.sortBy,
      clientsCount: all.length,
      rows,
      financeIncluded: includeFinance,
      note:
        !includeFinance && financeSort
          ? 'O seu perfil não tem acesso aos dados financeiros: não dá para ordenar por esse critério.'
          : null,
    };
  }

  async client(accountId: string, includeFinance: boolean): Promise<ClientMetricsRow> {
    const exists = await this.prisma.db.account.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Conta não encontrada');
    const { inputs } = await this.loadClients(accountId);
    const row = clientMetrics(inputs, new Date(), includeFinance)[0];
    if (!row) throw new NotFoundException('Esta conta ainda não tem projeto para analisar');
    return row;
  }

  /** Semelhança com os melhores clientes. Exige financeiro (a margem decide quem é "melhor"). */
  async potential(
    query: PotentialQuery,
    canSeeLeads: boolean,
  ): Promise<AnalyticsResult<PotentialClientsDto>> {
    const now = new Date();
    const [{ inputs, origin }, settings] = await Promise.all([this.loadClients(), this.settings()]);
    const rows = clientMetrics(inputs, now, true);
    const clients: PotentialClient[] = rows.map((r) => {
      const o = origin.get(r.accountId);
      return {
        accountId: r.accountId,
        attrs: {
          segment: r.segment,
          state: r.state,
          source: o?.source ?? null,
          billBand: billBand(o?.monthlyBillCents),
        },
        marginRealCents: r.marginRealCents ?? 0,
        receivedCents: r.receivedCents ?? 0,
        projectsCount: r.projectsCount,
        omContractsActiveCount: r.omContractsActiveCount,
      };
    });

    const db = this.prisma.db;
    const clientIds = new Set(rows.map((r) => r.accountId));
    const candidates: PotentialCandidateInput[] = [];
    if (canSeeLeads) {
      const leads = await db.lead.findMany({
        where: { deletedAt: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } },
        take: 500,
        orderBy: { createdAt: 'desc' },
      });
      for (const l of leads)
        candidates.push({
          kind: 'LEAD',
          id: l.id,
          name: l.name,
          attrs: {
            segment: l.segment,
            state: l.state,
            source: l.source,
            billBand: billBand(l.monthlyBillCents),
          } satisfies Attributes,
        });
    }
    const pipeline = await db.opportunity.findMany({
      where: { deletedAt: null, status: 'OPEN' },
      select: { accountId: true, leadId: true, siteId: true },
      take: 500,
    });
    const accountIds = [...new Set(pipeline.map((o) => o.accountId))].filter(
      (id) => !clientIds.has(id),
    );
    if (accountIds.length) {
      const [accounts, sites, leads] = await Promise.all([
        db.account.findMany({ where: { id: { in: accountIds }, deletedAt: null } }),
        db.site.findMany({
          where: { accountId: { in: accountIds }, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
        db.lead.findMany({
          where: { id: { in: pipeline.flatMap((o) => (o.leadId ? [o.leadId] : [])) } },
          select: { id: true, source: true, monthlyBillCents: true },
        }),
      ]);
      const leadById = new Map(leads.map((l) => [l.id, l]));
      const stateOf = new Map<string, string | null>();
      for (const s of sites) if (!stateOf.has(s.accountId)) stateOf.set(s.accountId, s.state);
      for (const a of accounts) {
        const opp = pipeline.find((o) => o.accountId === a.id);
        const lead = opp?.leadId ? leadById.get(opp.leadId) : undefined;
        candidates.push({
          kind: 'ACCOUNT',
          id: a.id,
          name: a.name,
          attrs: {
            segment: a.segment,
            state: stateOf.get(a.id) ?? null,
            source: lead?.source ?? null,
            billBand: billBand(lead?.monthlyBillCents),
          },
        });
      }
    }

    const out = potentialClients(
      clients,
      candidates,
      settings.bestClientCriterion,
      settings.bestClientShare,
      settings.minSamples,
      now,
      query.limit,
    );
    if (out.status === 'INSUFFICIENT_SAMPLE')
      return {
        status: 'INSUFFICIENT_SAMPLE',
        meta: meta(now, null, null),
        insufficient: out.insufficient,
      };
    return { status: 'OK', data: out.data };
  }
}
