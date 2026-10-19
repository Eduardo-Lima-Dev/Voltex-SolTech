import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { commercialDashboardQuerySchema } from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { DashboardService } from './dashboard.service';

class QueryDto extends createZodDto(commercialDashboardQuerySchema) {}

@ApiTags('CRM · Painel comercial')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('commercial')
  @RequirePermissions('crm.dashboard.read')
  commercial(@Query() query: QueryDto) {
    return this.dashboard.commercial(query);
  }
}
