import { describe, expect, it } from 'vitest';
import { expectedStringIscA, expectedStringVocV } from './expected.js';
import { evaluateTest } from './evaluate.js';
import type { CommissioningTestInstance, StringElectrical } from './types.js';

// Módulo de exemplo (números redondos para conferir a conta à mão): Voc 40 V, Isc 10 A, β = -0,30 %/°C, α = +0,05 %/°C.
const electrical: StringElectrical = {
  modulesInSeries: 10,
  vocStcV: 40,
  iscStcA: 10,
  betaVocPctPerC: -0.3,
  alphaIscPctPerC: 0.05,
};

const instance = (o: Partial<CommissioningTestInstance> = {}) => ({
  kind: 'MEASURE' as const,
  expected: 'NONE' as const,
  tolerancePct: null,
  min: null,
  max: null,
  electrical: null,
  unit: 'A',
  ...o,
});

describe('valores esperados da string', () => {
  it('Voc: n módulos × Voc corrigido pela temperatura do módulo (STC = 25 °C não corrige)', () => {
    expect(expectedStringVocV(electrical, 25)).toBeCloseTo(400, 6);
    // A 45 °C: 40 × (1 − 0,003 × 20) = 37,6 V por módulo → 376 V.
    expect(expectedStringVocV(electrical, 45)).toBeCloseTo(376, 6);
    // A 5 °C: 40 × (1 + 0,003 × 20) = 42,4 V → 424 V (mais frio, mais tensão).
    expect(expectedStringVocV(electrical, 5)).toBeCloseTo(424, 6);
  });

  it('Isc: proporcional à irradiância, com a correção leve de temperatura', () => {
    expect(expectedStringIscA(electrical, 1000, 25)).toBeCloseTo(10, 6);
    expect(expectedStringIscA(electrical, 800, 25)).toBeCloseTo(8, 6);
    // 800 W/m² a 45 °C: 10 × 0,8 × (1 + 0,0005 × 20) = 8,08 A.
    expect(expectedStringIscA(electrical, 800, 45)).toBeCloseTo(8.08, 6);
  });
});

