import { Module } from '@nestjs/common';
import { OffgridController } from './offgrid.controller';
import { OffgridEventsService } from './offgrid-events.service';
import { OffgridProjectsService } from './offgrid-projects.service';
import { OffgridRequestsService } from './offgrid-requests.service';

/** Off-Grid Designer (Fase 10): pedidos e projetos próprios de sistemas isolados e híbridos. */
@Module({
  controllers: [OffgridController],
  providers: [OffgridEventsService, OffgridRequestsService, OffgridProjectsService],
  exports: [OffgridRequestsService, OffgridProjectsService],
})
export class OffgridModule {}
