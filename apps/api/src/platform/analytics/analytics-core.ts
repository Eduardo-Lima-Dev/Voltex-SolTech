import {
  DEFAULT_PIPELINE_STAGES,
  type AnalyticsMinSamples,
  type BestClientCriterion,
  type ClientMetricsRow,
  type FunnelByGroupDto,
  type FunnelGroupBy,
  type FunnelGroupRow,
  type InsufficientSample,
  type LeadsOverviewDto,
  type LossReasonsDto,
  type PotentialCandidate,
  type PotentialExplanation,
  type SalesCycleDto,
  type StalledOpportunitiesDto,
  type StalledOpportunityRow,
  type TasksOverviewDto,
  type AnalyticsMeta,
} from '@voltex/shared';

/**
 * Cálculo puro da camada analítica (Fase 12C). Sem banco, sem relógio escondido: recebe os registros já lidos e a
 * data "agora", e devolve números com a amostra usada. Definições e exemplos: `docs/06-calculos/analitica.md`.
 */

const DAY = 86_400_000;
const WITHOUT = {
  source: 'SEM_ORIGEM',
  segment: 'SEM_SEGMENTO',
  state: 'SEM_UF',
  owner: 'SEM_RESPONSAVEL',
  projectType: 'SEM_TIPO',
} as const;

export const SOURCE_LABELS: Record<string, string> = {
  FORM: 'Formulário',
  LANDING_PAGE: 'Landing page',
  WHATSAPP: 'WhatsApp',
  API: 'Integração com outro sistema',
  REFERRAL: 'Indicação',
  CSV_IMPORT: 'Planilha importada',
  MARKETPLACE: 'Marketplace',
  CAMPAIGN: 'Campanha',
  MANUAL: 'Cadastro manual',
  PARTNER_PORTAL: 'Portal do parceiro',
  [WITHOUT.source]: 'Sem origem registrada',
};
export const SEGMENT_LABELS: Record<string, string> = {
  RESIDENTIAL: 'Residencial',
  RURAL: 'Rural',
  COMMERCIAL: 'Comercial',
  INDUSTRIAL: 'Industrial',
  [WITHOUT.segment]: 'Sem segmento',
};
export const PROJECT_TYPE_LABELS: Record<string, string> = {
  ON_GRID: 'On-grid',
  HYBRID: 'Híbrido',
  OFF_GRID: 'Off-grid',
  [WITHOUT.projectType]: 'Sem tipo',
};
export const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: 'Novo',
  CONTACTED: 'Contatado',
  QUALIFIED: 'Qualificado',
  DISQUALIFIED: 'Desqualificado',
  CONVERTED: 'Convertido',
};
const STAGE_NAMES = new Map<string, string>(DEFAULT_PIPELINE_STAGES.map((s) => [s.key, s.name]));
export const stageName = (stage: string): string => STAGE_NAMES.get(stage) ?? stage;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const days = (from: Date, to: Date): number => Math.max(0, (to.getTime() - from.getTime()) / DAY);

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export const insufficient = (
  what: string,
  sampleCount: number,
  minimumCount: number,
): InsufficientSample => ({
  code: 'INSUFFICIENT_SAMPLE',
  sampleCount,
  minimumCount,
  message: `Há ${sampleCount} registro(s) para ${what}; a análise precisa de pelo menos ${minimumCount}.`,
});

export const meta = (now: Date, from: Date | null, to: Date | null): AnalyticsMeta => ({
  queriedAt: now.toISOString(),
  from: from?.toISOString() ?? null,
  to: to?.toISOString() ?? null,
});

// ---------------------------------------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------------------------------------

export interface LeadRow {
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
}

