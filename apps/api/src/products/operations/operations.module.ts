import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { CrewsService } from './crews.service';
import { FieldIssuesService } from './field-issues.service';
import { InstallationsService } from './installations.service';
import { MaterialsService } from './materials.service';
import { OperationsAutomationsService } from './operations-automations.service';
import { OperationsController } from './operations.controller';
import { WorkOrderPresenter } from './work-order-presenter.service';
import { WorkOrdersService } from './work-orders.service';

/** Operação (Fase 11B, ADR-0020): instalação, materiais, equipes, ordens de serviço e agenda. */
@Module({
  imports: [CrmModule],
  controllers: [OperationsController],
  providers: [
    WorkOrderPresenter,
    InstallationsService,
    MaterialsService,
    CrewsService,
    WorkOrdersService,
    FieldIssuesService,
    OperationsAutomationsService,
  ],
  exports: [InstallationsService, MaterialsService, WorkOrdersService],
})
export class OperationsModule {}
