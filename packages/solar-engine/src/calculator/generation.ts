import { DAYS_IN_MONTH, sum } from '../units/index.js';

/** Geração de cada mês (kWh) = potência × HSP do mês × dias do mês × PR. */
export const monthlyGeneration = (
  installedKwp: number,
  hspMonthly: readonly number[],
  performanceRatio: number,
): number[] => {
  if (hspMonthly.length !== 12)
    throw new RangeError('monthlyGeneration: esperados 12 valores mensais');
  return hspMonthly.map(
    (hsp, i) => installedKwp * hsp * (DAYS_IN_MONTH[i] ?? 0) * performanceRatio,
  );
};

export const annualGeneration = (monthlyKwh: readonly number[]): number => sum(monthlyKwh);

/**
 * Compensação = geração mensal média / consumo mensal médio.
 * Pode passar de 100% quando o sistema fica acima do consumo (arredondamento de módulos).
 */
export const compensationRatio = (
  annualGenerationKwh: number,
  averageMonthlyConsumptionKwh: number,
): number =>
  averageMonthlyConsumptionKwh > 0 ? annualGenerationKwh / 12 / averageMonthlyConsumptionKwh : 0;
