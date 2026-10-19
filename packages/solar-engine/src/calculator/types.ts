import { z } from 'zod';
import {
  CustomerGroup,
  ProjectType,
  thresholdsSchema,
  type AlertSeverity,
  type GenerationClass,
  type Thresholds,
  type TrafficLight,
} from '@voltex/shared';

export const ALGORITHM_VERSION = 'calc-1.1.0';

export const hspSourceSchema = z.enum(['DATASET', 'MANUAL']);

// Os limites (`thresholds`) são definidos em @voltex/shared: API, Web e motor usam o mesmo schema.
export { thresholdsSchema };
export type { Thresholds };

export const quickCalculationInputSchema = z
  .object({
    /** De 1 a 12 meses de consumo, em kWh/mês. */
    consumptionMonthlyKwh: z.array(z.number().min(0)).min(1).max(12),
    /** Custo de disponibilidade (kWh/mês). Vem da regra vigente conforme mono/bi/trifásico. */
    availabilityCostKwh: z.number().min(0),
    /** HSP (kWh/m²/dia) de janeiro a dezembro. Para entrada manual, repita o mesmo valor. */
    hspMonthly: z.array(z.number().positive()).length(12),
    hspSource: hspSourceSchema.default('DATASET'),
    /** PR informado diretamente. Alternativa: `losses`. Sem nenhum dos dois, usa `thresholds.defaultPerformanceRatio`. */
    performanceRatio: z.number().gt(0).lte(1).optional(),
    /** Fatores de perda (fração cada: temperatura, sujeira, cabos, inversor, sombreamento...). PR = Π(1 − perda). */
    losses: z.record(z.string(), z.number().min(0).lt(1)).optional(),
    /** Latitude do local (graus, − no hemisfério sul): habilita a inclinação recomendada. */
    latitude: z.number().min(-90).max(90).optional(),
    /** Azimute da face dos módulos (0° = Norte geográfico, 90° = Leste, 180° = Sul, 270° = Oeste). */
    roofAzimuthDegrees: z.number().min(0).lt(360).optional(),
    /** Inclinação dos módulos em relação ao solo (graus). */
    tiltDegrees: z.number().min(0).max(90).optional(),
    modulePowerWp: z.number().positive(),
    moduleAreaM2: z.number().positive(),
    /** Área disponível no telhado/terreno, quando informada. */
    availableAreaM2: z.number().positive().optional(),
    /** Tarifa em centavos por kWh (admite fração de centavo). */
    tariffCentsPerKwh: z.number().positive(),
    /** Reajuste tarifário anual (fração). */
    tariffEscalationRate: z.number().min(0).default(0),
    /** Degradação anual dos módulos (fração). */
    moduleDegradationRate: z.number().min(0).max(0.1).default(0.005),
    /** Custo do sistema: informe custo por Wp OU custo total. */
    costPerWpCents: z.number().positive().optional(),
    systemCostCents: z.number().int().positive().optional(),
    horizonYears: z.number().int().min(1).max(40).default(25),
    customerGroup: z.enum(CustomerGroup).default(CustomerGroup.B),
    projectType: z.enum(ProjectType).default(ProjectType.ON_GRID),
    contractedDemandRelevant: z.boolean().default(false),
    possibleGridZero: z.boolean().default(false),
    shadingRelevant: z.boolean().default(false),
    /** Dados críticos ausentes (ex.: 'tarifa', 'concessionária'). Qualquer item gera alerta amarelo. */
    missingCriticalData: z.array(z.string()).default([]),
    /** Confiança média do OCR da fatura (0–1), quando houver. */
    ocrConfidence: z.number().min(0).max(1).optional(),
    thresholds: thresholdsSchema.default(() => thresholdsSchema.parse({})),
  })
  .refine((v) => v.costPerWpCents !== undefined || v.systemCostCents !== undefined, {
    path: ['costPerWpCents'],
    message: 'Informe o custo por Wp ou o custo total do sistema',
  })
  .refine(
    (v) =>
      !(
        v.performanceRatio !== undefined &&
        v.losses !== undefined &&
        Object.keys(v.losses).length > 0
      ),
    {
      path: ['losses'],
      message: 'Informe o PR OU os fatores de perda, não os dois',
    },
  );

