import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../../config/env';
import { DocumentsModule } from '../../platform/documents/documents.module';
import { CrmModule } from '../crm/crm.module';
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
  controllers: [OperationsController],
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
  ],
  exports: [InstallationsService, MaterialsService, WorkOrdersService, CommissioningService],
})
export class OperationsModule {}
