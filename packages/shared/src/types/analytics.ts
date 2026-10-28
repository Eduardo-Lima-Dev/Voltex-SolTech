import type {
  AnalyticsMinSamples,
  BestClientCriterion,
  FunnelGroupBy,
} from '../schemas/analytics.js';

/**
 * Resultados da camada analítica (Fase 12C). Os nomes dos campos seguem a convenção que o assistente usa para
 * reconhecer o tipo do valor: `...Cents` é dinheiro, `...Pct` são pontos percentuais (24,5), `...Rate` é fração
 * (0,25), `...Count` é contagem e `...Days` é dias. Quando a amostra não basta, o valor vem `null`, nunca um chute.
 */

export interface AnalyticsMeta {
  queriedAt: string;
  from: string | null;
  to: string | null;
}

/** Aviso padronizado de amostra pequena demais para a análise. */
export interface InsufficientSample {
  code: 'INSUFFICIENT_SAMPLE';
  sampleCount: number;
  minimumCount: number;
  message: string;
}

export interface LeadsOverviewDto {
  meta: AnalyticsMeta;
  totalCount: number;
  bySource: { group: string; label: string; count: number }[];
  bySegment: { group: string; label: string; count: number }[];
  byState: { group: string; label: string; count: number }[];
  byStatus: { group: string; label: string; count: number }[];
  /** Leads novos sem primeiro contato dentro do prazo (SLA). */
  slaBreachedCount: number;
  convertedCount: number;
  /** Fração de leads que viraram oportunidade. Nula se houver poucos leads. */
  conversionRate: number | null;
  conversionNote: InsufficientSample | null;
}

export interface FunnelGroupRow {
  group: string;
  label: string;
  /** Leads criados no período. Nulo quando o agrupamento não existe para leads. */
  leadsCount: number | null;
  opportunitiesCount: number;
  proposalsSentCount: number;
  proposalsAcceptedCount: number;
  wonCount: number;
  lostCount: number;
  closedCount: number;
  /** Ganhas ÷ encerradas. Nula se o grupo tem poucas encerradas (`smallSample`). */
  winRate: number | null;
  wonValueCents: number;
  averageTicketCents: number | null;
  averageCycleDays: number | null;
  smallSample: boolean;
}

export interface FunnelByGroupDto {
  meta: AnalyticsMeta;
  groupBy: FunnelGroupBy;
  groupSizeMinimum: number;
  rows: FunnelGroupRow[];
  /** Grupos com poucos registros, que ficam fora da comparação. */
  smallGroupsCount: number;
  overall: FunnelGroupRow;
  /** Preenchido quando não há encerradas suficientes para a taxa de conversão geral. */
  conversionNote: InsufficientSample | null;
}

export interface SalesCycleDto {
  meta: AnalyticsMeta;
  signedCount: number;
  averageDays: number | null;
  medianDays: number | null;
  note: InsufficientSample | null;
}

export interface LossReasonsDto {
  meta: AnalyticsMeta;
  lostCount: number;
  reasons: { reason: string; count: number; shareRate: number }[];
  withoutReasonCount: number;
}

export interface StalledOpportunityRow {
  projectCode: string;
  title: string;
  stage: string;
  stageLabel: string;
  daysInStageDays: number;
  withoutOpenTask: boolean;
  ownerId: string | null;
  ownerName: string | null;
}

export interface StalledOpportunitiesDto {
  meta: AnalyticsMeta;
  stalledAfterDays: number;
  openCount: number;
  stalledCount: number;
  withoutOpenTaskCount: number;
  noMovementCount: number;
  rows: StalledOpportunityRow[];
}

export interface TasksOverviewDto {
  meta: AnalyticsMeta;
  openCount: number;
  overdueCount: number;
  byAssignee: {
    userId: string | null;
    name: string | null;
    openCount: number;
    overdueCount: number;
  }[];
}

/** Métricas de uma conta (cliente) somando todos os projetos dela. Finanças só vêm para quem pode ver finanças. */
export interface ClientMetricsRow {
  accountId: string;
  accountName: string;
  segment: string | null;
  state: string | null;
  projectsCount: number;
  contractedCents: number;
  /** Campos financeiros: nulos se o perfil não tem acesso ao financeiro. */
  receivedCents: number | null;
  costsCents: number | null;
  commissionsCents: number | null;
  marginRealCents: number | null;
  /** Margem real ÷ recebido, em pontos percentuais. Nula se nada foi recebido. */
  marginRealPct: number | null;
  overdueCents: number | null;
  overdueCount: number | null;
  maxOverdueDays: number | null;
  plantsCount: number;
  ticketsCount: number;
  openTicketsCount: number;
  omContractsActiveCount: number;
  saleCycleDays: number | null;
}

export interface ClientsRankingDto {
  meta: AnalyticsMeta;
  sortBy: string;
  /** Clientes com projeto considerados. */
  clientsCount: number;
  rows: ClientMetricsRow[];
  financeIncluded: boolean;
  note: string | null;
}

export interface PotentialExplanation {
  attribute: 'segment' | 'state' | 'source' | 'billBand';
  attributeLabel: string;
  value: string;
  valueLabel: string;
  /** Quantas vezes esse valor é mais comum entre os melhores do que entre todos os clientes. */
  liftRate: number;
  /** Parte dos melhores clientes com esse valor. */
  bestShareRate: number;
  allShareRate: number;
}

export interface PotentialCandidate {
  kind: 'LEAD' | 'ACCOUNT';
  id: string;
  name: string;
  /** Média de "quantas vezes mais comum" dos atributos conhecidos. Acima de 1 = parece com os melhores. */
  scoreRate: number;
  usedAttributesCount: number;
  explanations: PotentialExplanation[];
}

export interface PotentialClientsDto {
  meta: AnalyticsMeta;
  criterion: BestClientCriterion;
  bestShareRate: number;
  clientsCount: number;
  bestCount: number;
  candidates: PotentialCandidate[];
  /** Aviso fixo: isto é semelhança com os melhores clientes, não chance de fechar. */
  disclaimer: string;
}

export type AnalyticsResult<T> =
  | { status: 'OK'; data: T }
  | { status: 'INSUFFICIENT_SAMPLE'; meta: AnalyticsMeta; insufficient: InsufficientSample };

export interface AnalyticsSettingsDto {
  minSamples: AnalyticsMinSamples;
  bestClientShare: number;
  bestClientCriterion: BestClientCriterion;
  stalledDays: number;
  /** Os valores acima são os padrões da plataforma (a empresa não ajustou). */
  usingDefaults: boolean;
}
