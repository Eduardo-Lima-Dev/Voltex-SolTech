import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../../config/env';
import { DocumentsModule } from '../../platform/documents/documents.module';
import { CrmModule } from '../crm/crm.module';
import { OperationsModule } from '../operations/operations.module';
import { PortalAdminController } from './portal-admin.controller';
import { PortalAdminService } from './portal-admin.service';
import { PortalAuthService } from './portal-auth.service';
import { PortalController, PortalPublicController } from './portal.controller';
import { PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';

/** Portal do cliente por link mágico (Fase 11H, ADR-0027). */
@Module({
  imports: [
    CrmModule,
    OperationsModule,
    DocumentsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: { fileSize: config.get('UPLOAD_MAX_BYTES', { infer: true }), files: 1 },
      }),
    }),
  ],
  controllers: [PortalPublicController, PortalController, PortalAdminController],
  providers: [PortalAuthService, PortalAdminService, PortalService, PortalGuard],
})
export class PortalModule {}