const countBy = <T>(rows: readonly T[], key: (r: T) => string, label: (k: string) => string) => {
  const map = new Map<string, number>();
  for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
  return [...map.entries()]
    .map(([group, count]) => ({ group, label: label(group), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
};

export function leadsOverview(
  leads: readonly LeadRow[],
  now: Date,
  period: { from: Date | null; to: Date | null },
  min: AnalyticsMinSamples,
): LeadsOverviewDto {
  const converted = leads.filter((l) => l.status === 'CONVERTED').length;
  const slaBreached = leads.filter(
    (l) =>
      l.status === 'NEW' && !l.firstContactAt && l.firstContactDueAt && l.firstContactDueAt < now,
  ).length;
  const enough = leads.length >= min.simpleAverage;
  return {
    meta: meta(now, period.from, period.to),
    totalCount: leads.length,
    bySource: countBy(
      leads,
      (l) => l.source,
      (k) => SOURCE_LABELS[k] ?? k,
    ),
    bySegment: countBy(
      leads,
      (l) => l.segment ?? WITHOUT.segment,
      (k) => SEGMENT_LABELS[k] ?? k,
    ),
    byState: countBy(
      leads,
      (l) => l.state ?? WITHOUT.state,
      (k) => (k === WITHOUT.state ? 'Sem UF' : k),
    ),
    byStatus: countBy(
      leads,
      (l) => l.status,
      (k) => LEAD_STATUS_LABELS[k] ?? k,
    ),
    slaBreachedCount: slaBreached,
    convertedCount: converted,
    conversionRate: enough ? round2(converted / leads.length) : null,
    conversionNote: enough
      ? null
      : insufficient('calcular a conversão de leads', leads.length, min.simpleAverage),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Funil por grupo
// ---------------------------------------------------------------------------------------------------------

export interface OpportunityRow {
  id: string;
  projectCode: string;
  title: string;
  stage: string;
  status: 'OPEN' | 'WON' | 'LOST';
  projectType: string | null;
  ownerId: string | null;
  accountId: string;
  siteId: string | null;
  leadId: string | null;
  lostReason: string | null;
  createdAt: Date;
  stageChangedAt: Date;
}
export interface ProposalFlow {
  opportunityId: string;
  sentAt: Date | null;
  acceptedAt: Date | null;
}
export interface SignedContract {
  opportunityId: string;
  valueCents: number;
  signedAt: Date;
}
export interface FunnelContext {
  opportunities: readonly OpportunityRow[];
  proposals: readonly ProposalFlow[];
  contracts: readonly SignedContract[];
  leads: readonly LeadRow[];
  accountSegment: ReadonlyMap<string, string | null>;
  siteState: ReadonlyMap<string, string | null>;
  leadSource: ReadonlyMap<string, string>;
  userNames: ReadonlyMap<string, string>;
}

const emptyRow = (group: string, label: string, leadsCount: number | null): FunnelGroupRow => ({
  group,
  label,
  leadsCount,
  opportunitiesCount: 0,
  proposalsSentCount: 0,
  proposalsAcceptedCount: 0,
  wonCount: 0,
  lostCount: 0,
  closedCount: 0,
  winRate: null,
  wonValueCents: 0,
  averageTicketCents: null,
  averageCycleDays: null,
  smallSample: true,
});

function oppGroup(by: FunnelGroupBy, o: OpportunityRow, ctx: FunnelContext): string {
  switch (by) {
    case 'source':
      return (o.leadId && ctx.leadSource.get(o.leadId)) || WITHOUT.source;
    case 'segment':
      return ctx.accountSegment.get(o.accountId) ?? WITHOUT.segment;
    case 'state':
      return (o.siteId && ctx.siteState.get(o.siteId)) || WITHOUT.state;
    case 'owner':
      return o.ownerId ?? WITHOUT.owner;
    case 'projectType':
      return o.projectType ?? WITHOUT.projectType;
  }
}
function leadGroup(by: FunnelGroupBy, l: LeadRow): string | null {
  switch (by) {
    case 'source':
      return l.source;
    case 'segment':
      return l.segment ?? WITHOUT.segment;
    case 'state':
      return l.state ?? WITHOUT.state;
    case 'owner':
      return l.ownerId ?? WITHOUT.owner;
    case 'projectType':
      return null;
  }
}
function groupLabel(by: FunnelGroupBy, key: string, ctx: FunnelContext): string {
  switch (by) {
    case 'source':
      return SOURCE_LABELS[key] ?? key;
    case 'segment':
      return SEGMENT_LABELS[key] ?? key;
    case 'state':
      return key === WITHOUT.state ? 'Sem UF' : key;
    case 'owner':
      return key === WITHOUT.owner
        ? 'Sem responsável'
        : (ctx.userNames.get(key) ?? 'Usuário removido');
    case 'projectType':
      return PROJECT_TYPE_LABELS[key] ?? key;
  }
}

function fillRow(
  row: FunnelGroupRow,
  opps: readonly OpportunityRow[],
  ctx: FunnelContext,
  minClosed: number,
): FunnelGroupRow {
  const ids = new Set(opps.map((o) => o.id));
  const sent = new Set<string>();
  const accepted = new Set<string>();
  for (const p of ctx.proposals) {
    if (!ids.has(p.opportunityId)) continue;
    if (p.sentAt) sent.add(p.opportunityId);
    if (p.acceptedAt) accepted.add(p.opportunityId);
  }
  const signed = new Map<string, SignedContract>();
  for (const c of ctx.contracts)
    if (ids.has(c.opportunityId) && !signed.has(c.opportunityId)) signed.set(c.opportunityId, c);
  const byId = new Map(opps.map((o) => [o.id, o]));
  const won = opps.filter((o) => o.status === 'WON').length;
  const lost = opps.filter((o) => o.status === 'LOST').length;
  const closed = won + lost;
  const wonValue = [...signed.values()].reduce((a, c) => a + c.valueCents, 0);
  const cycles = [...signed.values()].map((c) =>
    days(byId.get(c.opportunityId)!.createdAt, c.signedAt),
  );
  const small = closed < minClosed;
  return {
    ...row,
    opportunitiesCount: opps.length,
    proposalsSentCount: sent.size,
    proposalsAcceptedCount: accepted.size,
    wonCount: won,
    lostCount: lost,
    closedCount: closed,
    winRate: small || closed === 0 ? null : round2(won / closed),
    wonValueCents: wonValue,
    averageTicketCents: signed.size ? Math.round(wonValue / signed.size) : null,
    averageCycleDays: cycles.length ? round1(mean(cycles)!) : null,
    smallSample: small,
  };
}

/**
 * Funil por grupo (origem, segmento, UF, vendedor ou tipo de projeto). O grupo é formado pelas oportunidades criadas
 * no período. Taxa de ganho = ganhas ÷ encerradas, e só aparece com encerradas suficientes (`groupSize` no grupo,
 * `funnelClosed` no geral): abaixo disso a taxa vem nula e o grupo entra como "poucos dados".
 */
export function funnelByGroup(
  groupBy: FunnelGroupBy,
  ctx: FunnelContext,
  now: Date,
  period: { from: Date | null; to: Date | null },
  min: AnalyticsMinSamples,
): FunnelByGroupDto {
  const opps = new Map<string, OpportunityRow[]>();
  for (const o of ctx.opportunities) {
    const g = oppGroup(groupBy, o, ctx);
    opps.set(g, [...(opps.get(g) ?? []), o]);
  }
  const leadsBy = new Map<string, number>();
  let leadsTotal: number | null = groupBy === 'projectType' ? null : 0;
  for (const l of ctx.leads) {
    const g = leadGroup(groupBy, l);
    if (g === null) continue;
    leadsBy.set(g, (leadsBy.get(g) ?? 0) + 1);
    leadsTotal = (leadsTotal ?? 0) + 1;
  }
  const keys = new Set([...opps.keys(), ...leadsBy.keys()]);
  const rows = [...keys]
    .map((key) =>
      fillRow(
        emptyRow(
          key,
          groupLabel(groupBy, key, ctx),
          groupBy === 'projectType' ? null : (leadsBy.get(key) ?? 0),
        ),
        opps.get(key) ?? [],
        ctx,
        min.groupSize,
      ),
    )
    .sort(
      (a, b) =>
        b.opportunitiesCount - a.opportunitiesCount || a.label.localeCompare(b.label, 'pt-BR'),
    );

  const overall = fillRow(
    emptyRow('TOTAL', 'Total', leadsTotal),
    ctx.opportunities,
    ctx,
    min.funnelClosed,
  );
  return {
    meta: meta(now, period.from, period.to),
    groupBy,
    groupSizeMinimum: min.groupSize,
    rows,
    smallGroupsCount: rows.filter((r) => r.smallSample && r.closedCount > 0).length,
    overall,
    conversionNote: overall.smallSample
      ? insufficient('a taxa de conversão geral', overall.closedCount, min.funnelClosed)
      : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Ciclo de venda, motivos de perda, oportunidades paradas, tarefas
// ---------------------------------------------------------------------------------------------------------

export function salesCycle(
  opportunities: readonly Pick<OpportunityRow, 'id' | 'createdAt'>[],
  contracts: readonly SignedContract[],
  now: Date,
  period: { from: Date | null; to: Date | null },
  min: AnalyticsMinSamples,
): SalesCycleDto {
  const created = new Map(opportunities.map((o) => [o.id, o.createdAt]));
  const seen = new Set<string>();
  const cycles: number[] = [];
  for (const c of contracts) {
    const start = created.get(c.opportunityId);
    if (!start || seen.has(c.opportunityId)) continue;
    seen.add(c.opportunityId);
    cycles.push(days(start, c.signedAt));
  }
  const enough = cycles.length >= min.simpleAverage;
  return {
    meta: meta(now, period.from, period.to),
    signedCount: cycles.length,
    averageDays: enough ? round1(mean(cycles)!) : null,
    medianDays: enough ? round1(median(cycles)!) : null,
    note: enough
      ? null
      : insufficient('calcular o ciclo de venda', cycles.length, min.simpleAverage),
  };
}

export function lossReasons(
  lost: readonly Pick<OpportunityRow, 'lostReason'>[],
  now: Date,
  period: { from: Date | null; to: Date | null },
): LossReasonsDto {
  const counts = new Map<string, { label: string; count: number }>();
  let none = 0;
  for (const o of lost) {
    const label = o.lostReason?.trim();
    if (!label) {
      none += 1;
      continue;
    }
    const key = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const entry = counts.get(key) ?? { label, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return {
    meta: meta(now, period.from, period.to),
    lostCount: lost.length,
    withoutReasonCount: none,
    reasons: [...counts.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
      .map((e) => ({ reason: e.label, count: e.count, shareRate: round2(e.count / lost.length) })),
  };
}

export function stalledOpportunities(
  open: readonly OpportunityRow[],
  withOpenTask: ReadonlySet<string>,
  userNames: ReadonlyMap<string, string>,
  now: Date,
  stalledDays: number,
  limit: number,
): StalledOpportunitiesDto {
  const rows: StalledOpportunityRow[] = [];
  let withoutTask = 0;
  let noMovement = 0;
  for (const o of open) {
    const inStage = days(o.stageChangedAt, now);
    const noTask = !withOpenTask.has(o.id);
    const idle = inStage >= stalledDays;
    if (noTask) withoutTask += 1;
    if (idle) noMovement += 1;
    if (noTask || idle)
      rows.push({
        projectCode: o.projectCode,
        title: o.title,
        stage: o.stage,
        stageLabel: stageName(o.stage),
        daysInStageDays: Math.floor(inStage),
        withoutOpenTask: noTask,
        ownerId: o.ownerId,
        ownerName: o.ownerId ? (userNames.get(o.ownerId) ?? null) : null,
      });
  }
  rows.sort(
    (a, b) => b.daysInStageDays - a.daysInStageDays || a.projectCode.localeCompare(b.projectCode),
  );
  return {
    meta: meta(now, null, null),
    stalledAfterDays: stalledDays,
    openCount: open.length,
    stalledCount: rows.length,
    withoutOpenTaskCount: withoutTask,
    noMovementCount: noMovement,
    rows: rows.slice(0, limit),
  };
}

export function tasksOverview(
  tasks: readonly { assigneeId: string | null; status: string; dueAt: Date }[],
  userNames: ReadonlyMap<string, string>,
  now: Date,
): TasksOverviewDto {
  const open = tasks.filter((t) => t.status === 'OPEN');
  const per = new Map<string | null, { openCount: number; overdueCount: number }>();
  for (const t of open) {
    const e = per.get(t.assigneeId) ?? { openCount: 0, overdueCount: 0 };
    e.openCount += 1;
    if (t.dueAt < now) e.overdueCount += 1;
    per.set(t.assigneeId, e);
  }
  return {
    meta: meta(now, null, null),
    openCount: open.length,
    overdueCount: open.filter((t) => t.dueAt < now).length,
    byAssignee: [...per.entries()]
      .map(([userId, v]) => ({
        userId,
        name: userId ? (userNames.get(userId) ?? null) : null,
        ...v,
      }))
      .sort((a, b) => b.overdueCount - a.overdueCount || b.openCount - a.openCount),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------------------------------------

export interface ClientInputs {
  accounts: readonly { id: string; name: string; segment: string | null }[];
  accountState: ReadonlyMap<string, string | null>;
  projects: readonly { id: string; accountId: string; opportunityId: string; valueCents: number }[];
  receivables: readonly { projectId: string; amountCents: number; status: string; dueAt: Date }[];
  costs: readonly { projectId: string; actualCents: number }[];
  commissions: readonly { projectId: string | null; amountCents: number }[];
  plants: readonly { accountId: string }[];
  tickets: readonly { accountId: string; resolvedAt: Date | null; status: string }[];
  omContracts: readonly { accountId: string; status: string; endsOn: Date }[];
  /** Quando a oportunidade nasceu e quando o contrato foi assinado, para o tempo de venda. */
  saleCycleDays: ReadonlyMap<string, number>;
  /** Origem e faixa de conta de luz do lead de origem (por conta). */
  origin: ReadonlyMap<string, { source: string | null; monthlyBillCents: number | null }>;
}

/** Métricas por cliente. `includeFinance=false` esconde dinheiro (para quem não pode ver finanças). */
export function clientMetrics(
  input: ClientInputs,
  now: Date,
  includeFinance: boolean,
): ClientMetricsRow[] {
  const projectsOf = new Map<string, (typeof input.projects)[number][]>();
  for (const p of input.projects)
    projectsOf.set(p.accountId, [...(projectsOf.get(p.accountId) ?? []), p]);
  const accountOfProject = new Map(input.projects.map((p) => [p.id, p.accountId]));
  const sumBy = <T>(
    rows: readonly T[],
    key: (r: T) => string | null | undefined,
    val: (r: T) => number,
  ) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const projectId = key(r);
      const accountId = projectId ? accountOfProject.get(projectId) : undefined;
      if (accountId) m.set(accountId, (m.get(accountId) ?? 0) + val(r));
    }
    return m;
  };
  const received = sumBy(
    input.receivables.filter((r) => r.status === 'PAID'),
    (r) => r.projectId,
    (r) => r.amountCents,
  );
  const costs = sumBy(
    input.costs,
    (c) => c.projectId,
    (c) => c.actualCents,
  );
  const commissions = sumBy(
    input.commissions,
    (c) => c.projectId,
    (c) => c.amountCents,
  );
  const lateRows = input.receivables.filter(
    (r) => r.status === 'OVERDUE' || (r.status === 'OPEN' && r.dueAt < now),
  );
  const overdue = sumBy(
    lateRows,
    (r) => r.projectId,
    (r) => r.amountCents,
  );
  const overdueCount = sumBy(
    lateRows,
    (r) => r.projectId,
    () => 1,
  );
  const maxLate = new Map<string, number>();
  for (const r of lateRows) {
    const acc = accountOfProject.get(r.projectId);
    if (acc) maxLate.set(acc, Math.max(maxLate.get(acc) ?? 0, Math.floor(days(r.dueAt, now))));
  }

  return input.accounts
    .filter((a) => projectsOf.has(a.id))
    .map((a): ClientMetricsRow => {
      const projects = projectsOf.get(a.id) ?? [];
      const rec = received.get(a.id) ?? 0;
      const cost = costs.get(a.id) ?? 0;
      const com = commissions.get(a.id) ?? 0;
      const margin = rec - cost - com;
      const tickets = input.tickets.filter((t) => t.accountId === a.id);
      const cycleList = projects.flatMap((p) => {
        const c = input.saleCycleDays.get(p.opportunityId);
        return c === undefined ? [] : [c];
      });
      return {
        accountId: a.id,
        accountName: a.name,
        segment: a.segment,
        state: input.accountState.get(a.id) ?? null,
        projectsCount: projects.length,
        contractedCents: projects.reduce((s, p) => s + p.valueCents, 0),
        receivedCents: includeFinance ? rec : null,
        costsCents: includeFinance ? cost : null,
        commissionsCents: includeFinance ? com : null,
        marginRealCents: includeFinance ? margin : null,
        marginRealPct: includeFinance && rec > 0 ? round1((margin / rec) * 100) : null,
        overdueCents: includeFinance ? (overdue.get(a.id) ?? 0) : null,
        overdueCount: includeFinance ? (overdueCount.get(a.id) ?? 0) : null,
        maxOverdueDays: includeFinance ? (maxLate.get(a.id) ?? 0) : null,
        plantsCount: input.plants.filter((p) => p.accountId === a.id).length,
        ticketsCount: tickets.length,
        openTicketsCount: tickets.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED')
          .length,
        omContractsActiveCount: input.omContracts.filter(
          (c) => c.accountId === a.id && c.status === 'ACTIVE' && c.endsOn >= now,
        ).length,
        saleCycleDays: cycleList.length ? round1(mean(cycleList)!) : null,
      };
    });
}

const SORT_VALUE: Record<string, (r: ClientMetricsRow) => number | null> = {
  margin: (r) => r.marginRealCents,
  received: (r) => r.receivedCents,
  contracted: (r) => r.contractedCents,
  overdue: (r) => r.overdueCents,
  projects: (r) => r.projectsCount,
  tickets: (r) => r.ticketsCount,
};

/** Ordena e corta. Cliente sem o valor (ex.: sem acesso ao financeiro) fica de fora da ordenação. */
export function rankClients(
  rows: readonly ClientMetricsRow[],
  sortBy: string,
  order: 'asc' | 'desc',
  limit: number,
): ClientMetricsRow[] {
  const value = SORT_VALUE[sortBy] ?? SORT_VALUE.margin!;
  const dir = order === 'asc' ? 1 : -1;
  return rows
    .filter((r) => value(r) !== null)
    .sort(
      (a, b) =>
        dir * ((value(a) as number) - (value(b) as number)) ||
        a.accountName.localeCompare(b.accountName, 'pt-BR'),
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------------------------------------
// Clientes com mais potencial (semelhança com os melhores clientes)
// ---------------------------------------------------------------------------------------------------------

export const BILL_BANDS: { key: string; label: string; maxCents: number }[] = [
  { key: 'B0', label: 'conta de luz até R$ 299', maxCents: 30_000 },
  { key: 'B1', label: 'conta de luz de R$ 300 a R$ 999', maxCents: 100_000 },
  { key: 'B2', label: 'conta de luz de R$ 1.000 a R$ 2.999', maxCents: 300_000 },
  { key: 'B3', label: 'conta de luz a partir de R$ 3.000', maxCents: Number.POSITIVE_INFINITY },
];
export const billBand = (cents: number | null | undefined): string | null =>
  cents === null || cents === undefined
    ? null
    : (BILL_BANDS.find((b) => cents < b.maxCents)?.key ?? null);

export interface Attributes {
  segment: string | null;
  state: string | null;
  source: string | null;
  billBand: string | null;
}
export interface PotentialClient {
  accountId: string;
  attrs: Attributes;
  marginRealCents: number;
  receivedCents: number;
  projectsCount: number;
  omContractsActiveCount: number;
}
export interface PotentialCandidateInput {
  kind: 'LEAD' | 'ACCOUNT';
  id: string;
  name: string;
  attrs: Attributes;
}

const ATTRIBUTE_LABELS: Record<keyof Attributes, string> = {
  segment: 'segmento',
  state: 'UF',
  source: 'origem do lead',
  billBand: 'faixa da conta de luz',
};
const valueLabel = (attr: keyof Attributes, value: string): string => {
  if (attr === 'segment') return SEGMENT_LABELS[value] ?? value;
  if (attr === 'source') return SOURCE_LABELS[value] ?? value;
  if (attr === 'billBand') return BILL_BANDS.find((b) => b.key === value)?.label ?? value;
  return value;
};

const criterionScore = (c: PotentialClient, criterion: BestClientCriterion): number => {
  switch (criterion) {
    case 'MARGIN':
      return c.marginRealCents;
    case 'RECEIVED':
      return c.receivedCents;
    case 'PROJECTS':
      return c.projectsCount;
    case 'OM':
      return c.omContractsActiveCount;
  }
};

export const DISCLAIMER_POTENTIAL =
  'Isto mede semelhança com os seus melhores clientes (nos atributos que o sistema conhece). Não é a chance de o cliente fechar negócio.';

/**
 * Semelhança com os melhores clientes, sem caixa-preta (plano da Fase 12, §9.3).
 *  1. Entram os clientes com algo recebido; precisa de `potentialClients` deles (senão, amostra insuficiente).
 *  2. Os melhores são a fatia `bestShare` (padrão 20%) com maior valor do critério (padrão: margem real recebida).
 *  3. Para cada atributo (segmento, UF, origem, faixa de conta de luz) e valor: `lift` = parte dos melhores com esse
 *     valor ÷ parte de todos os clientes com esse valor. Só vale se o valor aparece em pelo menos `groupSize` clientes.
 *  4. Nota do candidato = média dos `lift` dos atributos que ele tem e que valem. Acima de 1: parece com os melhores.
 */
export function potentialClients(
  clients: readonly PotentialClient[],
  candidates: readonly PotentialCandidateInput[],
  criterion: BestClientCriterion,
  bestShare: number,
  min: AnalyticsMinSamples,
  now: Date,
  limit: number,
):
  | {
      status: 'OK';
      data: Omit<import('@voltex/shared').PotentialClientsDto, 'meta'> & { meta: AnalyticsMeta };
    }
  | { status: 'INSUFFICIENT_SAMPLE'; insufficient: InsufficientSample } {
  const eligible = clients.filter((c) => c.receivedCents > 0);
  if (eligible.length < min.potentialClients)
    return {
      status: 'INSUFFICIENT_SAMPLE',
      insufficient: insufficient(
        'clientes com valor recebido',
        eligible.length,
        min.potentialClients,
      ),
    };
  const ranked = [...eligible].sort(
    (a, b) =>
      criterionScore(b, criterion) - criterionScore(a, criterion) ||
      b.receivedCents - a.receivedCents,
  );
  const bestCount = Math.max(1, Math.ceil(eligible.length * bestShare));
  const best = ranked.slice(0, bestCount);

  const attrs = ['segment', 'state', 'source', 'billBand'] as const;
  const lifts = new Map<string, { lift: number; bestShare: number; allShare: number }>();
  for (const attr of attrs) {
    const known = eligible.filter((c) => c.attrs[attr] !== null);
    const knownBest = best.filter((c) => c.attrs[attr] !== null);
    if (known.length === 0 || knownBest.length === 0) continue;
    const values = new Set(known.map((c) => c.attrs[attr] as string));
    for (const v of values) {
      const all = known.filter((c) => c.attrs[attr] === v).length;
      if (all < min.groupSize) continue; // valor raro demais para gerar nota confiável
      const inBest = knownBest.filter((c) => c.attrs[attr] === v).length;
      const allShare = all / known.length;
      const bestShareV = inBest / knownBest.length;
      lifts.set(`${attr}:${v}`, { lift: bestShareV / allShare, bestShare: bestShareV, allShare });
    }
  }

  const scored: PotentialCandidate[] = [];
  for (const cand of candidates) {
    const explanations: PotentialExplanation[] = [];
    for (const attr of attrs) {
      const value = cand.attrs[attr];
      if (value === null) continue;
      const l = lifts.get(`${attr}:${value}`);
      if (!l) continue;
      explanations.push({
        attribute: attr,
        attributeLabel: ATTRIBUTE_LABELS[attr],
        value,
        valueLabel: valueLabel(attr, value),
        liftRate: round2(l.lift),
        bestShareRate: round2(l.bestShare),
        allShareRate: round2(l.allShare),
      });
    }
    if (explanations.length === 0) continue;
    explanations.sort((a, b) => b.liftRate - a.liftRate);
    scored.push({
      kind: cand.kind,
      id: cand.id,
      name: cand.name,
      scoreRate: round2(mean(explanations.map((e) => e.liftRate))!),
      usedAttributesCount: explanations.length,
      explanations,
    });
  }
  scored.sort(
    (a, b) =>
      b.scoreRate - a.scoreRate ||
      b.usedAttributesCount - a.usedAttributesCount ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );

  return {
    status: 'OK',
    data: {
      meta: meta(now, null, null),
      criterion,
      bestShareRate: bestShare,
      clientsCount: eligible.length,
      bestCount,
      candidates: scored.slice(0, limit),
      disclaimer: DISCLAIMER_POTENTIAL,
    },
  };
}
