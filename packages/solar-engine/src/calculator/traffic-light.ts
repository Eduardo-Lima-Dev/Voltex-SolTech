import {
  AlertSeverity,
  CustomerGroup,
  GenerationClass,
  ProjectType,
  TrafficLight,
} from '@voltex/shared';
import { azimuthDeviationDegrees, optimalAzimuthDegrees } from './orientation.js';
import type { CalculationAlert, ParsedQuickCalculationInput, TrafficLightResult } from './types.js';

export interface TrafficLightContext {
  input: ParsedQuickCalculationInput;
  averageHsp: number;
  compensableMonthlyKwh: number;
  estimatedAreaM2: number;
  averageMonthlyConsumptionKwh: number;
  annualGenerationKwh: number;
  hasPaybackInHorizon: boolean;
  performanceRatio: number;
  performanceRatioSource: 'INPUT' | 'LOSSES' | 'DEFAULT';
  generationClass: GenerationClass;
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
    ctx.performanceRatio < t.performanceRatioMin ||
    ctx.performanceRatio > t.performanceRatioMax
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

  if (ctx.generationClass === GenerationClass.UTILITY) {
    add(
      'UTILITY_SCALE_OUT_OF_SCOPE',
      AlertSeverity.BLOCKING,
      `Potência acima de ${t.minigenerationMaxKw} kW (usina): fora do escopo do Solar Calculator.`,
    );
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

  if (ctx.generationClass === GenerationClass.MINI) {
    add(
      'MINIGENERATION_CLASS',
      AlertSeverity.WARNING,
      `Potência acima de ${t.microgenerationMaxKw} kW (minigeração): exige análise de engenharia e documentação adicional de acesso.`,
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
  if (ctx.performanceRatioSource === 'DEFAULT') {
    add(
      'DEFAULT_PERFORMANCE_RATIO',
      AlertSeverity.INFO,
      `Performance ratio padrão (${ctx.performanceRatio}) assumido: informe o PR ou as perdas para um resultado mais confiável.`,
    );
  }
  if (
    ctx.averageHsp >= t.hspMin &&
    ctx.averageHsp <= t.hspMax &&
    (ctx.averageHsp < t.typicalHspMin || ctx.averageHsp > t.typicalHspMax)
  ) {
    add(
      'HSP_OUTSIDE_TYPICAL_RANGE',
      AlertSeverity.INFO,
      `HSP médio (${ctx.averageHsp.toFixed(2)}) fora da faixa típica do Brasil (${t.typicalHspMin} a ${t.typicalHspMax}): confira a fonte do dado.`,
    );
  }
  if (input.tiltDegrees !== undefined && input.tiltDegrees < t.minRecommendedTiltDegrees) {
    add(
      'TILT_BELOW_RECOMMENDED',
      AlertSeverity.INFO,
      `Inclinação de ${input.tiltDegrees}° abaixo do recomendado (${t.minRecommendedTiltDegrees}°): risco de acúmulo de poeira.`,
    );
  }
  if (input.roofAzimuthDegrees !== undefined) {
    const deviation = azimuthDeviationDegrees(
      input.roofAzimuthDegrees,
      optimalAzimuthDegrees(input.latitude),
    );
    if (deviation > t.orientationToleranceDegrees) {
      add(
        'ORIENTATION_NOT_OPTIMAL',
        AlertSeverity.INFO,
        `Face dos módulos a ${Math.round(deviation)}° da orientação ideal (Norte geográfico no hemisfério sul): a geração real pode ser menor que a estimada.`,
      );
    }
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
