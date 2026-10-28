import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import { ForecastsService } from './forecasts.service';

/** Previsões determinísticas (Fase 12I): com faixa e amostra, ou "dados insuficientes". Nunca chamam a IA. */
@ApiTags('Previsões')
@ApiBearerAuth()
@Controller('forecasts')
export class ForecastsController {
  constructor(private readonly forecasts: ForecastsService) {}

  @Get('receivables')
  @RequirePermissions('crm.finance.read')
  receivables() {
    return this.forecasts.receivables();
  }

  @Get('funnel')
  @RequirePermissions('crm.opportunity.read')
  funnel() {
    return this.forecasts.funnel();
  }

  @Get('installations')
  @RequirePermissions('ops.installation.read')
  installations() {
    return this.forecasts.installations();
  }

  @Get('generation/:projectCode')
  @RequirePermissions('ops.plant.read')
  generation(@Param('projectCode') projectCode: string) {
    return this.forecasts.generation(projectCode);
  }
}
