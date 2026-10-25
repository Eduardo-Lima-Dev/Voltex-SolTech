import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../../analytics/analytics.module';
import { CrmModule } from '../../../products/crm/crm.module';
import { EngineeringModule } from '../../../products/engine/engineering.module';
import { OffgridModule } from '../../../products/offgrid/offgrid.module';
import { OperationsModule } from '../../../products/operations/operations.module';
import { ClientsTools } from './clients.tools';
import { CommercialTools } from './commercial.tools';
import { EngineeringTools } from './engineering.tools';
import { FinanceTools } from './finance.tools';
import { OperationsTools } from './operations.tools';
import { PlatformTools } from './platform.tools';
import { AI_TOOL_SETS } from './tool';
import { AiToolRegistry } from './tool-registry.service';

/**
 * Ferramentas de leitura do assistente (Fase 12D, ADR-0030). Fica em módulo próprio porque depende dos módulos dos
 * produtos (CRM, Operação, Engine, Off-Grid), que não podem depender da IA.
 */
@Module({
  imports: [AnalyticsModule, CrmModule, OperationsModule, EngineeringModule, OffgridModule],
  providers: [
    ClientsTools,
    CommercialTools,
    EngineeringTools,
    FinanceTools,
    OperationsTools,
    PlatformTools,
    {
      provide: AI_TOOL_SETS,
      inject: [
        CommercialTools,
        ClientsTools,
        EngineeringTools,
        OperationsTools,
        FinanceTools,
        PlatformTools,
      ],
      useFactory: (...sets: unknown[]) => sets,
    },
    AiToolRegistry,
  ],
  exports: [AiToolRegistry],
})
export class AiToolsModule {}
