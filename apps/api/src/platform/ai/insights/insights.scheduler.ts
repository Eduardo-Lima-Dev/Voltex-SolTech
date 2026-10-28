import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { Env } from '../../../config/env';
import { InsightsService } from './insights.service';

const QUEUE = 'ai-insights';

/** Agenda a rotina diária de insights (fila `ai-insights`). Com intervalo 0 não agenda; os testes chamam o serviço. */
@Injectable()
export class InsightsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InsightsScheduler.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly insights: InsightsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const interval = this.config.get('AI_INSIGHTS_INTERVAL_MS', { infer: true });
    if (interval <= 0) return;
    const prefix = this.config.get('AUTOMATION_QUEUE_PREFIX', { infer: true });
    this.connection = new IORedis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.connection.on('error', (error) =>
      this.logger.warn(`Redis dos insights: ${error.message}`),
    );
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.queue.on('error', (error) => this.logger.warn(`Fila dos insights: ${error.message}`));
    this.worker = new Worker(QUEUE, () => this.insights.runAll(), {
      connection: this.connection,
      prefix,
      concurrency: 1,
    });
    this.worker.on('failed', (_job, error) =>
      this.logger.error({ err: error }, 'Falha na rotina de insights'),
    );
    this.worker.on('error', (error) => this.logger.warn(`Worker dos insights: ${error.message}`));
    await this.queue
      .upsertJobScheduler('daily', { every: interval }, { name: 'daily' })
      .catch((error: unknown) =>
        this.logger.error({ err: error }, 'Não foi possível agendar os insights'),
      );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
