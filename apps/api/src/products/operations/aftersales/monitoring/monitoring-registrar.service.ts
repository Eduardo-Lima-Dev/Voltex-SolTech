import { Injectable, type OnModuleInit } from '@nestjs/common';
import { IntegrationRegistry } from '../../../../platform/integrations/integration-registry';
import { PrismaService } from '../../../../platform/prisma/prisma.service';
import { buildMonitoringAdapter } from './monitoring-adapter';
import { MonitoringIngestService } from './monitoring-ingest.service';
import { MONITORING_PROVIDERS } from './providers';

/** Registra os provedores de monitoramento no Integration Hub. Todos nascem desligados no servidor. */
@Injectable()
export class MonitoringRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly prisma: PrismaService,
    private readonly ingest: MonitoringIngestService,
  ) {}

  onModuleInit(): void {
    for (const provider of MONITORING_PROVIDERS)
      this.registry.register(
        buildMonitoringAdapter(provider, { prisma: this.prisma, ingest: this.ingest }),
      );
  }
}
