import { Injectable } from '@nestjs/common';
import { AiProvider, AiProviderError, type AiChatRequest, type AiChatResult } from '../ai-provider';
import { demoBrain } from './demo-brain';

type Script =
  AiChatResult | AiProviderError | ((request: AiChatRequest) => AiChatResult | AiProviderError);

/**
 * Provedor simulado: respostas programadas pelo teste, sem internet e sem custo. Só existe para desenvolvimento e
 * testes (`AI_PROVIDER=fake`); a fábrica recusa usá-lo em produção.
 */
@Injectable()
export class FakeAiProvider extends AiProvider {
  readonly key = 'fake';
  configured = true;
  /** Sem respostas na fila, responde como o "cérebro" de demonstração (`AI_PROVIDER=demo`). */
  demo = false;
  /** Fila de respostas: cada chamada consome a primeira; se acabar, devolve `fallbackScript`. */
  private queue: Script[] = [];
  fallbackScript: Script = {
    text: 'ok',
    toolCalls: [],
    model: 'fake',
    neurons: 10,
    promptTokens: 5,
    completionTokens: 2,
    finishReason: 'stop',
  };
  readonly calls: AiChatRequest[] = [];
  /** Atraso artificial antes de responder (ms), para testar prazos. */
  delayMs = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  enqueue(...scripts: Script[]): void {
    this.queue.push(...scripts);
  }

  reset(): void {
    this.queue = [];
    this.calls.length = 0;
    this.configured = true;
    this.delayMs = 0;
  }

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    this.calls.push(request);
    if (this.delayMs > 0) {
      const wait = Math.min(this.delayMs, request.timeoutMs);
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
      if (this.delayMs > request.timeoutMs) throw new AiProviderError('TIMEOUT', 'simulado', true);
    }
    const next = this.queue.shift() ?? (this.demo ? demoBrain : this.fallbackScript);
    const out = typeof next === 'function' ? next(request) : next;
    if (out instanceof AiProviderError) throw out;
    return { ...out, model: request.model };
  }
}
