import { Global, Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { DocumentsModule } from '../../platform/documents/documents.module';
import { EngineeringHomologationService } from './engineering-homologation.service';
import { EngineeringController, PublicEngineeringController } from './engineering.controller';
import { EngineeringProjectsService } from './engineering-projects.service';
import { EngineeringConfiguratorService } from './engineering-configurator.service';
import { EngineeringImpactService } from './engineering-impact.service';
import { EngineeringRequestsService } from './engineering-requests.service';
import { EngineeringVersionsService } from './engineering-versions.service';
import { EngineeringEventsService } from './engineering-events.service';
import { EngineeringManagementService } from './engineering-management.service';
import { EngineeringShareService } from './engineering-share.service';
import { EngineeringCrmIntegrationService } from './engineering-crm-integration.service';

/** Solar Engine Studio (Fase 9). */
@Global()
@Module({
  imports: [CrmModule, DocumentsModule],
  controllers: [EngineeringController, PublicEngineeringController],
  providers: [
    EngineeringRequestsService,
    EngineeringProjectsService,
    EngineeringVersionsService,
    EngineeringImpactService,
    EngineeringConfiguratorService,
    EngineeringCrmIntegrationService,
    EngineeringShareService,
    EngineeringHomologationService,
    EngineeringEventsService,
    EngineeringManagementService,
  ],
  exports: [EngineeringRequestsService, EngineeringProjectsService, EngineeringVersionsService],
})
export class EngineeringModule {}
