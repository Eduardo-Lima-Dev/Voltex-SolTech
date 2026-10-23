import type { CommissioningResult } from './types.js';

export interface CommissioningSummary {
  total: number;
  counts: Record<CommissioningResult, number>;
  /** Ensaios obrigatórios ainda sem registro. */
  requiredPending: number;
  failed: number;
  /** Ensaios que o sistema não consegue julgar (sem regra ou sem dado). */
  unjudged: number;
}

const EMPTY: Record<CommissioningResult, number> = {
  PENDING: 0,
  PENDING_RULE: 0,
  PENDING_DATA: 0,
  PASS: 0,
  FAIL: 0,
  NOT_APPLICABLE: 0,
};

export function summarize(
  tests: readonly { result: CommissioningResult; required: boolean }[],
): CommissioningSummary {
  const counts = { ...EMPTY };
  for (const t of tests) counts[t.result] += 1;
  return {
    total: tests.length,
    counts,
    requiredPending: tests.filter((t) => t.required && t.result === 'PENDING').length,
    failed: counts.FAIL,
    unjudged: counts.PENDING_RULE + counts.PENDING_DATA,
  };
}

/**
 * Motivos que impedem aprovar o comissionamento (lista vazia = pode aprovar). Os motivos são mensagens prontas para
 * mostrar na tela e no relatório.
 */
export function approvalBlockers(
  tests: readonly { result: CommissioningResult; required: boolean }[],
  options: { provisional: boolean },
): string[] {
  const blockers: string[] = [];
  const s = summarize(tests);
  if (options.provisional)
    blockers.push(
      'Não há regra de comissionamento ativa e revisada pelo responsável técnico: o modelo-base é provisório.',
    );
  if (s.requiredPending > 0)
    blockers.push(`${s.requiredPending} ensaio(s) obrigatório(s) sem registro.`);
  if (s.failed > 0) blockers.push(`${s.failed} ensaio(s) reprovado(s).`);
  if (s.unjudged > 0)
    blockers.push(
      `${s.unjudged} ensaio(s) que o sistema não consegue julgar (sem tolerância na regra ou sem dados).`,
    );
  if (tests.length === 0) blockers.push('Nenhum ensaio foi gerado.');
  return blockers;
}
