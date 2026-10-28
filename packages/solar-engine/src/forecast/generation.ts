import { dayMs, insufficient, isoDay, type Forecast } from './common.js';

export interface DailyReading {
  /** `YYYY-MM-DD` */
  date: string;
  kwh: number;
}

export interface GenerationForecast {
  /** Geração real dividida pela esperada nos dias com leitura da janela (1 = igual ao esperado). */
  performanceRatio: number;
  windowDays: number;
  monthExpectedKwh: number;
  monthToDateKwh: number;
  /** Real até a última leitura + dias restantes ao ritmo esperado × índice de desempenho. */
  monthProjectedKwh: number;
  lastReadingOn: string;
}

const daysInMonth = (y: number, m0: number): number =>
  new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/**
 * Geração: o esperado do projeto aprovado (12 meses, kWh) × o desempenho real recente da própria planta. O esperado
 * diário é o do mês dividido pelos dias do mês. Não há alerta aqui: o limite de desvio é regra da empresa
 * (`ops.monitoring`), tratada pelo monitoramento.
 */
export function forecastGeneration(input: {
  expectedMonthlyKwh: readonly number[];
  readings: readonly DailyReading[];
  today: string;
  windowDays?: number;
  minDays: number;
}): Forecast<GenerationForecast> {
  const windowDays = input.windowDays ?? 30;
  const today = dayMs(input.today);
  const from = today - (windowDays - 1) * 86_400_000;
  const recent = input.readings.filter((r) => {
    const t = dayMs(r.date);
    return t >= from && t <= today;
  });
  const distinct = new Set(recent.map((r) => r.date));
  if (distinct.size < input.minDays) return insufficient(distinct.size, input.minDays);
  if (input.expectedMonthlyKwh.length !== 12 || input.expectedMonthlyKwh.every((v) => !(v > 0)))
    return insufficient(0, 1);

  const expectedDaily = (ms: number): number => {
    const d = new Date(ms);
    const month = d.getUTCMonth();
    return (input.expectedMonthlyKwh[month] ?? 0) / daysInMonth(d.getUTCFullYear(), month);
  };
  const actual = recent.reduce((sum, r) => sum + r.kwh, 0);
  const expected = recent.reduce((sum, r) => sum + expectedDaily(dayMs(r.date)), 0);
  if (expected <= 0) return insufficient(distinct.size, input.minDays);
  const ratio = actual / expected;

  const last = recent.reduce((a, r) => (r.date > a ? r.date : a), recent[0]!.date);
  const lastMs = dayMs(last);
  const lastDate = new Date(lastMs);
  const y = lastDate.getUTCFullYear();
  const m = lastDate.getUTCMonth();
  const monthToDate = input.readings
    .filter((r) => r.date.slice(0, 7) === last.slice(0, 7) && r.date <= last)
    .reduce((sum, r) => sum + r.kwh, 0);
  const remainingDays = daysInMonth(y, m) - lastDate.getUTCDate();
  const monthExpected = input.expectedMonthlyKwh[m] ?? 0;
  const dailyExpected = monthExpected / daysInMonth(y, m);

  return {
    status: 'OK',
    sample: distinct.size,
    required: input.minDays,
    performanceRatio: ratio,
    windowDays,
    monthExpectedKwh: monthExpected,
    monthToDateKwh: monthToDate,
    monthProjectedKwh: monthToDate + remainingDays * dailyExpected * ratio,
    lastReadingOn: isoDay(lastMs),
  };
}
