import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiPurpose, AiUnavailableCode } from '@voltex/shared';
import type { Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { AiGateService } from './ai-gate.service';
import { AiUnavailableError } from './ai-errors';
import {
  AiProvider,
  AiProviderError,
  type AiChatResult,
  type AiMessage,
  type AiToolSpec,
} from './ai-provider';
import { exceededQuota } from './ai-quota';
import { AiUsageService } from './ai-usage.service';
import { CircuitBreaker } from './circuit-breaker';
import { PersonalDataLeak, assertNoPersonalData } from './privacy/guard';

export interface AiGatewayRequest {
  purpose: AiPurpose;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  maxTokens?: number;
  temperature?: number;
  /** Troca o modelo padrão (a avaliação compara modelos). */
  model?: string;
}

/** Falhas que contam para abrir o disjuntor: o provedor está com problema, não a pergunta ou a cota. */
const BREAKER_CODES: readonly AiUnavailableCode[] = ['PROVIDER_DOWN', 'TIMEOUT'];

/**
 * Único caminho até o modelo (ADR-0029). Confere se pode usar e se cabe na cota ANTES de chamar, aplica prazos, tenta
 * o modelo reserva uma vez, abre o disjuntor em falhas seguidas e registra o uso. Tudo o que dá errado vira
 * `AiUnavailableError` com a mensagem pronta; nunca deixa a pergunta pendurada.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly provider: AiProvider,
    private readonly gate: AiGateService,
    private readonly usage: AiUsageService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  private env<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  async chat(request: AiGatewayRequest): Promise<AiChatResult> {
    const blocked = await this.gate.blocker();
    if (blocked) throw new AiUnavailableError(blocked);
    await this.assertSafeToSend(request);
    const quota = exceededQuota(
      request.purpose,
      await this.usage.limits(),
      await this.usage.usedToday(),
    );
    if (quota) throw new AiUnavailableError(quota);
    if (!this.breaker.canAttempt()) throw new AiUnavailableError('CIRCUIT_OPEN');

    const started = Date.now();
    const totalMs = this.env('AI_TOTAL_TIMEOUT_MS');
    const callMs = this.env('AI_CALL_TIMEOUT_MS');
    const primary = request.model ?? this.env('AI_MODEL_DEFAULT');
    const fallback = this.env('AI_MODEL_FALLBACK');
    const models = [primary, ...(fallback && fallback !== primary ? [fallback] : [])];

    let last: AiProviderError | null = null;
    for (const [index, model] of models.entries()) {
      const remaining = totalMs - (Date.now() - started);
      // Sem tempo para mais uma tentativa útil: desiste já, em vez de esperar o prazo estourar.
      if (index > 0 && remaining < 2_000) break;
      try {
        const result = await this.provider.chat({
          model,
          messages: request.messages,
          tools: request.tools,
          maxTokens: request.maxTokens ?? 350,
          temperature: request.temperature ?? 0.2,
          timeoutMs: Math.max(1_000, Math.min(callMs, remaining)),
        });
        this.breaker.recordSuccess();
        await this.usage.record(request.purpose, { neurons: result.neurons, failed: false });
        return result;
      } catch (error) {
        const failure =
          error instanceof AiProviderError
            ? error
            : new AiProviderError(
                'PROVIDER_DOWN',
                error instanceof Error ? error.message : 'erro',
                true,
              );
        last = failure;
        this.logger.warn({ model, code: failure.code, detail: failure.detail }, 'Falha da IA');
        if (BREAKER_CODES.includes(failure.code)) this.breaker.recordFailure();
        await this.usage
          .record(request.purpose, { neurons: null, failed: true })
          .catch(() => undefined);
        if (!failure.retryable) break;
      }
    }
    throw new AiUnavailableError(last?.code ?? 'PROVIDER_DOWN');
  }

  /**
   * Última barreira de privacidade (ADR-0030): se ainda houver dado pessoal no que vai ao provedor, não envia nada,
   * registra o incidente (só os tipos e quantos, nunca o dado) e responde com a mensagem pronta.
   */
  private async assertSafeToSend(request: AiGatewayRequest): Promise<void> {
    try {
      assertNoPersonalData(request.messages);
    } catch (error) {
      if (!(error instanceof PersonalDataLeak)) throw error;
      this.logger.error({ types: error.counts }, 'Envio à IA bloqueado: dado pessoal detectado');
      await this.audit
        .record({
          action: 'ai.privacy_blocked',
          entity: 'Ai',
          after: { purpose: request.purpose, types: error.counts },
        })
        .catch(() => undefined);
      throw new AiUnavailableError('PRIVACY_BLOCKED');
    }
  }

  /** Para os testes: volta o disjuntor ao estado fechado. */
  resetBreaker(): void {
    this.breaker.recordSuccess();
  }
}
