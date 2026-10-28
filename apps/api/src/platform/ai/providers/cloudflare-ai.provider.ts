import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import {
  AiProvider,
  AiProviderError,
  type AiChatRequest,
  type AiChatResult,
  type AiMessage,
  type AiToolCall,
} from '../ai-provider';

const BASE = 'https://api.cloudflare.com/client/v4/accounts';

type Json = Record<string, unknown>;
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toWire(message: AiMessage): Json {
  if (message.role === 'tool')
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant' && message.toolCalls?.length)
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    };
  return { role: message.role, content: message.content };
}

function parseToolCall(raw: unknown, index: number): AiToolCall | null {
  if (!isRecord(raw)) return null;
  const fn = isRecord(raw.function) ? raw.function : raw;
  const name = typeof fn.name === 'string' ? fn.name : null;
  if (!name) return null;
  let args: Record<string, unknown> = {};
  if (typeof fn.arguments === 'string') {
    try {
      const parsed: unknown = JSON.parse(fn.arguments);
      if (isRecord(parsed)) args = parsed;
    } catch {
      // argumentos ilegíveis: a ferramenta recusa por falta de parâmetro
    }
  } else if (isRecord(fn.arguments)) args = fn.arguments;
  return { id: typeof raw.id === 'string' ? raw.id : `call_${index}`, name, arguments: args };
}

/** Lê os dois formatos de resposta da Cloudflare: `{ response, tool_calls }` e o estilo OpenAI (`choices`). */
export function parseCloudflareResult(result: unknown, model: string): AiChatResult {
  const r = isRecord(result) ? result : {};
  const choice = Array.isArray(r.choices) && isRecord(r.choices[0]) ? r.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const rawText = message?.content ?? choice?.text ?? r.response;
  const text =
    typeof rawText === 'string' ? rawText.trim() : rawText == null ? '' : JSON.stringify(rawText);
  const rawCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(r.tool_calls)
      ? r.tool_calls
      : [];
  const toolCalls = rawCalls
    .map((c, i) => parseToolCall(c, i))
    .filter((c): c is AiToolCall => c !== null);
  const usage = isRecord(r.usage) ? r.usage : {};
  return {
    text,
    toolCalls,
    model,
    neurons: num(usage.neurons),
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
  };
}

/** Traduz erro HTTP ou corpo `success:false` da Cloudflare para os códigos do sistema. */
export function classifyCloudflareFailure(status: number, body: unknown): AiProviderError {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  const first = isRecord(errors[0]) ? errors[0] : {};
  const code = num(first.code);
  const message = typeof first.message === 'string' ? first.message : '';
  const detail = `HTTP ${status}${code ? ` · ${code}` : ''}${message ? ` · ${message.slice(0, 160)}` : ''}`;
  if (status === 401 || status === 403 || code === 10000)
    return new AiProviderError('PROVIDER_AUTH', detail, false);
  const quotaWords = /allocation|neurons|quota|free tier|limit/i.test(message);
  if (status === 429 || code === 4006 || quotaWords)
    return new AiProviderError('PROVIDER_QUOTA', detail, false);
  if (status === 408 || status === 504) return new AiProviderError('TIMEOUT', detail, true);
  return new AiProviderError('PROVIDER_DOWN', detail, true);
}

/**
 * Cloudflare Workers AI pela API REST. No plano grátis a cota diária acaba em erro (e não em cobrança), então o
 * custo é zero por construção. O conteúdo enviado já vem mascarado (ADR-0029).
 */
@Injectable()
export class CloudflareAiProvider extends AiProvider {
  readonly key = 'cloudflare';
  /** Trocável nos testes: respostas gravadas, sem internet. */
  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  private get accountId(): string {
    return this.config.get('CLOUDFLARE_ACCOUNT_ID', { infer: true });
  }
  private get token(): string {
    return this.config.get('CLOUDFLARE_API_TOKEN', { infer: true });
  }

  isConfigured(): boolean {
    return !!this.accountId && !!this.token;
  }

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    if (!this.isConfigured())
      throw new AiProviderError('ENV_DISABLED', 'credenciais ausentes', false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const body: Json = {
      messages: request.messages.map(toWire),
      max_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };
    let raw: { ok: boolean; status: number; text(): Promise<string> };
    try {
      raw = await this.fetchImpl(
        `${BASE}/${encodeURIComponent(this.accountId)}/ai/run/${request.model}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AiProviderError(
        aborted ? 'TIMEOUT' : 'PROVIDER_DOWN',
        aborted ? `sem resposta em ${request.timeoutMs} ms` : 'falha de rede',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(await raw.text());
    } catch {
      payload = null;
    }
    if (!raw.ok || (isRecord(payload) && payload.success === false))
      throw classifyCloudflareFailure(raw.status, payload);
    const result = parseCloudflareResult(isRecord(payload) ? payload.result : null, request.model);
    if (!result.text && result.toolCalls.length === 0)
      throw new AiProviderError('EMPTY_RESPONSE', `modelo ${request.model} respondeu vazio`, true);
    return result;
  }
}
