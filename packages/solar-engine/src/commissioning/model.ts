import type { CommissioningLevel, CommissioningRulesDefinition } from '@voltex/shared';
import {
  COMMISSIONING_BASE_DEFINITION,
  COMMISSIONING_BASE_NOTE,
  COMMISSIONING_BASE_REF,
} from './base-model.js';

export interface CommissioningModel {
  /** `<id>@<versão>` da regra em vigor, ou a referência do modelo-base. */
  ref: string;
  /** `true` = modelo-base (sem regra ativa e revisada): a aprovação fica travada. */
  provisional: boolean;
  note: string | null;
  definition: CommissioningRulesDefinition;
}

/** A regra em vigor, ou, sem ela, o modelo-base provisório. */
export function resolveCommissioningModel(
  rule: { ref: string; definition: CommissioningRulesDefinition } | null,
): CommissioningModel {
  if (rule) return { ref: rule.ref, provisional: false, note: null, definition: rule.definition };
  return {
    ref: COMMISSIONING_BASE_REF,
    provisional: true,
    note: COMMISSIONING_BASE_NOTE,
    definition: COMMISSIONING_BASE_DEFINITION,
  };
}

/** Os ensaios de um nível: o `STANDARD` só traz a categoria 1; o `EXTENDED` traz as duas. */
export const testsForLevel = (
  definition: CommissioningRulesDefinition,
  level: CommissioningLevel,
): CommissioningRulesDefinition['tests'] =>
  definition.tests.filter((t) => level === 'EXTENDED' || t.level === 'STANDARD');
