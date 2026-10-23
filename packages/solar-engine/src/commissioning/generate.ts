import type { CommissioningLevel, CommissioningRulesDefinition } from '@voltex/shared';
import { testsForLevel } from './model.js';
import type { CommissioningSubject, CommissioningTestInstance } from './types.js';

export const SYSTEM_SUBJECT: CommissioningSubject = {
  key: 'system',
  scope: 'SYSTEM',
  label: 'Sistema',
};

export interface GeneratedCommissioning {
  tests: CommissioningTestInstance[];
  /** Ensaios do modelo que não geraram nenhuma linha (ex.: ensaio por string sem nenhuma string). */
  skipped: { code: string; reason: string }[];
}

/**
 * Aplica o modelo de ensaios aos alvos do projeto: um ensaio por sistema, por string ou por inversor, na ordem do
 * modelo e, dentro de cada ensaio, na ordem dos alvos.
 */
export function generateTests(
  definition: CommissioningRulesDefinition,
  level: CommissioningLevel,
  subjects: {
    strings: readonly CommissioningSubject[];
    inverters: readonly CommissioningSubject[];
  },
): GeneratedCommissioning {
  const tests: CommissioningTestInstance[] = [];
  const skipped: GeneratedCommissioning['skipped'] = [];
  for (const row of testsForLevel(definition, level)) {
    const targets =
      row.scope === 'SYSTEM'
        ? [SYSTEM_SUBJECT]
        : row.scope === 'STRING'
          ? subjects.strings
          : subjects.inverters;
    if (targets.length === 0) {
      skipped.push({
        code: row.code,
        reason:
          row.scope === 'STRING' ? 'o projeto não tem strings' : 'o projeto não tem inversores',
      });
      continue;
    }
    for (const subject of targets)
      tests.push({
        code: row.code,
        label: row.label,
        group: row.group,
        kind: row.kind,
        level: row.level,
        scope: row.scope,
        unit: row.unit ?? null,
        expected: row.expected,
        tolerancePct: row.tolerancePct ?? null,
        min: row.min ?? null,
        max: row.max ?? null,
        required: row.required,
        source: row.source,
        subjectKey: subject.key,
        subjectLabel: subject.label,
        electrical: subject.electrical ?? null,
      });
  }
  return { tests, skipped };
}
