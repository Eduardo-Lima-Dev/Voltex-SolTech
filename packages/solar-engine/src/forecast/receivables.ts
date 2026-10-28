import {
  addDays,
  dayMs,
  daysBetween,
  insufficient,
  isoDay,
  quantile,
  type Forecast,
} from './common.js';

export interface OpenReceivable {
  amountCents: number;
  /** `YYYY-MM-DD` */
  dueOn: string;
}
export interface PaidReceivable {
  dueOn: string;
  paidOn: string;
}

/** Cenários: o mais cedo (P25), o típico (mediana) e o mais tarde (P90) dos atrasos já observados. */
export const RECEIVABLE_QUANTILES = { best: 0.25, expected: 0.5, worst: 0.9 } as const;
type Scenario = keyof typeof RECEIVABLE_QUANTILES;
const SCENARIOS = Object.keys(RECEIVABLE_QUANTILES) as Scenario[];

export interface ReceivableWeek {
  /** Primeiro dia da semana (a primeira começa em `today`). */
  start: string;
  bestCents: number;
  expectedCents: number;
  worstCents: number;
}

export interface ReceivablesForecast {
  horizonDays: number;
  openCents: number;
  weeks: ReceivableWeek[];
  withinHorizon: Record<Scenario, number>;
  /** Cai depois do horizonte no cenário. */
  beyondHorizon: Record<Scenario, number>;
  /** Parcelas mais atrasadas do que qualquer pagamento já visto: sem base para datar. */
  unplacedCents: number;
}

/**
 * Recebimentos dos próximos dias: cada parcela em aberto é datada pela distribuição de atraso (dias entre o
 * vencimento e o pagamento) das parcelas JÁ pagas da própria empresa, condicionada ao atraso que ela já tem hoje.
 * Pagamento antecipado conta como atraso zero.
 */
export function forecastReceivables(input: {
  open: readonly OpenReceivable[];
  paid: readonly PaidReceivable[];
  today: string;
  horizonDays?: number;
  minPaid: number;
}): Forecast<ReceivablesForecast> {
  const { open, paid, minPaid } = input;
  if (paid.length < minPaid) return insufficient(paid.length, minPaid);
  const horizonDays = input.horizonDays ?? 90;
  const today = dayMs(input.today);
  const delays = paid
    .map((p) => Math.max(0, daysBetween(dayMs(p.dueOn), dayMs(p.paidOn))))
    .sort((a, b) => a - b);

  const weekCount = Math.ceil(horizonDays / 7);
  const weeks: ReceivableWeek[] = Array.from({ length: weekCount }, (_, i) => ({
    start: isoDay(addDays(today, i * 7)),
    bestCents: 0,
    expectedCents: 0,
    worstCents: 0,
  }));
  const withinHorizon = { best: 0, expected: 0, worst: 0 };
  const beyondHorizon = { best: 0, expected: 0, worst: 0 };
  let unplaced = 0;
  let openCents = 0;

  for (const parcel of open) {
    openCents += parcel.amountCents;
    const due = dayMs(parcel.dueOn);
    const overdue = Math.max(0, daysBetween(due, today));
    const conditional = delays.filter((d) => d >= overdue);
    if (conditional.length === 0) {
      unplaced += parcel.amountCents;
      continue;
    }
    for (const scenario of SCENARIOS) {
      const date = addDays(due, quantile(conditional, RECEIVABLE_QUANTILES[scenario]));
      const offset = daysBetween(today, date);
      if (offset >= horizonDays) {
        beyondHorizon[scenario] += parcel.amountCents;
        continue;
      }
      const week = weeks[Math.floor(Math.max(0, offset) / 7)];
      if (!week) continue;
      week[`${scenario}Cents`] += parcel.amountCents;
      withinHorizon[scenario] += parcel.amountCents;
    }
  }
  return {
    status: 'OK',
    sample: paid.length,
    required: minPaid,
    horizonDays,
    openCents,
    weeks,
    withinHorizon,
    beyondHorizon,
    unplacedCents: unplaced,
  };
}
