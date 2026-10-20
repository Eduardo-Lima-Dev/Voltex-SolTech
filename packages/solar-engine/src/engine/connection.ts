import type { ConditionalRule } from '@voltex/shared';
import { evaluateRules, type RuleFinding } from '../rules/evaluate.js';

/** ENG-F22: conexão é dirigida por regras versionadas da distribuidora; o motor não embute norma. */
export const CONNECTION_ALGORITHM_VERSION = 'connection-1.0.0';

export interface ConnectionInput {
  acPowerKw: number | null;
  availablePowerKw: number | null;
  phases: number | null;
  gridZero: boolean;
  rules: ConditionalRule[];
}

export interface ConnectionResult {
  status: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID' | 'INCOMPLETE';
  findings: RuleFinding[];
  pending: { code: string; message: string }[];
  algorithmVersion: string;
}

export function evaluateConnection(input: ConnectionInput): ConnectionResult {
  const pending: ConnectionResult['pending'] = [];
  if (input.acPowerKw === null)
    pending.push({ code: 'AC_POWER_MISSING', message: 'Falta potência CA do projeto.' });
  if (input.availablePowerKw === null)
    pending.push({
      code: 'AVAILABLE_POWER_MISSING',
      message: 'Falta potência disponibilizada da unidade consumidora.',
    });
  if (!input.rules.length)
    pending.push({
      code: 'CONNECTION_RULE_MISSING',
      message: 'Não há regra vigente de conexão para este escopo.',
    });
  const findings = evaluateRules(input.rules, {
    plant: { acKw: input.acPowerKw },
    connection: {
      availableKw: input.availablePowerKw,
      phases: input.phases,
      gridZero: input.gridZero,
    },
  });
  const status = findings.some((f) => f.severity === 'BLOCKING')
    ? 'INVALID'
    : pending.length
      ? 'INCOMPLETE'
      : findings.some((f) => f.severity === 'WARNING')
        ? 'VALID_WITH_WARNINGS'
        : 'VALID';
  return { status, findings, pending, algorithmVersion: CONNECTION_ALGORITHM_VERSION };
}
