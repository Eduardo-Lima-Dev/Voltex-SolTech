import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { LinkPlantMonitoringInput, PlantMonitoringPageDto } from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { MonitoringService } from './monitoring.service';

@Controller('plants/:plantId/monitoring')
@RequirePermissions('ops.plant.read')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  // --- ligação de plantas -------------------------------------------------------

  @Post('link')
  @RequirePermissions('ops.plant.write')
  async linkPlant(
    @Param('plantId', new ParseUUIDPipe()) plantId: string,
    @Body() input: LinkPlantMonitoringInput,
  ) {
    return await this.monitoring.linkPlant(plantId, input);
  }

  @Delete('link/:linkId')
  @RequirePermissions('ops.plant.write')
  async unlinkPlant(
    @Param('plantId', new ParseUUIDPipe()) plantId: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
    @Res() res: Response,
  ) {
    await this.monitoring.unlinkPlant(plantId, linkId);
    res.status(HttpStatus.NO_CONTENT).send();
  }

  @Get('links')
  async getLinks(@Param('plantId', new ParseUUIDPipe()) plantId: string) {
    return await this.monitoring.listLinks(plantId);
  }

  // --- página completa de monitoramento -----------------------------------------

  @Get()
  async getMonitoringPage(
    @Param('plantId', new ParseUUIDPipe()) plantId: string,
  ): Promise<PlantMonitoringPageDto> {
    return await this.monitoring.getMonitoringPage(plantId);
  }
}
