import type { Condition, ConditionalRule, Predicate, RuleOutcome } from '@voltex/shared';

/**
 * Avaliador de regras condicionais (ENG-F26, ADR-0016). Puro e determinístico: recebe as regras (dado versionado)
 * e um contexto (objeto), devolve as saídas das regras que dispararam. Não conhece normas: quem conhece é o dado.
 */
export const RULES_ALGORITHM_VERSION = 'rules-1.0.0';

export type RuleContext = Record<string, unknown>;

export interface RuleFinding extends RuleOutcome {
  /** Regra que disparou (para a justificativa e o snapshot). */
  ruleId: string;
}

/** Lê um caminho com pontos (`connection.phases`). Caminho inexistente → `undefined`. */
export function readPath(context: RuleContext, path: string): unknown {
  let current: unknown = context;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Avalia um predicado. Campo ausente nunca satisfaz uma comparação (só `exists: false` o satisfaz): a regra não
 * dispara por dado que o projeto ainda não tem. Tipos incompatíveis também não satisfazem.
 */
export function evaluatePredicate(predicate: Predicate, context: RuleContext): boolean {
  const actual = readPath(context, predicate.field);
  if (predicate.op === 'exists') {
    const expected = predicate.value === undefined ? true : predicate.value === true;
    const present = actual !== undefined && actual !== null;
    return present === expected;
  }
  if (actual === undefined || actual === null) return false;

  const expected =
    predicate.valueFrom !== undefined ? readPath(context, predicate.valueFrom) : predicate.value;
  if (expected === undefined || expected === null) return false;

  switch (predicate.op) {
    case '=':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'between': {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const [min, max] = expected;
      return isNumber(actual) && isNumber(min) && isNumber(max) && actual >= min && actual <= max;
    }
    default: {
      if (!isNumber(actual) || !isNumber(expected)) return false;
      if (predicate.op === '>') return actual > expected;
      if (predicate.op === '>=') return actual >= expected;
      if (predicate.op === '<') return actual < expected;
      return actual <= expected;
    }
  }
}

export function evaluateCondition(condition: Condition, context: RuleContext): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, context));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, context));
  if ('not' in condition) return !evaluateCondition(condition.not, context);
  return evaluatePredicate(condition, context);
}

/** Roda todas as regras, na ordem recebida, e devolve as saídas das que dispararam. */
export function evaluateRules(
  rules: readonly ConditionalRule[],
  context: RuleContext,
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of rules) {
    if (evaluateCondition(rule.when, context)) findings.push({ ruleId: rule.id, ...rule.then });
  }
  return findings;
}
