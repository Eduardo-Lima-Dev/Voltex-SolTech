import { describe, expect, it } from 'vitest';
import { thresholdsSchema } from '@voltex/shared';
import { solarResource } from '@/test/fixtures';
import {
  buildInput,
  defaultWizardValues,
  evaluate,
  parseDecimal,
  validateStep,
  type WizardValues,
} from './form';

const filled = (overrides: Partial<WizardValues> = {}): WizardValues => ({
  ...defaultWizardValues(),
  hspManual: '5',
  consumption: Array<string>(12).fill('500'),
  availabilityCostKwh: '30',
  tariffReais: '0,95',
  modulePowerWp: '550',
  moduleAreaM2: '2,58',
  costPerWpReais: '4,50',
  performanceRatio: '0,80',
  ...overrides,
});
const thresholds = thresholdsSchema.parse({});

describe('parseDecimal (número digitado no padrão brasileiro)', () => {
  it.each([
    ['0,95', 0.95],
    ['0.95', 0.95],
    ['1.234,5', 1234.5],
    ['  500 ', 500],
    ['-3,73', -3.73],
  ])('"%s" → %s', (raw, expected) => expect(parseDecimal(raw)).toBe(expected));

  it('vazio é undefined; texto inválido é NaN (nunca vira zero em silêncio)', () => {
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('   ')).toBeUndefined();
    expect(parseDecimal(undefined)).toBeUndefined();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
  });
});

describe('buildInput', () => {
  it('converte reais em centavos, percentuais em frações e repete o HSP manual nos 12 meses', () => {
    const input = buildInput(
      filled({ tariffEscalationPercent: '5', degradationPercent: '0,5' }),
      null,
    );
    expect(input).toMatchObject({
      tariffCentsPerKwh: 95,
      costPerWpCents: 450,
      tariffEscalationRate: 0.05,
      moduleDegradationRate: 0.005,
      hspSource: 'MANUAL',
      performanceRatio: 0.8,
    });
    expect(input.hspMonthly).toEqual(Array(12).fill(5));
    expect(input.consumptionMonthlyKwh).toHaveLength(12);
  });

  it('usa o HSP do local cadastrado (origem DATASET) e ignora meses de consumo em branco', () => {
    const values = filled({ consumption: ['400', '', '600', ...Array<string>(9).fill('')] });
    const input = buildInput(values, solarResource({ hspMonthly: Array<number>(12).fill(5.5) }));
    expect(input.hspSource).toBe('DATASET');
    expect(input.hspMonthly).toEqual(Array(12).fill(5.5));
    expect(input.consumptionMonthlyKwh).toEqual([400, 600]);
  });
});

describe('evaluate (mesmo motor da API)', () => {
  it('reproduz o caso de referência: 8 módulos, 4,4 kWp, R$ 19.800,00, semáforo verde', () => {
    const evaluation = evaluate(filled(), null, thresholds);
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    expect(evaluation.result).toMatchObject({
      moduleCount: 8,
      installedPowerKwp: 4.4,
      investmentCents: 1_980_000,
      generationClass: 'MICRO',
      trafficLight: 'GREEN',
    });
  });

  it('formulário incompleto não calcula', () => {
    expect(evaluate(defaultWizardValues(), null, thresholds).ok).toBe(false);
    expect(evaluate(filled({ tariffReais: 'x' }), null, thresholds).ok).toBe(false);
  });

  it('os limites da regra do tenant mudam o resultado', () => {
    const strict = { ...thresholds, microgenerationMaxKw: 3 };
    const evaluation = evaluate(filled(), null, strict);
    expect(evaluation.ok && evaluation.result.generationClass).toBe('MINI');
  });
});

describe('validateStep', () => {
  it('etapa 1 exige HSP manual quando não há local, e valida faixas de latitude e azimute', () => {
    expect(validateStep(0, defaultWizardValues()).hspManual).toBe('Campo obrigatório');
    expect(validateStep(0, defaultWizardValues()).hspManual).toBeDefined();
    expect(validateStep(0, filled({ solarResourceId: 'sr-1', hspManual: '' }))).toEqual({});
    expect(validateStep(0, filled({ latitude: '120' })).latitude).toBeDefined();
    expect(validateStep(0, filled({ roofAzimuthDegrees: '360' })).roofAzimuthDegrees).toBeDefined();
    expect(validateStep(0, filled({ hspManual: '13' })).hspManual).toBeDefined();
  });

  it('etapa 2 exige ao menos um mês de consumo e o custo de disponibilidade', () => {
    const errors = validateStep(1, defaultWizardValues());
    expect(errors.consumption).toMatch(/pelo menos um mês/);
    expect(errors.availabilityCostKwh).toBe('Campo obrigatório');
    expect(
      validateStep(1, filled({ consumption: ['-1', ...Array<string>(11).fill('')] })).consumption,
    ).toMatch(/apenas números/);
    expect(validateStep(1, filled())).toEqual({});
  });

  it('etapa 3 exige tarifa positiva; etapa 4 valida PR, horizonte e módulo', () => {
    expect(validateStep(2, defaultWizardValues()).tariffReais).toBe('Campo obrigatório');
    expect(validateStep(2, filled({ tariffReais: '0' })).tariffReais).toBeDefined();
    expect(validateStep(2, filled())).toEqual({});

    const step4 = validateStep(
      3,
      filled({ modulePowerWp: '', performanceRatio: '1,5', horizonYears: '2,5' }),
    );
    expect(step4.modulePowerWp).toBe('Campo obrigatório');
    expect(step4.performanceRatio).toMatch(/entre 0 e 1/);
    expect(step4.horizonYears).toBe('Use um número inteiro');
    expect(validateStep(3, filled())).toEqual({});
  });
});
