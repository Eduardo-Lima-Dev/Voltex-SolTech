import { mean } from '../units/index.js';

/** Consumo médio mensal (kWh/mês) a partir de 1 a 12 meses. */
export const averageMonthlyConsumption = (monthlyKwh: readonly number[]): number =>
  mean(monthlyKwh);

/**
 * Consumo a compensar (kWh/mês): consumo médio menos o custo de disponibilidade.
 * O custo de disponibilidade é parâmetro da regra vigente (mono/bi/trifásico), nunca constante.
 */
export const compensableConsumption = (averageKwh: number, availabilityCostKwh: number): number =>
  Math.max(averageKwh - availabilityCostKwh, 0);

export const annualConsumption = (averageKwh: number): number => averageKwh * 12;
