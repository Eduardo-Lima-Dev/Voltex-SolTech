import { expectedStringIscA, expectedStringVocV } from './expected.js';
import type {
  CommissioningTestInstance,
  Evaluation,
  MeasurementConditions,
  MeasurementInput,
} from './types.js';

const num = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const pending = (
  result: Evaluation['result'],
  reason: string | null,
  extra: Partial<Evaluation> = {},
): Evaluation => ({
  result,
  expectedValue: null,
  deviationPct: null,
  basis: null,
  reason,
  ...extra,
});

/**
 * Julga um ensaio. **Nenhuma tolerância é presumida**: o limite vem da regra revisada (`tolerancePct`, `min`,
 * `max`). Sem limite o resultado é `PENDING_RULE`; sem dado para calcular o esperado, `PENDING_DATA`; e as duas
 * situações travam a aprovação do comissionamento.
 */
export function evaluateTest(
  test: Pick<
    CommissioningTestInstance,
    'kind' | 'expected' | 'tolerancePct' | 'min' | 'max' | 'electrical' | 'unit'
  >,
  input: MeasurementInput,
  conditions: MeasurementConditions = {},
): Evaluation {
  if (test.kind === 'CHECK') {
    if (input.passed === true) return pending('PASS', null);
    if (input.passed === false) return pending('FAIL', 'Marcado como não conforme');
    return pending('PENDING', null);
  }

  // Medição: sem valor, nada a julgar.
  if (!num(input.value)) return pending('PENDING', null);
  const value = input.value;
  const unit = test.unit ?? '';

  let expectedValue: number | null = null;
  let basis: string | null = null;
  if (test.expected !== 'NONE') {
    if (!test.electrical)
      return pending(
        'PENDING_DATA',
        'Faltam os dados do módulo e da string para calcular o valor esperado.',
      );
    const temp = conditions.moduleTempC;
    if (!num(temp))
      return pending('PENDING_DATA', 'Informe a temperatura do módulo no momento da medição.');
    if (test.expected === 'VOC_STRING') {
      expectedValue = expectedStringVocV(test.electrical, temp);
      basis = `${test.electrical.modulesInSeries} × Voc do módulo a ${temp} °C (β = ${test.electrical.betaVocPctPerC} %/°C)`;
    } else {
      const g = conditions.irradianceWm2;
      if (!num(g) || g <= 0)
        return pending(
          'PENDING_DATA',
          'Informe a irradiância (maior que zero) no momento da medição.',
        );
      expectedValue = expectedStringIscA(test.electrical, g, temp);
      basis = `Isc do módulo × ${g} / 1000 W/m², a ${temp} °C (α = ${test.electrical.alphaIscPctPerC} %/°C)`;
    }
  }

  const deviationPct =
    expectedValue !== null && expectedValue !== 0
      ? ((value - expectedValue) / expectedValue) * 100
      : null;
  const base = { expectedValue, deviationPct, basis };

  const hasTolerance = test.tolerancePct !== null && expectedValue !== null;
  const hasBounds = test.min !== null || test.max !== null;
  if (!hasTolerance && !hasBounds)
    return {
      result: 'PENDING_RULE',
      ...base,
      reason: 'A regra em vigor não define tolerância nem limite para este ensaio.',
    };

  const reasons: string[] = [];
  // A folga de 1e-9 evita que o erro de ponto flutuante reprove um valor exatamente na borda da tolerância.
  if (hasTolerance && deviationPct !== null && Math.abs(deviationPct) > test.tolerancePct! + 1e-9)
    reasons.push(`Desvio de ${deviationPct.toFixed(1)} % (tolerância de ${test.tolerancePct} %)`);
  if (test.min !== null && value < test.min) reasons.push(`Abaixo do mínimo (${test.min} ${unit})`);
  if (test.max !== null && value > test.max) reasons.push(`Acima do máximo (${test.max} ${unit})`);
  return reasons.length > 0
    ? { result: 'FAIL', ...base, reason: reasons.join('; ') }
    : { result: 'PASS', ...base, reason: null };
}
