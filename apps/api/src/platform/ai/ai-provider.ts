import type { AiUnavailableCode } from '@voltex/shared';

/**
 * Contrato do provedor de IA (ADR-0029). O sistema fala só com esta interface: trocar o provedor (Cloudflare hoje,
 * Amazon Bedrock ou modelo próprio depois) é escrever outra classe e mudar a configuração, sem tocar nas funções.
 */

export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiMessage {
  role: AiRole;
  content: string;
  /** Chamadas de ferramenta pedidas pelo modelo (mensagem do `assistant`). */
  toolCalls?: AiToolCall[];
  /** Resposta de uma ferramenta (mensagem `tool`). */
  toolCallId?: string;
}

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema dos parâmetros. */
  parameters: Record<string, unknown>;
}

export interface AiChatRequest {
  model: string;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
}

export interface AiChatResult {
  text: string;
  toolCalls: AiToolCall[];
  model: string;
  /** Custo informado pelo provedor, na unidade dele (*neurons* na Cloudflare). */
  neurons: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  finishReason: string | null;
}

/** Falha do provedor, já traduzida para os códigos do sistema (com a mensagem pronta em português). */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiUnavailableCode,
    /** Detalhe técnico para o log; nunca vai ao usuário. */
    readonly detail: string,
    /** Vale tentar o modelo reserva? Credencial e cota não melhoram trocando de modelo. */
    readonly retryable: boolean,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'AiProviderError';
  }
}

export abstract class AiProvider {
  abstract readonly key: string;
  /** Tem tudo o que precisa (credencial, endereço) para tentar uma chamada? */
  abstract isConfigured(): boolean;
  abstract chat(request: AiChatRequest): Promise<AiChatResult>;
}
