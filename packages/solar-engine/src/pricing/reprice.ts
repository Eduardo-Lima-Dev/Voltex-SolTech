import { cashFlowPaybackYears, simplePaybackYears } from '../calculator/financial.js';
import { roundTo } from '../units/index.js';
import type { YearlyProjection } from '../calculator/types.js';

export interface RepricedCashFlow {
  cashFlow: { year: number; savingsCents: number; cumulativeCents: number }[];
  simplePaybackYears: number | null;
  cashFlowPaybackYears: number | null;
  firstYearSavingsCents: number;
  accumulatedSavingsCents: number;
}

/**
 * Refaz o fluxo de caixa de um cálculo com o **preço de venda** da cotação (o cálculo usa a estimativa de custo da
 * pré-viabilidade; a proposta precisa mostrar o retorno sobre o preço que o cliente vai pagar). A economia anual
 * (geração, degradação, tarifa e reajuste) é a mesma do cálculo; só o investimento muda.
 */
export function repriceCashFlow(
  projection: readonly Pick<YearlyProjection, 'year' | 'savingsCents'>[],
  priceCents: number,
): RepricedCashFlow {
  let cumulative = -priceCents;
  const cashFlow = projection.map((row) => {
    cumulative += row.savingsCents;
    return { year: row.year, savingsCents: row.savingsCents, cumulativeCents: cumulative };
  });
  const firstYearSavingsCents = projection[0]?.savingsCents ?? 0;
  const simple = simplePaybackYears(priceCents, firstYearSavingsCents);
  const flow = cashFlowPaybackYears(
    priceCents,
    cashFlow.map((row) => ({ ...row, generationKwh: 0, compensatedKwh: 0 })),
  );
  return {
    cashFlow,
    simplePaybackYears: simple === null ? null : roundTo(simple, 2),
    cashFlowPaybackYears: flow === null ? null : roundTo(flow, 2),
    firstYearSavingsCents,
    accumulatedSavingsCents: projection.reduce((sum, row) => sum + row.savingsCents, 0),
  };
}
