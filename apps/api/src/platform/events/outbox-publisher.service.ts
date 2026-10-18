import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { domainEventEnvelopeSchema, type DomainEventEnvelope } from '@voltex/shared';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';

export const OUTBOX_MAX_ATTEMPTS = 10;

/**
 * Entrega os eventos do outbox aos consumidores internos (`@OnEvent('NomeDoEvento')`).
 * Entrega "pelo menos uma vez": consumidores devem ser idempotentes e usar `{ suppressErrors: false }`
 * para que uma falha seja registrada e reentregue. Linhas são reservadas com `FOR UPDATE SKIP LOCKED`,
 * então várias instâncias da API podem rodar o worker ao mesmo tempo.
 */
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const interval = this.config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
    if (interval <= 0) return;
    this.timer = setInterval(() => {
      void this.publishPending().catch((error: unknown) =>
        this.logger.error({ err: error }, 'Falha no ciclo do outbox'),
      );
    }, interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Processa até `limit` eventos pendentes. Devolve quantos foram entregues com sucesso. */
  async publishPending(limit = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.prisma.system.$transaction(
        async (tx) => {
          const claimed = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM outbox_events
            WHERE published_at IS NULL AND attempts < ${OUTBOX_MAX_ATTEMPTS}
            ORDER BY occurred_at
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED`;

          let delivered = 0;
          for (const { id } of claimed) {
            const row = await tx.outboxEvent.findUniqueOrThrow({ where: { id } });
            try {
              const envelope: DomainEventEnvelope = domainEventEnvelopeSchema.parse({
                id: row.id,
                type: row.type,
                occurredAt: row.occurredAt,
                tenantId: row.tenantId,
                actorId: row.actorId,
                projectCode: row.projectCode,
                schemaVersion: row.schemaVersion,
                payload: row.payload,
              });
              await this.emitter.emitAsync(row.type, envelope);
              await tx.outboxEvent.update({
                where: { id },
                data: { publishedAt: new Date(), lastError: null },
              });
              delivered++;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.logger.warn(`Evento ${row.type} (${row.id}) falhou: ${message}`);
              await tx.outboxEvent.update({
                where: { id },
                data: { attempts: { increment: 1 }, lastError: message.slice(0, 500) },
              });
            }
          }
          return delivered;
        },
        { timeout: 30_000 },
      );
    } finally {
      this.running = false;
    }
  }
}
