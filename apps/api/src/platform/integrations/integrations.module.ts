import { Global, Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FetchIntegrationHttp, IntegrationHttp } from './integration-http';
import { IntegrationRegistry } from './integration-registry';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsQueue } from './integrations.queue';
import { IntegrationsService } from './integrations.service';

/** Integration Hub (Fase 11A, ADR-0019): conexões, execuções com retentativa e fila de falhas. */
@Global()
@Module({
  imports: [TenancyModule],
  controllers: [IntegrationsController],
  providers: [
    { provide: IntegrationHttp, useClass: FetchIntegrationHttp },
    IntegrationRegistry,
    IntegrationsService,
    IntegrationsQueue,
  ],
  exports: [IntegrationRegistry, IntegrationsService, IntegrationsQueue, IntegrationHttp],
})
export class IntegrationsModule {}