export type QuickCalculationInput = z.input<typeof quickCalculationInputSchema>;
export type ParsedQuickCalculationInput = z.output<typeof quickCalculationInputSchema>;

export const ALERT_CODES = [
  'MISSING_CRITICAL_DATA',
  'GROUP_A_COMPLEX',
  'CONTRACTED_DEMAND_RELEVANT',
  'POSSIBLE_GRID_ZERO',
  'SHADING_RELEVANT',
  'HYBRID_REQUESTED',
  'OFF_GRID_REQUESTED',
  'INSUFFICIENT_AREA',
  'INCONSISTENT_INPUT',
  'ASSUMPTION_OUT_OF_RANGE',
  'OVERSIZED_SYSTEM',
  'NO_PAYBACK_IN_HORIZON',
  'DEFAULT_PERFORMANCE_RATIO',
  'HSP_OUTSIDE_TYPICAL_RANGE',
  'TILT_BELOW_RECOMMENDED',
  'ORIENTATION_NOT_OPTIMAL',
  'MINIGENERATION_CLASS',
  'UTILITY_SCALE_OUT_OF_SCOPE',
] as const;
export type AlertCode = (typeof ALERT_CODES)[number];

export interface CalculationAlert {
  code: AlertCode;
  severity: AlertSeverity;
  message: string;
}

export interface YearlyProjection {
  year: number;
  generationKwh: number;
  compensatedKwh: number;
  savingsCents: number;
  cumulativeCents: number;
}

export interface TrafficLightResult {
  light: TrafficLight;
  alerts: CalculationAlert[];
  /** Verdadeiro quando o caso deve seguir para o Solar Engine Studio / Off-Grid Designer. */
  requiresEngineering: boolean;
}

/** Premissas efetivamente usadas: o que o resultado depende, visível ao usuário e guardado no snapshot (EF-R08). */
export interface QuickCalculationAssumptions {
  performanceRatio: number;
  performanceRatioSource: 'INPUT' | 'LOSSES' | 'DEFAULT';
  losses: Record<string, number> | null;
  hspSource: 'DATASET' | 'MANUAL';
  availabilityCostKwh: number;
  tariffCentsPerKwh: number;
  tariffEscalationRate: number;
  moduleDegradationRate: number;
  modulePowerWp: number;
  moduleAreaM2: number;
  horizonYears: number;
  costModel: 'SYSTEM_COST' | 'COST_PER_WP';
  roofAzimuthDegrees: number | null;
  tiltDegrees: number | null;
  thresholds: Thresholds;
}

export interface QuickCalculationResult {
  algorithmVersion: string;
  /** Classe da geração pela potência instalada (micro, mini, usina). */
  generationClass: GenerationClass;
  /** Inclinação recomendada para a latitude informada (EF-M04); nula sem latitude. */
  recommendedTiltDegrees: number | null;
  assumptions: QuickCalculationAssumptions;
  averageMonthlyConsumptionKwh: number;
  compensableMonthlyKwh: number;
  annualConsumptionKwh: number;
  averageHsp: number;
  requiredPowerKwp: number;
  moduleCount: number;
  installedPowerKwp: number;
  estimatedAreaM2: number;
  monthlyGenerationKwh: number[];
  annualGenerationKwh: number;
  compensationRatio: number;
  investmentCents: number;
  firstYearSavingsCents: number;
  accumulatedSavingsCents: number;
  simplePaybackYears: number | null;
  cashFlowPaybackYears: number | null;
  cashFlow: YearlyProjection[];
  trafficLight: TrafficLight;
  alerts: CalculationAlert[];
  requiresEngineering: boolean;
  confidenceScore: number;
}
