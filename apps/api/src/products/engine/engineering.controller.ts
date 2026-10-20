import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  cancelEngineeringRequestSchema,
  createEngineeringProjectSchema,
  listEngineeringProjectsQuerySchema,
  listEngineeringRequestsQuerySchema,
  saveDesignSchema,
  suggestConfigurationsSchema,
} from '@voltex/shared';
import { Throttle } from '@nestjs/throttler';
import { RequirePermissions } from '../../common/decorators';
import { EngineeringConfiguratorService } from './engineering-configurator.service';
import { EngineeringProjectsService } from './engineering-projects.service';
import { EngineeringRequestsService } from './engineering-requests.service';
import { EngineeringVersionsService } from './engineering-versions.service';

class ListRequestsQueryDto extends createZodDto(listEngineeringRequestsQuerySchema) {}
class CancelDto extends createZodDto(cancelEngineeringRequestSchema) {}
class ListProjectsQueryDto extends createZodDto(listEngineeringProjectsQuerySchema) {}
class CreateProjectDto extends createZodDto(createEngineeringProjectSchema) {}
class SaveDesignDto extends createZodDto(saveDesignSchema) {}
class SuggestDto extends createZodDto(suggestConfigurationsSchema) {}
class FromRequestDto extends createZodDto(
  z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }),
) {}

/**
 * Solar Engine Studio: fila de pedidos, projetos e versões. Ler: `engine.project.read`. Criar, editar e enviar:
 * `engine.project.write`. Aprovar e recusar: `engine.project.approve` (responsável técnico, a partir da 9I).
 */
@ApiTags('Engenharia')
@ApiBearerAuth()
@Controller('engineering')
export class EngineeringController {
  constructor(
    private readonly requests: EngineeringRequestsService,
    private readonly projects: EngineeringProjectsService,
    private readonly versions: EngineeringVersionsService,
    private readonly configurator: EngineeringConfiguratorService,
  ) {}

  // ---- Fila de pedidos ----

  @Get('requests')
  @RequirePermissions('engine.project.read')
  listRequests(@Query() query: ListRequestsQueryDto) {
    return this.requests.list(query);
  }

  @Post('requests/:id/assign')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  assign(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.assign(id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  cancelRequest(@Param('id', ParseUUIDPipe) id: string, @Body() body: CancelDto) {
    return this.requests.cancel(id, body.reason);
  }

  // ---- Projetos ----

  @Get('projects')
  @RequirePermissions('engine.project.read')
  listProjects(@Query() query: ListProjectsQueryDto) {
    return this.projects.list(query);
  }

  @Get('projects/:id')
  @RequirePermissions('engine.project.read')
  getProject(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(id);
  }

  @Post('projects')
  @RequirePermissions('engine.project.write')
  createProject(@Body() body: CreateProjectDto) {
    return this.projects.create(body);
  }

  @Post('projects/from-request/:requestId')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  fromRequest(@Param('requestId', ParseUUIDPipe) requestId: string, @Body() body: FromRequestDto) {
    return this.projects.fromRequest(requestId, body);
  }

  @Post('projects/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  cancelProject(@Param('id', ParseUUIDPipe) id: string, @Body() body: CancelDto) {
    return this.projects.cancel(id, body.reason);
  }

  // ---- Versões ----

  @Get('versions/:id')
  @RequirePermissions('engine.project.read')
  getVersion(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.detail(id);
  }

  @Put('versions/:id/design')
  @RequirePermissions('engine.project.write')
  saveDesign(@Param('id', ParseUUIDPipe) id: string, @Body() body: SaveDesignDto) {
    return this.versions.saveDesign(id, body.design);
  }

  /** Combinações módulo × inversor × strings que passam nas verificações, do catálogo aprovado (sugestão a confirmar). */
  @Post('versions/:id/configurations')
  @HttpCode(200)
  @RequirePermissions('engine.project.read')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  suggest(@Param('id', ParseUUIDPipe) id: string, @Body() body: SuggestDto) {
    return this.configurator.suggest(id, body);
  }

  @Post('versions/:id/recalculate')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  recalculate(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.recalculate(id);
  }

  @Post('versions/:id/new-version')
  @RequirePermissions('engine.project.write')
  async newVersion(@Param('id', ParseUUIDPipe) id: string) {
    const created = await this.versions.createFrom(id);
    return this.versions.detail(created.id);
  }

  @Delete('versions/:id')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  removeVersion(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.remove(id);
  }
}
