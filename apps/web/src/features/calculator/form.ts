import {
  calculateQuick,
  quickCalculationInputSchema,
  type QuickCalculationInput,
  type QuickCalculationResult,
} from '@voltex/solar-engine';
import type {
  CustomerGroup,
  PhaseSystem,
  ProjectType,
  SolarResourceDto,
  Thresholds,
} from '@voltex/shared';

/** Valores do formulário do wizard. Tudo é texto: o que o usuário digita é convertido só ao calcular. */
export interface WizardValues {
  title: string;
  customerName: string;
  solarResourceId: string;
  hspManual: string;
  latitude: string;
  roofAzimuthDegrees: string;
  tiltDegrees: string;
  /** Doze meses (jan a dez); meses em branco são ignorados. */
  consumption: string[];
  phaseSystem: '' | PhaseSystem;
  availabilityCostKwh: string;
  customerGroup: CustomerGroup;
  projectType: ProjectType;
  tariffId: string;
  /** Tarifa em R$/kWh. */
  tariffReais: string;
  tariffEscalationPercent: string;
  modulePowerWp: string;
  moduleAreaM2: string;
  /** Custo do sistema em R$/Wp. */
  costPerWpReais: string;
  availableAreaM2: string;
  performanceRatio: string;
  degradationPercent: string;
  horizonYears: string;
  contractedDemandRelevant: boolean;
  possibleGridZero: boolean;
  shadingRelevant: boolean;
}

export const defaultWizardValues = (): WizardValues => ({
  title: '',
  customerName: '',
  solarResourceId: '',
  hspManual: '',
  latitude: '',
  roofAzimuthDegrees: '',
  tiltDegrees: '',
  consumption: Array<string>(12).fill(''),
  phaseSystem: '',
  availabilityCostKwh: '',
  customerGroup: 'B',
  projectType: 'ON_GRID',
  tariffId: '',
  tariffReais: '',
  tariffEscalationPercent: '0',
  modulePowerWp: '',
  moduleAreaM2: '',
  costPerWpReais: '',
  availableAreaM2: '',
  performanceRatio: '',
  degradationPercent: '0,5',
  horizonYears: '25',
  contractedDemandRelevant: false,
  possibleGridZero: false,
  shadingRelevant: false,
});

/**
 * Número digitado no padrão brasileiro. Com vírgula, o ponto é separador de milhar ("1.234,5");
 * sem vírgula, o ponto é decimal ("0.95"). Vazio vira `undefined`; texto inválido vira `NaN`.
 */
