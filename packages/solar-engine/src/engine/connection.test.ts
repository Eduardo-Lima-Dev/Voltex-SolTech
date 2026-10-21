import { describe, expect, it } from 'vitest';
import { evaluateConnection } from './connection.js';

describe('evaluateConnection', () => {
  const rule = {
    id: 'export-limit',
    when: { field: 'plant.acKw', op: '>', valueFrom: 'connection.availableKw' } as const,
    then: {
      severity: 'BLOCKING' as const,
      code: 'CONN_AVAILABLE_POWER_EXCEEDED',
      message: 'Potência CA supera a disponibilizada.',
      source: 'Norma teste da distribuidora',
    },
  };

  it('bloqueia quando a regra versionada dispara', () => {
    const result = evaluateConnection({
      acPowerKw: 10,
      availablePowerKw: 8,
      phases: 3,
      gridZero: false,
      rules: [rule],
    });
    expect(result.status).toBe('INVALID');
    expect(result.findings[0]).toMatchObject({
      code: 'CONN_AVAILABLE_POWER_EXCEEDED',
      severity: 'BLOCKING',
    });
  });

  it('fica pendente sem dados ou regra, sem inventar uma exigência', () => {
    const result = evaluateConnection({
      acPowerKw: null,
      availablePowerKw: null,
      phases: null,
      gridZero: false,
      rules: [],
    });
    expect(result.status).toBe('INCOMPLETE');
    expect(result.pending.map((item) => item.code)).toEqual([
      'AC_POWER_MISSING',
      'AVAILABLE_POWER_MISSING',
      'CONNECTION_RULE_MISSING',
    ]);
  });
});
