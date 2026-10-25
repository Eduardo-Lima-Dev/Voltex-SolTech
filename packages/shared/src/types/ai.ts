import type {
  AiPurpose,
  AiUnavailableCode,
  InsightKind,
  InsightSeverity,
  InsightStatus,
  TenantAiSettings,
} from '../schemas/ai.js';

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

/** Parte de uma resposta: texto corrido ou um valor com a fonte (vira "chip" na tela). */
export type AiMessagePart =
  { type: 'text'; text: string } | { type: 'fact'; factId: string; text: string };

/** De onde veio um valor citado na resposta. */
export interface AiFactDto {
  id: string;
  /** Valor já formatado (`R$ 5.940,00`). */
  text: string;
  type: string;
  tool: string;
  /** Rótulo em português da consulta feita. */
  toolLabel: string;
  /** Caminho do campo no resultado (`totalReceivedCents`). */
  field: string;
  queriedAt: string;
}

export type AiAnswerKind = 'ANSWER' | 'CANNOT_ANSWER' | 'NEEDS_CLARIFICATION' | 'FALLBACK';

export interface AiMessageDto {
  id: string;
  role: 'USER' | 'ASSISTANT';
  /** Texto completo, sem formatação especial (para copiar). */
  text: string;
  parts: AiMessagePart[];
  kind: AiAnswerKind | null;
  cannotAnswerReason: string | null;
  facts: AiFactDto[];
  followUps: string[];
  /** Pergunta: tipos de dado pessoal que foram removidos antes de ir à IA. */
  removed: Record<string, number>;
  helpful: boolean | null;
  createdAt: string;
}

export interface AiChatResponseDto {
  conversationId: string;
  message: AiMessageDto;
  /** Aviso quando algo foi removido da pergunta (ex.: "Removi um CPF da sua pergunta"). */
  notice: string | null;
}

export interface AiConversationSummaryDto {
  id: string;
  title: string;
  updatedAt: string;
  messagesCount: number;
}

export interface AiConversationDetailDto {
  id: string;
  title: string;
  messages: AiMessageDto[];
}

/** Eventos do envio em fluxo (SSE): progresso, resposta final ou erro com a mensagem pronta. */
export type AiChatEvent =
  | { type: 'progress'; label: string }
  | { type: 'answer'; data: AiChatResponseDto }
  | { type: 'error'; code: string; message: string; status: number };

// ---- Insights (12G) ----

export interface InsightFactDto {
  key: string;
  label: string;
  /** Valor já formatado (`R$ 5.940,00`). */
  text: string;
}

export interface InsightDto {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** Frase mostrada: a redigida pela IA (validada) ou, sem ela, o texto padrão do detector. */
  text: string;
  aiWritten: boolean;
  facts: InsightFactDto[];
  /** Tela com os dados (caminho do app). */
  link: string;
  status: InsightStatus;
  helpful: boolean | null;
  generatedAt: string;
}

export interface InsightRunResultDto {
  detected: number;
  created: number;
  updated: number;
  resolved: number;
  written: number;
}

// ---- Procurement assistido (12H) ----

export interface PriceExtractionRowDto {
  index: number;
  manufacturer: string;
  model: string;
  description: string;
  supplier: string;
  sku: string;
  priceReais: number;
  validFrom: string;
  validTo: string;
  excerpt: string;
  /** Equipamento aprovado do catálogo que combina com fabricante e modelo, se houver. */
  match: { equipmentId: string; label: string } | null;
  /** Problemas que impedem a importação da linha (preço, vigência, fornecedor). */
  problems: string[];
}

export interface PriceExtractionDto {
  id: string;
  filename: string;
  status: 'PENDING_REVIEW' | 'IMPORTED' | 'DISCARDED';
  rows: PriceExtractionRowDto[];
  /** Quantas linhas o modelo devolveu e quantas foram descartadas por não passarem na validação. */
  discardedCount: number;
  model: string | null;
  createdAt: string;
  importedAt: string | null;
}
