import {
  annualConsumption,
  averageMonthlyConsumption,
  compensableConsumption,
} from './consumption.js';
import { confidenceScore } from './confidence.js';
import {
  cashFlowPaybackYears,
  investmentCents,
  projectCashFlow,
  simplePaybackYears,
} from './financial.js';
import { annualGeneration, compensationRatio, monthlyGeneration } from './generation.js';
import { weightedAverageHsp } from './resource.js';
import { estimatedAreaM2, installedPowerKwp, moduleCount, requiredPowerKwp } from './sizing.js';
import { evaluateTrafficLight } from './traffic-light.js';
import {
  ALGORITHM_VERSION,
  quickCalculationInputSchema,
  type ParsedQuickCalculationInput,
  type QuickCalculationInput,
  type QuickCalculationResult,
} from './types.js';
import { roundTo } from '../units/index.js';

/** Executa o cálculo rápido sobre uma entrada já validada. */
export const calculateQuick = (input: ParsedQuickCalculationInput): QuickCalculationResult => {
  const averageKwh = averageMonthlyConsumption(input.consumptionMonthlyKwh);
  const compensableKwh = compensableConsumption(averageKwh, input.availabilityCostKwh);
  const averageHsp = weightedAverageHsp(input.hspMonthly);

  const neededKwp = requiredPowerKwp(compensableKwh, averageHsp, input.performanceRatio);
  const modules = moduleCount(neededKwp, input.modulePowerWp);
  const installedKwp = installedPowerKwp(modules, input.modulePowerWp);
  const areaM2 = estimatedAreaM2(modules, input.moduleAreaM2);

  const monthly = monthlyGeneration(installedKwp, input.hspMonthly, input.performanceRatio);
  const annualKwh = annualGeneration(monthly);

  const investment = investmentCents({
    installedKwp,
    costPerWpCents: input.costPerWpCents,
    systemCostCents: input.systemCostCents,
  });
  const cashFlow = projectCashFlow({
    annualGenerationKwh: annualKwh,
    compensableMonthlyKwh: compensableKwh,
    tariffCentsPerKwh: input.tariffCentsPerKwh,
    tariffEscalationRate: input.tariffEscalationRate,
    moduleDegradationRate: input.moduleDegradationRate,
    investmentCents: investment,
    horizonYears: input.horizonYears,
  });
  const firstYearSavings = cashFlow[0]?.savingsCents ?? 0;
  const accumulatedSavings = cashFlow.reduce((acc, row) => acc + row.savingsCents, 0);
  const simplePayback = simplePaybackYears(investment, firstYearSavings);
  const cashFlowPayback = cashFlowPaybackYears(investment, cashFlow);

  const light = evaluateTrafficLight({
    input,
    averageHsp,
    compensableMonthlyKwh: compensableKwh,
    estimatedAreaM2: areaM2,
    averageMonthlyConsumptionKwh: averageKwh,
    annualGenerationKwh: annualKwh,
    hasPaybackInHorizon: cashFlowPayback !== null,
  });

  return {
    algorithmVersion: ALGORITHM_VERSION,
    averageMonthlyConsumptionKwh: roundTo(averageKwh, 2),
    compensableMonthlyKwh: roundTo(compensableKwh, 2),
    annualConsumptionKwh: roundTo(annualConsumption(averageKwh), 2),
    averageHsp: roundTo(averageHsp, 3),
    requiredPowerKwp: roundTo(neededKwp, 3),
    moduleCount: modules,
    installedPowerKwp: roundTo(installedKwp, 3),
    estimatedAreaM2: roundTo(areaM2, 2),
    monthlyGenerationKwh: monthly.map((v) => roundTo(v, 1)),
    annualGenerationKwh: roundTo(annualKwh, 1),
    compensationRatio: roundTo(compensationRatio(annualKwh, averageKwh), 4),
    investmentCents: investment,
    firstYearSavingsCents: firstYearSavings,
    accumulatedSavingsCents: accumulatedSavings,
    simplePaybackYears: simplePayback === null ? null : roundTo(simplePayback, 2),
    cashFlowPaybackYears: cashFlowPayback === null ? null : roundTo(cashFlowPayback, 2),
    cashFlow,
    trafficLight: light.light,
    alerts: light.alerts,
    requiresEngineering: light.requiresEngineering,
    confidenceScore: confidenceScore(input, light.alerts),
  };
};

/** Valida a entrada (lança `ZodError` se inválida) e executa o cálculo rápido. */
export const runQuickCalculation = (rawInput: QuickCalculationInput): QuickCalculationResult =>
  calculateQuick(quickCalculationInputSchema.parse(rawInput));
