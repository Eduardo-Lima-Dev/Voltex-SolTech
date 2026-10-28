import type { AiPurpose, AiUnavailableCode } from '@voltex/shared';

/** Custo estimado de uma resposta, em neurons, para decidir ANTES de chamar se ainda cabe na cota. */
export const AI_ESTIMATED_NEURONS_PER_CALL = 15;

export interface QuotaLimits {
  global: number;
  tenant: number;
  user: number;
  insights: number;
}

export interface QuotaUsage {
  /** Soma de toda a plataforma no dia. */
  global: number;
  /** Da empresa, sem os insights. */
  tenant: number;
  /** Do usuário, sem os insights. */
  user: number;
  /** Dos insights da empresa. */
  insights: number;
}

/** Os insights têm cota própria, para não tirar a do chat; todo o resto divide a cota principal. */
export const isInsightsPurpose = (purpose: AiPurpose): boolean => purpose === 'INSIGHTS';

/** Devolve o código da cota que não comporta mais uma chamada, ou `null` se cabe. Ordem: plataforma, empresa, usuário. */
export function exceededQuota(
  purpose: AiPurpose,
  limits: QuotaLimits,
  used: QuotaUsage,
  estimate = AI_ESTIMATED_NEURONS_PER_CALL,
): AiUnavailableCode | null {
  if (used.global + estimate > limits.global) return 'QUOTA_GLOBAL';
  if (isInsightsPurpose(purpose))
    return used.insights + estimate > limits.insights ? 'QUOTA_TENANT' : null;
  if (used.tenant + estimate > limits.tenant) return 'QUOTA_TENANT';
  if (used.user + estimate > limits.user) return 'QUOTA_USER';
  return null;
}

/** Meia-noite UTC do dia (as cotas do provedor viram nesse horário). */
export const utcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const nextReset = (now: Date): Date => new Date(utcDay(now).getTime() + 24 * 3_600_000);
