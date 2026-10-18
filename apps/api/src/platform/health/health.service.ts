import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../../config/env';
import { S3Service } from '../documents/s3.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CheckResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    config: ConfigService<Env, true>,
  ) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: CHECK_TIMEOUT_MS,
    });
    // Evita "Unhandled error event" quando o Redis cai; o estado aparece no /health.
    this.redis.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }

  async check() {
    const [database, redis, storage] = await Promise.all([
      this.run(() => this.prisma.system.$queryRaw`SELECT 1`),
      this.run(async () => {
        if (this.redis.status === 'wait' || this.redis.status === 'end')
          await this.redis.connect().catch(() => undefined);
        await this.redis.ping();
      }),
      this.run(() => this.s3.checkHealth()),
    ]);
    const checks = { database, redis, storage };
    const healthy = Object.values(checks).every((c) => c.status === 'up');
    return {
      healthy,
      body: {
        status: healthy ? 'ok' : 'degraded',
        checks,
        uptimeSeconds: Math.round(process.uptime()),
      },
    };
  }

  private async run(fn: () => Promise<unknown>): Promise<CheckResult> {
    const started = Date.now();
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref(),
        ),
      ]);
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'erro',
      };
    }
  }
}
