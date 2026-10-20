import { Global, Module } from '@nestjs/common';
import { EngineeringController } from './engineering.controller';
import { EngineeringProjectsService } from './engineering-projects.service';
import { EngineeringRequestsService } from './engineering-requests.service';
import { EngineeringVersionsService } from './engineering-versions.service';

/** Solar Engine Studio (Fase 9). */
@Global()
@Module({
  controllers: [EngineeringController],
  providers: [EngineeringRequestsService, EngineeringProjectsService, EngineeringVersionsService],
  exports: [EngineeringRequestsService, EngineeringProjectsService, EngineeringVersionsService],
})
export class EngineeringModule {}
