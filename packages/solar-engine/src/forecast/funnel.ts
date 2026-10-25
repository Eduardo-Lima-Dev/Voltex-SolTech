import { addDays, dayMs, insufficient, isoDay, median, wilson, type Forecast } from './common.js';

export interface ClosedOpportunity {
  /** Etapas por onde passou, na ordem em que a empresa as registrou. */
  reached: readonly string[];
  won: boolean;
  /** Dias da criação até ganhar; `null` se perdida. */
  cycleDays: number | null;
}
export interface OpenOpportunity {
  stage: string;
  valueCents: number | null;
  /** `YYYY-MM-DD` */
  expectedCloseDate: string | null;
  createdAt: string;
}

export interface FunnelMonth {
  /** `YYYY-MM` */
  month: string;
  expectedCount: number;
  expectedCents: number;
  worstCents: number;
  bestCents: number;
}

export interface FunnelForecast {
  openCount: number;
  overallWinRate: number;
  months: FunnelMonth[];
  /** Oportunidades abertas sem data esperada e sem ciclo histórico para estimar. */
  undatedCount: number;
  undatedExpectedCents: number;
  withoutValueCount: number;
  /** Etapas em que a taxa veio do geral por falta de histórico próprio. */
  stagesUsingOverallRate: string[];
}

/**
 * Fechamento do funil: valor do pipeline aberto × taxa de ganho histórica da etapa em que cada oportunidade está
 * (entre as encerradas que passaram pela etapa). Etapa com poucas encerradas usa a taxa geral. A faixa vem do
 * intervalo de Wilson de 95%. O mês é o esperado (se informado) ou criação + mediana do ciclo das ganhas.
 */
export function forecastFunnel(input: {
  open: readonly OpenOpportunity[];
  closed: readonly ClosedOpportunity[];
  today: string;
  minClosed: number;
  minStageClosed: number;
}): Forecast<FunnelForecast> {
  const { open, closed } = input;
  if (closed.length < input.minClosed) return insufficient(closed.length, input.minClosed);
  const today = dayMs(input.today);
  const wins = closed.filter((c) => c.won).length;
  const overall = { rate: wins / closed.length, ...wilson(wins, closed.length) };
  const cycles = closed.flatMap((c) => (c.won && c.cycleDays !== null ? [c.cycleDays] : []));
  const typicalCycle = cycles.length > 0 ? median(cycles) : null;

  const stageStats = new Map<string, { rate: number; low: number; high: number } | null>();
  const usingOverall = new Set<string>();
  const statsFor = (stage: string) => {
    if (!stageStats.has(stage)) {
      const reached = closed.filter((c) => c.reached.includes(stage));
      const stageWins = reached.filter((c) => c.won).length;
      stageStats.set(
        stage,
        reached.length >= input.minStageClosed
          ? { rate: stageWins / reached.length, ...wilson(stageWins, reached.length) }
          : null,
      );
    }
    const own = stageStats.get(stage);
    if (own) return own;
    usingOverall.add(stage);
    return overall;
  };

  const months = new Map<string, FunnelMonth>();
  let undatedCount = 0;
  let undatedCents = 0;
  let withoutValue = 0;
  const thisMonth = isoDay(today).slice(0, 7);

  for (const o of open) {
    const s = statsFor(o.stage);
    if (o.valueCents === null) withoutValue += 1;
    const value = o.valueCents ?? 0;
    let month: string | null = null;
    if (o.expectedCloseDate) month = o.expectedCloseDate.slice(0, 7);
    else if (typicalCycle !== null)
      month = isoDay(addDays(dayMs(o.createdAt), Math.round(typicalCycle))).slice(0, 7);
    if (month === null) {
      undatedCount += 1;
      undatedCents += Math.round(value * s.rate);
      continue;
    }
    if (month < thisMonth) month = thisMonth;
    const row = months.get(month) ?? {
      month,
      expectedCount: 0,
      expectedCents: 0,
      worstCents: 0,
      bestCents: 0,
    };
    row.expectedCount += s.rate;
    row.expectedCents += value * s.rate;
    row.worstCents += value * s.low;
    row.bestCents += value * s.high;
    months.set(month, row);
  }

  return {
    status: 'OK',
    sample: closed.length,
    required: input.minClosed,
    openCount: open.length,
    overallWinRate: overall.rate,
    months: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({
        month: m.month,
        expectedCount: Math.round(m.expectedCount * 10) / 10,
        expectedCents: Math.round(m.expectedCents),
        worstCents: Math.round(m.worstCents),
        bestCents: Math.round(m.bestCents),
      })),
    undatedCount,
    undatedExpectedCents: undatedCents,
    withoutValueCount: withoutValue,
    stagesUsingOverallRate: [...usingOverall].sort(),
  };
}
