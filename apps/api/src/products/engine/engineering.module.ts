import { Global, Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { EngineeringController } from './engineering.controller';
import { EngineeringProjectsService } from './engineering-projects.service';
import { EngineeringConfiguratorService } from './engineering-configurator.service';
import { EngineeringImpactService } from './engineering-impact.service';
import { EngineeringRequestsService } from './engineering-requests.service';
import { EngineeringVersionsService } from './engineering-versions.service';
import { EngineeringCrmIntegrationService } from './engineering-crm-integration.service';

/** Solar Engine Studio (Fase 9). */
@Global()
@Module({
  imports: [CrmModule],
  controllers: [EngineeringController],
  providers: [
    EngineeringRequestsService,
    EngineeringProjectsService,
    EngineeringVersionsService,
    EngineeringImpactService,
    EngineeringConfiguratorService,
    EngineeringCrmIntegrationService,
  ],
  exports: [EngineeringRequestsService, EngineeringProjectsService, EngineeringVersionsService],
})
export class EngineeringModule {}
