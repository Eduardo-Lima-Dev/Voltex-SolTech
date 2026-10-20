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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  cancelEngineeringRequestSchema,
  createEngineeringShareLinkSchema,
  engineeringDecisionSchema,
  engineeringReviewCommentSchema,
  createEngineeringProjectSchema,
  listEngineeringProjectsQuerySchema,
  listEngineeringRequestsQuerySchema,
  saveDesignSchema,
  suggestConfigurationsSchema,
} from '@voltex/shared';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public, RequirePermissions } from '../../common/decorators';
import { EngineeringConfiguratorService } from './engineering-configurator.service';
import { EngineeringProjectsService } from './engineering-projects.service';
import { EngineeringHomologationService } from './engineering-homologation.service';
import { EngineeringShareService } from './engineering-share.service';
import { EngineeringRequestsService } from './engineering-requests.service';
import { EngineeringVersionsService } from './engineering-versions.service';

class ListRequestsQueryDto extends createZodDto(listEngineeringRequestsQuerySchema) {}
class CancelDto extends createZodDto(cancelEngineeringRequestSchema) {}
class ListProjectsQueryDto extends createZodDto(listEngineeringProjectsQuerySchema) {}
class CreateProjectDto extends createZodDto(createEngineeringProjectSchema) {}
class SaveDesignDto extends createZodDto(saveDesignSchema) {}
class SuggestDto extends createZodDto(suggestConfigurationsSchema) {}
class ReviewCommentDto extends createZodDto(engineeringReviewCommentSchema) {}
class ShareLinkDto extends createZodDto(createEngineeringShareLinkSchema) {}
class DecisionDto extends createZodDto(engineeringDecisionSchema) {}
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
    private readonly shares: EngineeringShareService,
    private readonly homologation: EngineeringHomologationService,
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

  @Get('projects/:id/snapshot')
  @RequirePermissions('engine.project.read')
  approvedSnapshot(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.approvedSnapshot(id);
  }

  // ---- Versões ----

  @Get('versions/:id')
  @RequirePermissions('engine.project.read')
  getVersion(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.detail(id);
  }

  @Post('versions/:id/share-links')
  @RequirePermissions('engine.project.write')
  createShareLink(@Param('id', ParseUUIDPipe) id: string, @Body() body: ShareLinkDto) {
    return this.shares.create(id, body);
  }

  @Get('versions/:id/share-links')
  @RequirePermissions('engine.project.read')
  listShareLinks(@Param('id', ParseUUIDPipe) id: string) {
    return this.shares.list(id);
  }

  @Post('share-links/:linkId/revoke')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  revokeShareLink(@Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.shares.revoke(linkId);
  }

  @Post('versions/:id/attach-homologation')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  attachHomologation(@Param('id', ParseUUIDPipe) id: string) {
    return this.homologation.attach(id);
  }

  @Get('versions/:id/compare')
  @RequirePermissions('engine.project.read')
  compare(@Param('id', ParseUUIDPipe) id: string, @Query('with', ParseUUIDPipe) other: string) {
    return this.versions.compare(id, other);
  }

  @Get('versions/:id/single-line.svg')
  @RequirePermissions('engine.project.read')
  singleLineSvg(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.singleLine(id, 'svg');
  }

  @Get('versions/:id/single-line.dxf')
  @RequirePermissions('engine.project.read')
  singleLineDxf(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.singleLine(id, 'dxf');
  }

  @Get('versions/:id/report.pdf')
  @RequirePermissions('engine.project.read')
  async reportPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.versions.reportPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }

  @Get('versions/:id/single-line.pdf')
  @RequirePermissions('engine.project.read')
  async singleLinePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.versions.singleLinePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
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

  @Post('versions/:id/submit')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.submit(id);
  }

  @Get('versions/:id/comments')
  @RequirePermissions('engine.project.read')
  comments(@Param('id', ParseUUIDPipe) id: string) {
    return this.versions.comments(id);
  }

  @Post('versions/:id/comments')
  @RequirePermissions('engine.project.approve')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewCommentDto) {
    return this.versions.addComment(id, body);
  }

  @Post('versions/:id/comments/:commentId/resolve')
  @HttpCode(200)
  @RequirePermissions('engine.project.write')
  resolveComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.versions.resolveComment(id, commentId);
  }

  @Post('versions/:id/approve')
  @HttpCode(200)
  @RequirePermissions('engine.project.approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.versions.approve(id, body.note);
  }

  @Post('versions/:id/reject')
  @HttpCode(200)
  @RequirePermissions('engine.project.approve')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.versions.reject(id, body.note);
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

/** Relatório técnico simplificado do projeto aprovado (link com token): sem login, com limite de requisições. */
@ApiTags('Engenharia · Relatório público')
@Controller('public/engineering')
export class PublicEngineeringController {
  constructor(private readonly shares: EngineeringShareService) {}

  @Get(':token')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  open(@Param('token') token: string) {
    return this.shares.openPublic(token);
  }
}
