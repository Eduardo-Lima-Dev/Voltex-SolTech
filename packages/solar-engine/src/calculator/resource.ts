import { DAYS_IN_MONTH, DAYS_IN_YEAR, sum } from '../units/index.js';

/** HSP médio anual (kWh/m²/dia), ponderado pelos dias de cada mês. */
export const weightedAverageHsp = (hspMonthly: readonly number[]): number => {
  if (hspMonthly.length !== 12)
    throw new RangeError('weightedAverageHsp: esperados 12 valores mensais');
  return sum(hspMonthly.map((hsp, i) => hsp * (DAYS_IN_MONTH[i] ?? 0))) / DAYS_IN_YEAR;
};
