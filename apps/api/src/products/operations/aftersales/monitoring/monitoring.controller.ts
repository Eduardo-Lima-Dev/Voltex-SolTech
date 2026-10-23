import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  importMonitoringCsvSchema,
  linkPlantMonitoringSchema,
  listExternalPlantsQuerySchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../../../common/decorators';
import { MonitoringService } from './monitoring.service';

class LinkDto extends createZodDto(linkPlantMonitoringSchema) {}
class ImportCsvDto extends createZodDto(importMonitoringCsvSchema) {}
class ExternalPlantsQueryDto extends createZodDto(listExternalPlantsQuerySchema) {}

/** Monitoramento da planta (11F). Ver: `ops.plant.read`; vincular e importar: `ops.plant.write`. */
@ApiTags('Operação · Monitoramento')
@ApiBearerAuth()
@Controller('operations/plants/:plantId/monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  @RequirePermissions('ops.plant.read')
  page(@Param('plantId', ParseUUIDPipe) plantId: string) {
    return this.monitoring.page(plantId);
  }

  @Get('connections')
  @RequirePermissions('ops.plant.write')
  connections() {
    return this.monitoring.connections();
  }

  @Get('external-plants')
  @RequirePermissions('ops.plant.write')
  externalPlants(@Query() query: ExternalPlantsQueryDto) {
    return this.monitoring.externalPlants(query.connectionId);
  }

  @Post('links')
  @RequirePermissions('ops.plant.write')
  link(@Param('plantId', ParseUUIDPipe) plantId: string, @Body() body: LinkDto) {
    return this.monitoring.link(plantId, body);
  }

  @Delete('links/:linkId')
  @HttpCode(204)
  @RequirePermissions('ops.plant.write')
  unlink(
    @Param('plantId', ParseUUIDPipe) plantId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.monitoring.unlink(plantId, linkId);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions('ops.plant.write')
  importCsv(@Param('plantId', ParseUUIDPipe) plantId: string, @Body() body: ImportCsvDto) {
    return this.monitoring.importCsv(plantId, body);
  }
}
