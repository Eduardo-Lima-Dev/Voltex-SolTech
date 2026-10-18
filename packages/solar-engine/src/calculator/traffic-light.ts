import { AlertSeverity, CustomerGroup, ProjectType, TrafficLight } from '@voltex/shared';
import type { CalculationAlert, ParsedQuickCalculationInput, TrafficLightResult } from './types.js';

export interface TrafficLightContext {
  input: ParsedQuickCalculationInput;
  averageHsp: number;
  compensableMonthlyKwh: number;
  estimatedAreaM2: number;
  averageMonthlyConsumptionKwh: number;
  annualGenerationKwh: number;
  hasPaybackInHorizon: boolean;
}

/**
 * Semáforo de pré-viabilidade (seção 14):
 * qualquer alerta BLOCKING → vermelho; senão qualquer WARNING → amarelo; senão verde.
 * Alertas INFO não alteram a cor.
 */
export const evaluateTrafficLight = (ctx: TrafficLightContext): TrafficLightResult => {
  const { input } = ctx;
  const t = input.thresholds;
  const alerts: CalculationAlert[] = [];
  const add = (code: CalculationAlert['code'], severity: AlertSeverity, message: string) =>
    alerts.push({ code, severity, message });

  // Vermelho
  if (ctx.compensableMonthlyKwh <= 0) {
    add(
      'INCONSISTENT_INPUT',
      AlertSeverity.BLOCKING,
      'O consumo informado não supera o custo de disponibilidade.',
    );
  }
  if (input.availableAreaM2 !== undefined && ctx.estimatedAreaM2 > input.availableAreaM2) {
    add(
      'INSUFFICIENT_AREA',
      AlertSeverity.BLOCKING,
      `Área necessária (${ctx.estimatedAreaM2.toFixed(1)} m²) maior que a disponível (${input.availableAreaM2} m²).`,
    );
  }
  if (
    input.performanceRatio < t.performanceRatioMin ||
    input.performanceRatio > t.performanceRatioMax
  ) {
    add(
      'ASSUMPTION_OUT_OF_RANGE',
      AlertSeverity.BLOCKING,
      'Performance ratio fora da faixa configurada.',
    );
  }
  if (ctx.averageHsp < t.hspMin || ctx.averageHsp > t.hspMax) {
    add('ASSUMPTION_OUT_OF_RANGE', AlertSeverity.BLOCKING, 'HSP médio fora da faixa configurada.');
  }

  // Amarelo
  if (input.missingCriticalData.length > 0) {
    add(
      'MISSING_CRITICAL_DATA',
      AlertSeverity.WARNING,
      `Dados críticos ausentes: ${input.missingCriticalData.join(', ')}.`,
    );
  }
  if (input.customerGroup === CustomerGroup.A) {
    add(
      'GROUP_A_COMPLEX',
      AlertSeverity.WARNING,
      'Grupo A exige análise de demanda e modalidade tarifária.',
    );
  }
  if (input.contractedDemandRelevant) {
    add(
      'CONTRACTED_DEMAND_RELEVANT',
      AlertSeverity.WARNING,
      'Demanda contratada relevante para o dimensionamento.',
    );
  }
  if (input.possibleGridZero) {
    add('POSSIBLE_GRID_ZERO', AlertSeverity.WARNING, 'Possível necessidade de Grid Zero.');
  }
  if (input.shadingRelevant) {
    add('SHADING_RELEVANT', AlertSeverity.WARNING, 'Sombreamento relevante informado.');
  }
  if (input.projectType === ProjectType.HYBRID) {
    add('HYBRID_REQUESTED', AlertSeverity.WARNING, 'Sistema híbrido/BESS solicitado.');
  }
  if (input.projectType === ProjectType.OFF_GRID) {
    add(
      'OFF_GRID_REQUESTED',
      AlertSeverity.WARNING,
      'Sistema off-grid: encaminhar ao Off-Grid Designer.',
    );
  }

  // Informativos
  if (
    ctx.averageMonthlyConsumptionKwh > 0 &&
    ctx.annualGenerationKwh / 12 / ctx.averageMonthlyConsumptionKwh >
      t.maxGenerationToConsumptionRatio
  ) {
    add('OVERSIZED_SYSTEM', AlertSeverity.INFO, 'Geração estimada muito acima do consumo.');
  }
  if (!ctx.hasPaybackInHorizon) {
    add(
      'NO_PAYBACK_IN_HORIZON',
      AlertSeverity.INFO,
      'O investimento não é recuperado dentro do horizonte analisado.',
    );
  }

  const light = alerts.some((a) => a.severity === AlertSeverity.BLOCKING)
    ? TrafficLight.RED
    : alerts.some((a) => a.severity === AlertSeverity.WARNING)
      ? TrafficLight.YELLOW
      : TrafficLight.GREEN;

  return { light, alerts, requiresEngineering: light === TrafficLight.YELLOW };
};
