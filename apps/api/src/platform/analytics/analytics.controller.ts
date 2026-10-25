import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  analyticsPeriodQuerySchema,
  analyticsSettingsSchema,
  clientsQuerySchema,
  funnelQuerySchema,
  potentialQuerySchema,
  stalledQuerySchema,
} from '@voltex/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/context/request-user';
import { AnalyticsService } from './analytics.service';

class PeriodDto extends createZodDto(analyticsPeriodQuerySchema) {}
class FunnelDto extends createZodDto(funnelQuerySchema) {}
class ClientsDto extends createZodDto(clientsQuerySchema) {}
class PotentialDto extends createZodDto(potentialQuerySchema) {}
class StalledDto extends createZodDto(stalledQuerySchema) {}
class SettingsDto extends createZodDto(analyticsSettingsSchema) {}

const canFinance = (user: RequestUser) => user.permissions.includes('crm.finance.read');

/**
 * Camada analítica (RF-PLAT-018): números sobre a empresa, com a amostra usada. O que cada pessoa vê é o que a
 * carteira dela alcança (ADR-0028). A IA consome estas mesmas contas pelas ferramentas da 12D.
 */
@ApiTags('Análises')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('settings')
  @RequirePermissions('platform.tenant.read')
  settings() {
    return this.analytics.settingsDto();
  }

  @Put('settings')
  @RequirePermissions('platform.tenant.manage')
  updateSettings(@Body() body: SettingsDto) {
    return this.analytics.updateSettings(body);
  }

  @Get('leads')
  @RequirePermissions('crm.lead.read')
  leads(@Query() query: PeriodDto) {
    return this.analytics.leads(query);
  }

  @Get('funnel')
  @RequirePermissions('crm.opportunity.read')
  funnel(@Query() query: FunnelDto) {
    return this.analytics.funnel(query);
  }

  @Get('sales-cycle')
  @RequirePermissions('crm.opportunity.read')
  salesCycle(@Query() query: PeriodDto) {
    return this.analytics.salesCycle(query);
  }

  @Get('loss-reasons')
  @RequirePermissions('crm.opportunity.read')
  lossReasons(@Query() query: PeriodDto) {
    return this.analytics.lossReasons(query);
  }

  @Get('stalled-opportunities')
  @RequirePermissions('crm.opportunity.read')
  stalled(@Query() query: StalledDto) {
    return this.analytics.stalled(query.limit);
  }

  @Get('tasks')
  @RequirePermissions('crm.task.read')
  tasks() {
    return this.analytics.tasks();
  }

  @Get('clients')
  @RequirePermissions('crm.account.read')
  clients(@Query() query: ClientsDto, @CurrentUser() user: RequestUser) {
    return this.analytics.clients(query, canFinance(user));
  }

  /** Antes de `clients/:id`, para "potential" não ser lido como id. */
  @Get('clients/potential')
  @RequirePermissions('crm.account.read', 'crm.finance.read')
  potential(@Query() query: PotentialDto, @CurrentUser() user: RequestUser) {
    return this.analytics.potential(query, user.permissions.includes('crm.lead.read'));
  }

  @Get('clients/:id')
  @RequirePermissions('crm.account.read')
  client(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.analytics.client(id, canFinance(user));
  }
}