export function parseDecimal(raw: string | undefined): number | undefined {
  const text = (raw ?? '').trim().replace(/\s/g, '');
  if (text === '') return undefined;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  if (!/^-?\d*\.?\d+$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const scale = (value: number | undefined, factor: number, digits: number) =>
  value === undefined ? undefined : round(value * factor, digits);

/** Converte o formulário na entrada do motor (sem `thresholds`: quem calcula aplica os limites da regra). */
export function buildInput(
  values: WizardValues,
  resource: SolarResourceDto | null,
): QuickCalculationInput {
  const months = values.consumption
    .map(parseDecimal)
    .filter((value): value is number => value !== undefined);
  const hsp = parseDecimal(values.hspManual);
  const degradation = parseDecimal(values.degradationPercent);
  const escalation = parseDecimal(values.tariffEscalationPercent);
  const horizon = parseDecimal(values.horizonYears);

  return {
    consumptionMonthlyKwh: months,
    availabilityCostKwh: parseDecimal(values.availabilityCostKwh) as number,
    hspMonthly: resource
      ? resource.hspMonthly
      : hsp === undefined
        ? []
        : Array<number>(12).fill(hsp),
    hspSource: resource ? 'DATASET' : 'MANUAL',
    performanceRatio: parseDecimal(values.performanceRatio),
    latitude: parseDecimal(values.latitude),
    roofAzimuthDegrees: parseDecimal(values.roofAzimuthDegrees),
    tiltDegrees: parseDecimal(values.tiltDegrees),
    modulePowerWp: parseDecimal(values.modulePowerWp) as number,
    moduleAreaM2: parseDecimal(values.moduleAreaM2) as number,
    availableAreaM2: parseDecimal(values.availableAreaM2),
    tariffCentsPerKwh: scale(parseDecimal(values.tariffReais), 100, 3) as number,
    tariffEscalationRate: scale(escalation, 0.01, 6),
    moduleDegradationRate: scale(degradation, 0.01, 6),
    costPerWpCents: scale(parseDecimal(values.costPerWpReais), 100, 2),
    horizonYears: horizon,
    customerGroup: values.customerGroup,
    projectType: values.projectType,
    contractedDemandRelevant: values.contractedDemandRelevant,
    possibleGridZero: values.possibleGridZero,
    shadingRelevant: values.shadingRelevant,
  };
}

export type Evaluation =
  | { ok: true; input: QuickCalculationInput; result: QuickCalculationResult }
  | { ok: false; input: QuickCalculationInput };

/** Roda o MESMO motor da API com os limites da regra do tenant: o preview bate com o que o servidor grava. */
export function evaluate(
  values: WizardValues,
  resource: SolarResourceDto | null,
  thresholds: Thresholds,
): Evaluation {
  const input = buildInput(values, resource);
  const parsed = quickCalculationInputSchema.safeParse({ ...input, thresholds });
  if (!parsed.success) return { ok: false, input };
  return { ok: true, input, result: calculateQuick(parsed.data) };
}

export const WIZARD_STEPS = [
  { id: 'local', label: 'Cliente e local' },
  { id: 'consumo', label: 'Consumo' },
  { id: 'tarifa', label: 'Tarifa' },
  { id: 'sistema', label: 'Sistema' },
] as const;

export type StepErrors = Partial<Record<keyof WizardValues | 'consumption', string>>;

const REQUIRED = 'Campo obrigatório';
const NUMBER = 'Digite um número válido';

function check(
  errors: StepErrors,
  key: keyof WizardValues,
  raw: string,
  rule: {
    required?: boolean;
    min?: number;
    max?: number;
    gt?: number;
    integer?: boolean;
    maxMessage?: string;
  },
) {
  const value = parseDecimal(raw);
  if (value === undefined) {
    if (rule.required) errors[key] = REQUIRED;
    return;
  }
  if (Number.isNaN(value)) errors[key] = NUMBER;
  else if (rule.gt !== undefined && value <= rule.gt) errors[key] = `Deve ser maior que ${rule.gt}`;
  else if (rule.min !== undefined && value < rule.min) errors[key] = `Mínimo ${rule.min}`;
  else if (rule.max !== undefined && value > rule.max)
    errors[key] = rule.maxMessage ?? `Máximo ${rule.max}`;
  else if (rule.integer && !Number.isInteger(value)) errors[key] = 'Use um número inteiro';
}

/** Validação por etapa, só para orientar o preenchimento. A validação oficial é a do motor/API. */
export function validateStep(step: number, values: WizardValues): StepErrors {
  const errors: StepErrors = {};
  if (step === 0) {
    if (!values.solarResourceId)
      check(errors, 'hspManual', values.hspManual, { required: true, gt: 0, max: 12 });
    check(errors, 'latitude', values.latitude, { min: -90, max: 90 });
    check(errors, 'roofAzimuthDegrees', values.roofAzimuthDegrees, { min: 0, max: 359.99 });
    check(errors, 'tiltDegrees', values.tiltDegrees, { min: 0, max: 90 });
  }
  if (step === 1) {
    const parsed = values.consumption.map(parseDecimal);
    if (parsed.some((v) => v !== undefined && (Number.isNaN(v) || v < 0))) {
      errors.consumption = 'Use apenas números iguais ou maiores que zero';
    } else if (parsed.every((v) => v === undefined)) {
      errors.consumption = 'Informe o consumo de pelo menos um mês';
    }
    check(errors, 'availabilityCostKwh', values.availabilityCostKwh, { required: true, min: 0 });
  }
  if (step === 2) {
    check(errors, 'tariffReais', values.tariffReais, { required: true, gt: 0 });
    check(errors, 'tariffEscalationPercent', values.tariffEscalationPercent, { min: 0 });
  }
  if (step === 3) {
    check(errors, 'modulePowerWp', values.modulePowerWp, { required: true, gt: 0 });
    check(errors, 'moduleAreaM2', values.moduleAreaM2, { required: true, gt: 0 });
    check(errors, 'costPerWpReais', values.costPerWpReais, { required: true, gt: 0 });
    check(errors, 'availableAreaM2', values.availableAreaM2, { gt: 0 });
    check(errors, 'performanceRatio', values.performanceRatio, {
      gt: 0,
      max: 1,
      maxMessage: 'Use um valor entre 0 e 1 (ex.: 0,80)',
    });
    check(errors, 'degradationPercent', values.degradationPercent, { min: 0, max: 10 });
    check(errors, 'horizonYears', values.horizonYears, {
      required: true,
      min: 1,
      max: 40,
      integer: true,
    });
  }
  return errors;
}
