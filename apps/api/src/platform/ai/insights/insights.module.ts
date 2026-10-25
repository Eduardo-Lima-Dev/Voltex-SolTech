import { Module } from '@nestjs/common';
import { CrmModule } from '../../../products/crm/crm.module';
import { OperationsModule } from '../../../products/operations/operations.module';
import { AnalyticsModule } from '../../analytics/analytics.module';
import { InsightsController } from './insights.controller';
import { InsightsScheduler } from './insights.scheduler';
import { InsightsService } from './insights.service';

/** Insights proativos (Fase 12G). Módulo próprio: depende dos produtos, que não podem depender da IA. */
@Module({
  imports: [AnalyticsModule, CrmModule, OperationsModule],
  controllers: [InsightsController],
  providers: [InsightsService, InsightsScheduler],
  exports: [InsightsService],
})
export class InsightsModule {}
