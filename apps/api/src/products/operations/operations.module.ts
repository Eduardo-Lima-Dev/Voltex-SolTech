import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../../config/env';
import { DocumentsModule } from '../../platform/documents/documents.module';
import { CrmModule } from '../crm/crm.module';
import { AftersalesController } from './aftersales/aftersales.controller';
import { AftersalesQueue } from './aftersales/aftersales.queue';
import { AftersalesScanService } from './aftersales/aftersales-scan.service';
import { AftersalesDashboardService } from './aftersales/dashboard.service';
import { MaintenanceService } from './aftersales/maintenance.service';
import { MonitoringController } from './aftersales/monitoring/monitoring.controller';
import { MonitoringIngestService } from './aftersales/monitoring/monitoring-ingest.service';
import { MonitoringRegistrar } from './aftersales/monitoring/monitoring-registrar.service';
import { MonitoringService } from './aftersales/monitoring/monitoring.service';
import { OmContractsService } from './aftersales/om-contracts.service';
import { PlantsService } from './aftersales/plants.service';
import { OperationsSettingsService } from './aftersales/settings.service';
import { TicketsService } from './aftersales/tickets.service';
import { WarrantiesService } from './aftersales/warranties.service';
import { CommissioningService } from './commissioning.service';
import { CrewsService } from './crews.service';
import { FieldService } from './field.service';
import { FieldIssuesService } from './field-issues.service';
import { InstallationsService } from './installations.service';
import { MaterialsService } from './materials.service';
import { OperationsAutomationsService } from './operations-automations.service';
import { OperationsController } from './operations.controller';
import { WorkOrderPresenter } from './work-order-presenter.service';
import { WorkOrdersService } from './work-orders.service';

/** Operação (Fase 11B, ADR-0020): instalação, materiais, equipes, ordens de serviço e agenda. */
@Module({
  imports: [
    CrmModule,
    DocumentsModule,
    // Fotos e assinatura chegam do app de campo: o mesmo limite de tamanho dos demais envios.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: { fileSize: config.get('UPLOAD_MAX_BYTES', { infer: true }), files: 1 },
      }),
    }),
  ],
  controllers: [OperationsController, AftersalesController, MonitoringController],
  providers: [
    WorkOrderPresenter,
    InstallationsService,
    MaterialsService,
    CrewsService,
    WorkOrdersService,
    FieldIssuesService,
    CommissioningService,
    FieldService,
    OperationsAutomationsService,
    OperationsSettingsService,
    WarrantiesService,
    TicketsService,
    MaintenanceService,
    OmContractsService,
    PlantsService,
    AftersalesDashboardService,
    AftersalesScanService,
    MonitoringService,
    MonitoringIngestService,
    MonitoringRegistrar,
    AftersalesQueue,
  ],
  exports: [
    InstallationsService,
    MaterialsService,
    WorkOrdersService,
    CommissioningService,
    PlantsService,
    TicketsService,
    MonitoringService,
  ],
})
export class OperationsModule {}
