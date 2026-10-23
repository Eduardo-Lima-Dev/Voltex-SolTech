import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { RequestContext } from '../../../common/context/request-context';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { FinanceScanService } from '../../crm/finance/finance-scan.service';
import { AftersalesScanService } from './aftersales-scan.service';

const QUEUE = 'aftersales';

/**
 * Fila `aftersales` (BullMQ): uma rotina periódica percorre as empresas com planta e roda as regras do pós-venda.
 * Cada regra é idempotente, então repetir ou reentregar o trabalho não duplica nada.
 */
@Injectable()
export class AftersalesQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AftersalesQueue.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly scan: AftersalesScanService,
    private readonly financeScan: FinanceScanService,
  ) {}

  async onModuleInit(): Promise<void> {
    const every = this.config.get('AFTERSALES_SCAN_INTERVAL_MS', { infer: true });
    // Nada agendado (testes, desenvolvimento): não abre conexão com o Redis.
    if (every === 0) return;
    const prefix = this.config.get('AUTOMATION_QUEUE_PREFIX', { infer: true });
    this.connection = new IORedis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.connection.on('error', (e) => this.logger.warn(`Redis do pós-venda: ${e.message}`));
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.queue.on('error', (e) => this.logger.warn(`Fila do pós-venda: ${e.message}`));
    this.worker = new Worker(QUEUE, () => this.scanAllTenants(), {
      connection: this.connection,
      prefix,
      concurrency: 1,
    });
    this.worker.on('failed', (job, e) =>
      this.logger.error({ err: e, job: job?.name }, 'Falha na rotina do pós-venda'),
    );
    this.worker.on('error', (e) => this.logger.warn(`Worker do pós-venda: ${e.message}`));
    await this.queue
      .upsertJobScheduler('scan-all', { every }, { name: 'scan-all' })
      .catch((e: unknown) =>
        this.logger.error({ err: e }, 'Não foi possível agendar a rotina do pós-venda'),
      );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }

  /** Empresas com planta ou parcela a receber (também usado pelos testes, sem Redis). */
  async scanAllTenants(): Promise<{ tenants: number }> {
    const [withPlants, withReceivables] = await Promise.all([
      this.prisma.system.plant.findMany({ distinct: ['tenantId'], select: { tenantId: true } }),
      this.prisma.system.receivable.findMany({
        where: { status: { in: ['OPEN', 'OVERDUE'] } },
        distinct: ['tenantId'],
        select: { tenantId: true },
      }),
    ]);
    const plantTenants = new Set(withPlants.map((t) => t.tenantId));
    const tenantIds = new Set([...plantTenants, ...withReceivables.map((t) => t.tenantId)]);
    for (const tenantId of tenantIds) {
      try {
        await this.context.run({ tenantId }, async () => {
          if (plantTenants.has(tenantId)) await this.scan.scanTenant();
          await this.financeScan.scanTenant();
        });
      } catch (error) {
        this.logger.error({ err: error, tenantId }, 'Falha na rotina diária de uma empresa');
      }
    }
    return { tenants: tenantIds.size };
  }
}
