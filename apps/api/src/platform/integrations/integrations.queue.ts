import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { RequestContext } from '../../common/context/request-context';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationRegistry } from './integration-registry';
import { IntegrationsService } from './integrations.service';

const QUEUE = 'integrations';
const SYNC_ATTEMPTS = 3;

interface SyncJobData {
  tenantId: string;
  connectionId: string;
}

/** O que a fila precisa de um trabalho (também montado à mão nos testes, sem Redis). */
export interface IntegrationJob {
  name: string;
  data?: unknown;
  attemptsMade?: number;
  opts?: { attempts?: number };
}

/**
 * Fila `integrations` (BullMQ): uma varredura periódica escolhe as conexões ativas cujo intervalo mínimo já passou
 * e enfileira uma sincronização por conexão, com retentativa e recuo exponencial. A última tentativa que falha manda
 * o trabalho para a fila de falhas (ver `IntegrationsService.runSync`).
 */
@Injectable()
export class IntegrationsQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationsQueue.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly registry: IntegrationRegistry,
    private readonly integrations: IntegrationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const every = this.config.get('INTEGRATIONS_SYNC_INTERVAL_MS', { infer: true });
    // Nada agendado (testes, desenvolvimento): não abre conexão com o Redis.
    if (every === 0) return;
    const prefix = this.config.get('AUTOMATION_QUEUE_PREFIX', { infer: true });
    this.connection = new IORedis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.connection.on('error', (e) => this.logger.warn(`Redis das integrações: ${e.message}`));
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.queue.on('error', (e) => this.logger.warn(`Fila das integrações: ${e.message}`));
    this.worker = new Worker(QUEUE, (job) => this.process(job), {
      connection: this.connection,
      prefix,
      concurrency: 2,
    });
    this.worker.on('failed', (job, e) =>
      this.logger.warn({ job: job?.name, err: e.message }, 'Sincronização com falha'),
    );
    this.worker.on('error', (e) => this.logger.warn(`Worker das integrações: ${e.message}`));
    await this.queue
      .upsertJobScheduler('scan-all', { every }, { name: 'scan-all' })
      .catch((e: unknown) => this.logger.error({ err: e }, 'Não foi possível agendar a varredura'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }

  async process(job: IntegrationJob): Promise<unknown> {
    if (job.name === 'scan-all') return this.scanAll();
    if (job.name === 'sync') return this.processSync(job);
    return undefined;
  }

  /** Conexões ativas, de provedor ligado no servidor, com sincronização e intervalo vencido. */
  async dueConnections(): Promise<SyncJobData[]> {
    const rows = await this.prisma.system.integrationConnection.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true, tenantId: true, provider: true, lastSyncAt: true },
    });
    const now = Date.now();
    return rows
      .filter((row) => {
        const adapter = this.registry.get(row.provider);
        if (!adapter?.sync || !this.registry.isEnabled(row.provider)) return false;
        return (
          !row.lastSyncAt || now - row.lastSyncAt.getTime() >= adapter.minIntervalMinutes * 60_000
        );
      })
      .map((row) => ({ tenantId: row.tenantId, connectionId: row.id }));
  }

  async scanAll(): Promise<{ due: number }> {
    const due = await this.dueConnections();
    for (const data of due)
      await this.queue?.add('sync', data, {
        // Um trabalho por conexão e por janela: reentrega ou varredura repetida não duplica.
        jobId: `sync-${data.connectionId}-${Math.floor(Date.now() / 60_000)}`,
        attempts: SYNC_ATTEMPTS,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    return { due: due.length };
  }

  private async processSync(job: IntegrationJob): Promise<unknown> {
    const data = job.data as SyncJobData;
    const attempt = (job.attemptsMade ?? 0) + 1;
    const final = attempt >= (job.opts?.attempts ?? SYNC_ATTEMPTS);
    const outcome = await this.context.run({ tenantId: data.tenantId }, () =>
      this.integrations.runSync(data.connectionId, { attempt, final }),
    );
    // Falha antes da última tentativa: lança para a fila repetir com recuo.
    if (outcome.status === 'FAILED' && !final)
      throw new Error(outcome.error ?? 'Falha na sincronização');
    return { status: outcome.status };
  }
}

export type { Job };
