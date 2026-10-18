import { z } from 'zod';
import { CustomerGroup, ProjectType, type AlertSeverity, type TrafficLight } from '@voltex/shared';

export const ALGORITHM_VERSION = 'calc-1.0.0';

export const hspSourceSchema = z.enum(['DATASET', 'MANUAL']);

/** Limites usados pelo semáforo. Valores padrão são sugestões; o Rules Engine pode sobrescrevê-los. */
export const thresholdsSchema = z.object({
  performanceRatioMin: z.number().default(0.6),
  performanceRatioMax: z.number().default(0.9),
  hspMin: z.number().default(2),
  hspMax: z.number().default(8),
  /** Fração máxima de geração sobre o consumo antes de alertar sobredimensionamento. */
  maxGenerationToConsumptionRatio: z.number().default(1.3),
});
export type Thresholds = z.infer<typeof thresholdsSchema>;

export const quickCalculationInputSchema = z
  .object({
    /** De 1 a 12 meses de consumo, em kWh/mês. */
    consumptionMonthlyKwh: z.array(z.number().min(0)).min(1).max(12),
    /** Custo de disponibilidade (kWh/mês). Vem da regra vigente conforme mono/bi/trifásico. */
    availabilityCostKwh: z.number().min(0),
    /** HSP (kWh/m²/dia) de janeiro a dezembro. Para entrada manual, repita o mesmo valor. */
    hspMonthly: z.array(z.number().positive()).length(12),
    hspSource: hspSourceSchema.default('DATASET'),
    performanceRatio: z.number().gt(0).lte(1).default(0.8),
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
  });

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

export interface QuickCalculationResult {
  algorithmVersion: string;
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
