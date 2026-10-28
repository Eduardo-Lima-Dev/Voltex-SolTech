/**
 * Desempenho de uma planta: geração real (monitoramento) contra a esperada do projeto.
 * Funções puras. A esperada vem do projeto técnico aprovado (12 valores mensais, kWh); aqui nada é presumido:
 * sem esperada, a comparação não existe. O limiar de desvio e os dias seguidos são DA EMPRESA (regra `ops.monitoring`).
 * Memorial: docs/06-calculos/desempenho-planta.md.
 */

export interface DailyPoint {
  /** `AAAA-MM-DD`. */
  date: string;
  kwh: number;
}

const DAY = 86_400_000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayMs = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

export function daysInMonth(month: string): number {
  if (!MONTH_RE.test(month)) throw new Error(`Mês inválido: ${month}`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Esperada de um dia: o mês dividido igualmente pelos dias do mês (sem curva intra-mensal). */
export function expectedDailyKwh(expectedMonthKwh: number, month: string): number {
  return expectedMonthKwh / daysInMonth(month);
}

export interface MonthPerformance {
  month: string;
  /** Esperada do mês inteiro; `null` sem projeto aprovado. */
  expectedKwh: number | null;
  /** Esperada até o último dia com leitura (proporcional aos dias do mês). */
  expectedToDateKwh: number | null;
  actualKwh: number;
  daysWithData: number;
  daysInMonth: number;
  lastDataDay: string | null;
  /** Real ÷ esperada até a data (1 = igual). `null` sem esperada ou sem leitura. */
  performanceIndex: number | null;
  /** (real − esperada) ÷ esperada, em %. */
  deviationPct: number | null;
}

/** Soma o mês e compara com a esperada proporcional ao período já coberto por leituras. */
export function monthPerformance(
  month: string,
  expectedMonthKwh: number | null,
  daily: readonly DailyPoint[],
): MonthPerformance {
  const total = daysInMonth(month);
  const inMonth = daily.filter((d) => d.date.startsWith(`${month}-`));
  const actualKwh = inMonth.reduce((sum, d) => sum + d.kwh, 0);
  const lastDataDay =
    inMonth
      .map((d) => d.date)
      .sort()
      .at(-1) ?? null;
  const coveredDays = lastDataDay ? Number(lastDataDay.slice(8, 10)) : 0;
  const expectedToDateKwh =
    expectedMonthKwh !== null && expectedMonthKwh > 0 && coveredDays > 0
      ? (expectedMonthKwh * coveredDays) / total
      : null;
  const index =
    expectedToDateKwh !== null && expectedToDateKwh > 0 ? actualKwh / expectedToDateKwh : null;
  return {
    month,
    expectedKwh: expectedMonthKwh,
    expectedToDateKwh,
    actualKwh,
    daysWithData: inMonth.length,
    daysInMonth: total,
    lastDataDay,
    performanceIndex: index,
    deviationPct: index === null ? null : (index - 1) * 100,
  };
}

export interface DeviationRule {
  /** Desvio mínimo, em %, para o dia contar como abaixo do esperado (ex.: 20 = abaixo de 80% do esperado). */
  thresholdPct: number;
  /** Quantos dias seguidos abaixo do limiar disparam o alerta. */
  consecutiveDays: number;
}

export interface DeviationDay {
  date: string;
  actualKwh: number;
  expectedKwh: number;
  deviationPct: number;
}

export interface DeviationResult {
  alert: boolean;
  /** Dias seguidos abaixo do limiar, contados a partir da leitura mais recente. */
  streak: number;
  days: DeviationDay[];
}

/**
 * Avalia o desvio nos dias mais recentes. Dia sem leitura quebra a sequência (não se presume zero) e dia sem esperada
 * (mês sem valor ou zero) também. `expectedMonthly`: 12 valores (janeiro = índice 0), `null` quando não há.
 */
export function evaluateDeviation(
  daily: readonly DailyPoint[],
  expectedMonthly: readonly (number | null)[],
  rule: DeviationRule,
): DeviationResult {
  const sorted = [...daily]
    .filter((d) => DAY_RE.test(d.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  const days: DeviationDay[] = [];
  let previous: number | null = null;
  for (const point of sorted) {
    const ms = dayMs(point.date);
    if (previous !== null && previous - ms !== DAY) break;
    const monthKey = point.date.slice(0, 7);
    const monthIndex = Number(point.date.slice(5, 7)) - 1;
    const expectedMonth = expectedMonthly[monthIndex] ?? null;
    if (expectedMonth === null || expectedMonth <= 0) break;
    const expectedKwh = expectedDailyKwh(expectedMonth, monthKey);
    const deviationPct = ((point.kwh - expectedKwh) / expectedKwh) * 100;
    if (deviationPct >= -rule.thresholdPct) break;
    days.push({ date: point.date, actualKwh: point.kwh, expectedKwh, deviationPct });
    previous = ms;
  }
  return { alert: days.length >= rule.consecutiveDays, streak: days.length, days };
}
