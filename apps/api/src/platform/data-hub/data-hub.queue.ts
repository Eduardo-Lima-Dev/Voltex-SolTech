import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { RequestContext } from '../../common/context/request-context';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { DataSourcesService } from './data-sources.service';
import { CatalogService } from '../catalog/catalog.service';
import { SourceWatchService } from './source-watch.service';
import { TariffScanService } from './tariff-scan.service';

const QUEUE = 'data-hub';

/**
 * Fila `data-hub` (BullMQ): vigilância semanal de páginas e busca mensal de tarifas. Cada execução é idempotente
 * (a proposta tem chave única por fato), então repetir ou reentregar um job não duplica nada.
 */
@Injectable()
export class DataHubQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataHubQueue.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly watches: SourceWatchService,
    private readonly tariffs: TariffScanService,
    private readonly sources: DataSourcesService,
    private readonly catalog: CatalogService,
  ) {}

  async onModuleInit(): Promise<void> {
    const watchEvery = this.config.get('DATA_HUB_WATCH_INTERVAL_MS', { infer: true });
    const tariffEvery = this.config.get('DATA_HUB_TARIFF_INTERVAL_MS', { infer: true });
    // Nada agendado (testes, desenvolvimento): não abre conexão com o Redis.
    if (watchEvery === 0 && tariffEvery === 0) return;
    const prefix = this.config.get('AUTOMATION_QUEUE_PREFIX', { infer: true });
    this.connection = new IORedis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.connection.on('error', (e) => this.logger.warn(`Redis da Central de Dados: ${e.message}`));
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.queue.on('error', (e) => this.logger.warn(`Fila da Central de Dados: ${e.message}`));
    this.worker = new Worker(QUEUE, (job) => this.process(job), {
      connection: this.connection,
      prefix,
      concurrency: 1,
    });
    this.worker.on('failed', (job, e) =>
      this.logger.error({ err: e, job: job?.name }, 'Falha num trabalho da Central de Dados'),
    );
    this.worker.on('error', (e) => this.logger.warn(`Worker da Central de Dados: ${e.message}`));
    if (watchEvery > 0)
      await this.queue
        .upsertJobScheduler('watch-all', { every: watchEvery }, { name: 'watch-all' })
        .catch((e: unknown) =>
          this.logger.error({ err: e }, 'Não foi possível agendar a vigilância'),
        );
    if (watchEvery > 0)
      await this.queue
        .upsertJobScheduler('inmetro-due', { every: watchEvery }, { name: 'inmetro-due' })
        .catch((e: unknown) => this.logger.error({ err: e }, 'Não foi possível agendar o INMETRO'));
    if (tariffEvery > 0)
      await this.queue
        .upsertJobScheduler('tariff-scan', { every: tariffEvery }, { name: 'tariff-scan' })
        .catch((e: unknown) =>
          this.logger.error({ err: e }, 'Não foi possível agendar as tarifas'),
        );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }

  /** Executa um trabalho (também usado pelos testes, sem passar pelo Redis). */
  async process(job: Pick<Job, 'name'>): Promise<unknown> {
    if (job.name === 'watch-all') return this.watchAllTenants();
    if (job.name === 'inmetro-due') return this.flagInmetroAllTenants();
    if (job.name === 'tariff-scan') {
      if (!this.sources.isEnabled('aneel-tariffs')) return { skipped: 'fonte desligada' };
      return this.tariffs.scanAllTenants();
    }
    return undefined;
  }

  /** Abre a proposta de conferência do INMETRO para as empresas que têm módulos ou inversores aprovados. */
  async flagInmetroAllTenants(): Promise<{ tenants: number; proposed: number }> {
    const tenants = await this.prisma.system.equipmentItem.findMany({
      where: { status: 'APPROVED', kind: { in: ['MODULE', 'INVERTER'] } },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    let proposed = 0;
    for (const { tenantId } of tenants)
      proposed += await this.context.run({ tenantId }, () => this.catalog.flagInmetroDue());
    return { tenants: tenants.length, proposed };
  }

  async watchAllTenants(): Promise<{ tenants: number; changed: number; errors: number }> {
    const tenants = await this.prisma.system.sourceWatch.findMany({
      where: { enabled: true, deletedAt: null },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    let changed = 0;
    let errors = 0;
    for (const { tenantId } of tenants) {
      const r = await this.context.run({ tenantId }, () => this.watches.checkAll());
      changed += r.CHANGED;
      errors += r.ERROR;
    }
    return { tenants: tenants.length, changed, errors };
  }
}
