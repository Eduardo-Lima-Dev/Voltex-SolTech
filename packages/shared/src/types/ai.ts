import type { AiPurpose, AiUnavailableCode, TenantAiSettings } from '../schemas/ai.js';

export interface AiQuotaDto {
  /** Cotas em *neurons* por dia e quanto já foi usado hoje (dia UTC). */
  tenant: { limit: number; used: number; remaining: number };
  user: { limit: number; used: number; remaining: number };
  /** Próxima virada das cotas (meia-noite UTC), em ISO 8601. */
  resetsAt: string;
}

/** Situação do assistente para a pessoa logada (`GET /ai/status`): sempre responde na hora. */
export interface AiStatusDto {
  available: boolean;
  /** Preenchido quando não está disponível. */
  code: AiUnavailableCode | null;
  /** Texto pronto para mostrar ao usuário. */
  message: string | null;
  provider: string | null;
  model: string | null;
  quota: AiQuotaDto | null;
}

export interface AiAdminSettingsDto {
  settings: TenantAiSettings;
  /** A empresa é de demonstração (pode usar a IA antes do parecer jurídico). */
  demo: boolean;
  /** O parecer jurídico já foi registrado no ambiente. */
  legalReviewed: boolean;
  status: AiStatusDto;
}

export interface AiUsageDayDto {
  day: string;
  purpose: AiPurpose;
  neurons: number;
  calls: number;
  failures: number;
}

export interface AiUsageDto {
  days: AiUsageDayDto[];
  totals: { neurons: number; calls: number; failures: number };
}

export interface AiDiagnosticsDto {
  ok: boolean;
  text: string | null;
  model: string | null;
  neurons: number | null;
  durationMs: number;
  code: AiUnavailableCode | null;
  message: string | null;
}
