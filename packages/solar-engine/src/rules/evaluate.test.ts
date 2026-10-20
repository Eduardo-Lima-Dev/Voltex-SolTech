import { describe, expect, it } from 'vitest';
import type { ConditionalRule, Predicate } from '@voltex/shared';
import {
  evaluateCondition,
  evaluatePredicate,
  evaluateRules,
  readPath,
  type RuleContext,
} from './evaluate.js';

const ctx: RuleContext = {
  connection: { phases: 3, voltageV: 220, class: 'MICRO' },
  plant: { acKw: 12.5, exportLimited: false, tags: ['a'] },
  available: { kw: 10 },
  nothing: null,
};
const p = (predicate: Predicate) => evaluatePredicate(predicate, ctx);

describe('readPath', () => {
  it('lê caminhos aninhados e devolve undefined quando não existe', () => {
    expect(readPath(ctx, 'connection.phases')).toBe(3);
    expect(readPath(ctx, 'connection.nope')).toBeUndefined();
    expect(readPath(ctx, 'plant.acKw.deeper')).toBeUndefined();
    expect(readPath(ctx, 'nothing.x')).toBeUndefined();
  });
});

describe('predicados', () => {
  it('compara igualdade e diferença', () => {
    expect(p({ field: 'connection.class', op: '=', value: 'MICRO' })).toBe(true);
    expect(p({ field: 'connection.class', op: '!=', value: 'MINI' })).toBe(true);
    expect(p({ field: 'connection.class', op: '=', value: 'MINI' })).toBe(false);
  });

  it('compara números', () => {
    expect(p({ field: 'plant.acKw', op: '>', value: 12 })).toBe(true);
    expect(p({ field: 'plant.acKw', op: '>=', value: 12.5 })).toBe(true);
    expect(p({ field: 'plant.acKw', op: '<', value: 12.5 })).toBe(false);
    expect(p({ field: 'plant.acKw', op: '<=', value: 12.5 })).toBe(true);
  });

  it('compara com outro campo (valueFrom)', () => {
    expect(p({ field: 'plant.acKw', op: '>', valueFrom: 'available.kw' })).toBe(true);
    expect(p({ field: 'plant.acKw', op: '>', valueFrom: 'available.missing' })).toBe(false);
  });

  it('in e between', () => {
    expect(p({ field: 'connection.phases', op: 'in', value: [1, 3] })).toBe(true);
    expect(p({ field: 'connection.phases', op: 'in', value: [1, 2] })).toBe(false);
    expect(p({ field: 'plant.acKw', op: 'between', value: [10, 12.5] })).toBe(true);
    expect(p({ field: 'plant.acKw', op: 'between', value: [13, 20] })).toBe(false);
    expect(p({ field: 'connection.class', op: 'between', value: [1, 2] })).toBe(false);
    expect(p({ field: 'plant.acKw', op: 'between', value: [1] })).toBe(false);
    expect(p({ field: 'connection.phases', op: 'in', valueFrom: 'plant.tags' })).toBe(false);
  });

  it('exists', () => {
    expect(p({ field: 'plant.acKw', op: 'exists' })).toBe(true);
    expect(p({ field: 'plant.zzz', op: 'exists' })).toBe(false);
    expect(p({ field: 'plant.zzz', op: 'exists', value: false })).toBe(true);
    expect(p({ field: 'nothing', op: 'exists' })).toBe(false);
  });

  it('campo ausente ou tipo incompatível nunca satisfaz a comparação', () => {
    expect(p({ field: 'plant.zzz', op: '!=', value: 1 })).toBe(false);
    expect(p({ field: 'connection.class', op: '>', value: 1 })).toBe(false);
    expect(p({ field: 'plant.acKw', op: '>', value: 'x' })).toBe(false);
    expect(p({ field: 'plant.acKw', op: '=' })).toBe(false);
  });
});

describe('condições compostas', () => {
  const big: Predicate = { field: 'plant.acKw', op: '>', value: 10 };
  const micro: Predicate = { field: 'connection.class', op: '=', value: 'MICRO' };
  it('all, any e not', () => {
    expect(evaluateCondition({ all: [big, micro] }, ctx)).toBe(true);
    expect(evaluateCondition({ all: [big, { not: micro }] }, ctx)).toBe(false);
    expect(evaluateCondition({ any: [{ not: big }, micro] }, ctx)).toBe(true);
    expect(evaluateCondition({ any: [{ not: big }, { not: micro }] }, ctx)).toBe(false);
  });
});

describe('evaluateRules', () => {
  const rules: ConditionalRule[] = [
    {
      id: 'r1',
      when: { field: 'plant.exportLimited', op: '=', value: false },
      then: {
        severity: 'WARNING',
        code: 'CONN_NO_EXPORT_LIMIT',
        message: 'Sem limitação de exportação',
        source: 'Norma de teste, item 1',
      },
    },
    {
      id: 'r2',
      when: { field: 'plant.acKw', op: '>', value: 75 },
      then: {
        severity: 'BLOCKING',
        code: 'CONN_ABOVE_MICRO',
        message: 'Acima de microgeração',
        source: 'Norma de teste, item 2',
      },
    },
  ];
  it('devolve só as regras que dispararam, com id e fonte', () => {
    const findings = evaluateRules(rules, ctx);
    expect(findings).toEqual([
      {
        ruleId: 'r1',
        severity: 'WARNING',
        code: 'CONN_NO_EXPORT_LIMIT',
        message: 'Sem limitação de exportação',
        source: 'Norma de teste, item 1',
      },
    ]);
  });
  it('sem regras, sem saídas', () => {
    expect(evaluateRules([], ctx)).toEqual([]);
  });
});
