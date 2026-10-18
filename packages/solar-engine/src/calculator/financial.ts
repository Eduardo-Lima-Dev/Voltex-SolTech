import type { YearlyProjection } from './types.js';

export interface InvestmentInput {
  installedKwp: number;
  costPerWpCents?: number | undefined;
  systemCostCents?: number | undefined;
}

/** Investimento em centavos. O custo total informado tem precedência sobre o custo por Wp. */
export const investmentCents = ({
  installedKwp,
  costPerWpCents,
  systemCostCents,
}: InvestmentInput): number => {
  if (systemCostCents !== undefined) return systemCostCents;
  if (costPerWpCents === undefined)
    throw new RangeError('investmentCents: informe custo por Wp ou custo total');
  return Math.round(installedKwp * 1000 * costPerWpCents);
};

export interface CashFlowInput {
  annualGenerationKwh: number;
  compensableMonthlyKwh: number;
  tariffCentsPerKwh: number;
  tariffEscalationRate: number;
  moduleDegradationRate: number;
  investmentCents: number;
  horizonYears: number;
}

/**
 * Projeção anual. No ano n:
 * geração = G × (1 − d)^(n−1); compensado = min(geração/12, consumo a compensar) × 12;
 * economia = compensado × tarifa × (1 + r)^(n−1).
 */
export const projectCashFlow = (input: CashFlowInput): YearlyProjection[] => {
  const projection: YearlyProjection[] = [];
  let cumulative = -input.investmentCents;
  for (let year = 1; year <= input.horizonYears; year++) {
    const generationKwh =
      input.annualGenerationKwh * (1 - input.moduleDegradationRate) ** (year - 1);
    const compensatedKwh = Math.min(generationKwh / 12, input.compensableMonthlyKwh) * 12;
    const tariff = input.tariffCentsPerKwh * (1 + input.tariffEscalationRate) ** (year - 1);
    const savingsCents = Math.round(compensatedKwh * tariff);
    cumulative += savingsCents;
    projection.push({
      year,
      generationKwh,
      compensatedKwh,
      savingsCents,
      cumulativeCents: cumulative,
    });
  }
  return projection;
};

/** Payback simples = investimento / economia do primeiro ano. */
export const simplePaybackYears = (
  investment: number,
  firstYearSavingsCents: number,
): number | null => (firstYearSavingsCents > 0 ? investment / firstYearSavingsCents : null);

/** Payback pelo fluxo acumulado, interpolado linearmente dentro do ano em que vira positivo. */
export const cashFlowPaybackYears = (
  investment: number,
  projection: readonly YearlyProjection[],
): number | null => {
  let previous = -investment;
  for (const row of projection) {
    if (row.cumulativeCents >= 0) {
      return row.savingsCents > 0 ? row.year - 1 + -previous / row.savingsCents : row.year;
    }
    previous = row.cumulativeCents;
  }
  return null;
};
