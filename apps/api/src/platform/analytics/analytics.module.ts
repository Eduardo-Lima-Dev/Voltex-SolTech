import { Global, Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { ForecastsController } from './forecasts.controller';
import { ForecastsService } from './forecasts.service';
import { AnalyticsService } from './analytics.service';

/** Camada analítica (Fase 12C, RF-PLAT-018): métricas determinísticas, com amostra mínima declarada. */
@Global()
@Module({
  controllers: [AnalyticsController, ForecastsController],
  providers: [AnalyticsService, ForecastsService],
  exports: [AnalyticsService, ForecastsService],
})
export class AnalyticsModule {}
