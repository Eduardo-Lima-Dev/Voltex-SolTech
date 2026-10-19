import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';

/** Métricas no formato Prometheus: processo (CPU, memória, event loop), HTTP e a fila de eventos. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly requests: Counter<'method' | 'route' | 'status'>;
  private readonly duration: Histogram<'method' | 'route' | 'status'>;

  constructor(prisma: PrismaService) {
    collectDefaultMetrics({ register: this.registry, prefix: 'voltex_' });
    this.requests = new Counter({
      name: 'voltex_http_requests_total',
      help: 'Requisições HTTP atendidas',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });
    this.duration = new Histogram({
      name: 'voltex_http_request_duration_seconds',
      help: 'Duração das requisições HTTP',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    // Lidos a cada coleta: eventos esperando entrega e os que esgotaram as tentativas (precisam de atenção).
    new Gauge({
      name: 'voltex_outbox_pending_events',
      help: 'Eventos do outbox ainda não entregues',
      registers: [this.registry],
      collect: async function (this: Gauge) {
        this.set(await prisma.system.outboxEvent.count({ where: { publishedAt: null } }));
      },
    });
    new Gauge({
      name: 'voltex_outbox_failed_events',
      help: 'Eventos do outbox que esgotaram as tentativas de entrega',
      registers: [this.registry],
      collect: async function (this: Gauge) {
        this.set(
          await prisma.system.outboxEvent.count({
            where: { publishedAt: null, attempts: { gte: 10 } },
          }),
        );
      },
    });
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    this.requests.inc(labels);
    this.duration.observe(labels, seconds);
  }
}