describe('julgamento dos ensaios', () => {
  it('conferência: conforme passa, não conforme reprova, sem resposta fica pendente', () => {
    const t = instance({ kind: 'CHECK' });
    expect(evaluateTest(t, { passed: true }).result).toBe('PASS');
    expect(evaluateTest(t, { passed: false })).toMatchObject({
      result: 'FAIL',
      reason: 'Marcado como não conforme',
    });
    expect(evaluateTest(t, {}).result).toBe('PENDING');
    expect(evaluateTest(t, { passed: null }).result).toBe('PENDING');
  });

  it('medição sem valor fica pendente; valor que não é número também', () => {
    const t = instance({ min: 1 });
    expect(evaluateTest(t, {}).result).toBe('PENDING');
    expect(evaluateTest(t, { value: Number.NaN }).result).toBe('PENDING');
    expect(evaluateTest(t, { value: null }).result).toBe('PENDING');
  });

  it('SEM tolerância ou limite na regra não se julga: fica "sem regra", nunca aprovado', () => {
    const t = instance({ expected: 'ISC_STRING', electrical });
    const r = evaluateTest(t, { value: 8 }, { irradianceWm2: 800, moduleTempC: 25 });
    expect(r.result).toBe('PENDING_RULE');
    // O esperado é calculado e mostrado mesmo assim, para o técnico conferir a conta.
    expect(r.expectedValue).toBeCloseTo(8, 6);
    expect(r.reason).toMatch(/não define tolerância/);
    expect(evaluateTest(instance(), { value: 3 }).result).toBe('PENDING_RULE');
  });

  it('tolerância em % sobre o esperado: dentro passa, fora reprova, e a borda passa', () => {
    const t = instance({ expected: 'ISC_STRING', electrical, tolerancePct: 5 });
    const cond = { irradianceWm2: 800, moduleTempC: 25 };
    const ok = evaluateTest(t, { value: 7.8 }, cond);
    expect(ok.result).toBe('PASS');
    expect(ok.deviationPct).toBeCloseTo(-2.5, 6);
    expect(ok.basis).toMatch(/800/);
    expect(evaluateTest(t, { value: 8.4 }, cond).result).toBe('PASS'); // +5,0 %
    const bad = evaluateTest(t, { value: 7.5 }, cond); // −6,25 %
    expect(bad.result).toBe('FAIL');
    expect(bad.reason).toMatch(/Desvio de -6\.3 % \(tolerância de 5 %\)/);
  });

  it('Voc: usa a temperatura do módulo informada', () => {
    const t = instance({ expected: 'VOC_STRING', electrical, tolerancePct: 3, unit: 'V' });
    expect(evaluateTest(t, { value: 380 }, { moduleTempC: 45 }).result).toBe('PASS'); // esperado 376 V
    expect(evaluateTest(t, { value: 400 }, { moduleTempC: 45 }).result).toBe('FAIL'); // +6,4 %
  });

  it('faltando dado do projeto ou condição de medição, o resultado é "sem dado" (e diz o que falta)', () => {
    const t = instance({ expected: 'ISC_STRING', electrical, tolerancePct: 5 });
    expect(
      evaluateTest(
        { ...t, electrical: null },
        { value: 8 },
        { irradianceWm2: 800, moduleTempC: 25 },
      ),
    ).toMatchObject({
      result: 'PENDING_DATA',
      reason: expect.stringMatching(/dados do módulo/),
    });
    expect(evaluateTest(t, { value: 8 }, { irradianceWm2: 800 })).toMatchObject({
      result: 'PENDING_DATA',
      reason: expect.stringMatching(/temperatura do módulo/),
    });
    expect(evaluateTest(t, { value: 8 }, { moduleTempC: 25 })).toMatchObject({
      result: 'PENDING_DATA',
      reason: expect.stringMatching(/irradiância/),
    });
    expect(evaluateTest(t, { value: 8 }, { irradianceWm2: 0, moduleTempC: 25 }).result).toBe(
      'PENDING_DATA',
    );
    expect(evaluateTest(t, { value: 8 }, { irradianceWm2: -10, moduleTempC: 25 }).result).toBe(
      'PENDING_DATA',
    );
  });

  it('limites absolutos: mínimo e máximo, com a borda aceita', () => {
    const insulation = instance({ unit: 'MΩ', min: 1 });
    expect(evaluateTest(insulation, { value: 1 }).result).toBe('PASS');
    expect(evaluateTest(insulation, { value: 0.9 })).toMatchObject({
      result: 'FAIL',
      reason: 'Abaixo do mínimo (1 MΩ)',
    });
    const ground = instance({ unit: 'Ω', max: 10 });
    expect(evaluateTest(ground, { value: 10 }).result).toBe('PASS');
    expect(evaluateTest(ground, { value: 10.1 })).toMatchObject({
      result: 'FAIL',
      reason: 'Acima do máximo (10 Ω)',
    });
    const range = instance({ unit: 'V', min: 5, max: 6 });
    expect(evaluateTest(range, { value: 4 }).result).toBe('FAIL');
    expect(evaluateTest(range, { value: 7 }).result).toBe('FAIL');
    expect(evaluateTest(range, { value: 5.5 }).result).toBe('PASS');
  });

  it('tolerância e limites juntos: os dois precisam ser atendidos e os motivos se somam', () => {
    const t = instance({ expected: 'ISC_STRING', electrical, tolerancePct: 5, min: 7.9 });
    const cond = { irradianceWm2: 800, moduleTempC: 25 };
    expect(evaluateTest(t, { value: 7.95 }, cond).result).toBe('PASS');
    const both = evaluateTest(t, { value: 7.5 }, cond);
    expect(both.result).toBe('FAIL');
    expect(both.reason).toContain('Desvio');
    expect(both.reason).toContain('Abaixo do mínimo');
  });

  it('só limite absoluto com esperado calculado: julga pelo limite e mostra o esperado', () => {
    const t = instance({ expected: 'ISC_STRING', electrical, min: 7 });
    const r = evaluateTest(t, { value: 7.2 }, { irradianceWm2: 800, moduleTempC: 25 });
    expect(r.result).toBe('PASS');
    expect(r.expectedValue).toBeCloseTo(8, 6);
  });
});
