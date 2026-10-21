import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  changeOffgridRequestSchema,
  createOffgridProjectSchema,
  createOffgridRequestSchema,
  engineeringDecisionSchema,
  engineeringReviewCommentSchema,
  listOffgridProjectsQuerySchema,
  listOffgridRequestsQuerySchema,
  offgridCommentSchema,
  saveOffgridDesignSchema,
  suggestOffgridSchema,
  updateOffgridProjectSchema,
} from '@voltex/shared';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators';
import { OffgridProjectsService } from './offgrid-projects.service';
import { OffgridRequestsService } from './offgrid-requests.service';

class ListRequestsDto extends createZodDto(listOffgridRequestsQuerySchema) {}
class CreateRequestDto extends createZodDto(createOffgridRequestSchema) {}
class ChangeRequestDto extends createZodDto(changeOffgridRequestSchema) {}
class CommentDto extends createZodDto(offgridCommentSchema) {}
class ListProjectsDto extends createZodDto(listOffgridProjectsQuerySchema) {}
class CreateProjectDto extends createZodDto(createOffgridProjectSchema) {}
class UpdateProjectDto extends createZodDto(updateOffgridProjectSchema) {}
class SaveDesignDto extends createZodDto(saveOffgridDesignSchema) {}
class SuggestDto extends createZodDto(suggestOffgridSchema) {}
class ReviewCommentDto extends createZodDto(engineeringReviewCommentSchema) {}
class DecisionDto extends createZodDto(engineeringDecisionSchema) {}

/**
 * Off-Grid Designer: pedidos, projetos e versões de sistemas isolados e híbridos. Ler: `offgrid.project.read`.
 * Criar, editar e enviar: `offgrid.project.write`. Aprovar e recusar: `offgrid.scenario.approve` (responsável técnico).
 */
@ApiTags('Off-Grid')
@ApiBearerAuth()
@Controller('offgrid')
export class OffgridController {
  constructor(
    private readonly requests: OffgridRequestsService,
    private readonly projects: OffgridProjectsService,
  ) {}

  // ---- Pedidos ----

  @Get('requests')
  @RequirePermissions('offgrid.project.read')
  listRequests(@Query() query: ListRequestsDto) {
    return this.requests.list(query);
  }

  @Post('requests')
  @RequirePermissions('offgrid.project.write')
  createRequest(@Body() body: CreateRequestDto) {
    return this.requests.create(body);
  }

  @Get('dashboard')
  @RequirePermissions('offgrid.project.read')
  dashboard() {
    return this.requests.dashboard();
  }

  @Get('requests/:id')
  @RequirePermissions('offgrid.project.read')
  requestDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.detail(id);
  }

  @Patch('requests/:id')
  @RequirePermissions('offgrid.project.write')
  changeRequest(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeRequestDto) {
    return this.requests.change(id, body);
  }

  @Post('requests/:id/comments')
  @RequirePermissions('offgrid.project.write')
  commentRequest(@Param('id', ParseUUIDPipe) id: string, @Body() body: CommentDto) {
    return this.requests.comment(id, body.text);
  }

  // ---- Projetos ----

  @Get('projects')
  @RequirePermissions('offgrid.project.read')
  listProjects(@Query() query: ListProjectsDto) {
    return this.projects.list(query);
  }

  @Post('projects')
  @RequirePermissions('offgrid.project.write')
  createProject(@Body() body: CreateProjectDto) {
    return this.projects.create(body);
  }

  @Get('projects/:id')
  @RequirePermissions('offgrid.project.read')
  projectDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.detail(id);
  }

  @Patch('projects/:id')
  @RequirePermissions('offgrid.project.write')
  updateProject(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProjectDto) {
    return this.projects.update(id, body);
  }

  // ---- Versões ----

  @Get('versions/:id')
  @RequirePermissions('offgrid.project.read')
  version(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.versionDetail(id);
  }

  @Put('versions/:id/design')
  @RequirePermissions('offgrid.project.write')
  saveDesign(@Param('id', ParseUUIDPipe) id: string, @Body() body: SaveDesignDto) {
    return this.projects.saveDesign(id, body.design);
  }

  @Post('versions/:id/recalculate')
  @RequirePermissions('offgrid.project.write')
  recalculate(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.recalculate(id);
  }

  @Post('versions/:id/suggest')
  @RequirePermissions('offgrid.project.write')
  suggest(@Param('id', ParseUUIDPipe) id: string, @Body() body: SuggestDto) {
    return this.projects.suggest(id, body.design, body.limit);
  }

  @Post('versions/:id/submit')
  @RequirePermissions('offgrid.project.write')
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.submit(id);
  }

  @Post('versions/:id/new-version')
  @RequirePermissions('offgrid.project.write')
  newVersion(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.createFrom(id);
  }

  @Delete('versions/:id')
  @HttpCode(204)
  @RequirePermissions('offgrid.project.write')
  async deleteDraft(@Param('id', ParseUUIDPipe) id: string) {
    await this.projects.deleteDraft(id);
  }

  @Get('versions/:id/comments')
  @RequirePermissions('offgrid.project.read')
  comments(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.comments(id);
  }

  @Post('versions/:id/comments')
  @RequirePermissions('offgrid.scenario.approve')
  addComment(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewCommentDto) {
    return this.projects.addComment(id, body);
  }

  @Post('versions/:id/comments/:commentId/resolve')
  @RequirePermissions('offgrid.project.write')
  resolveComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.projects.resolveComment(id, commentId);
  }

  @Post('versions/:id/approve')
  @RequirePermissions('offgrid.scenario.approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.projects.approve(id, body.note);
  }

  @Post('versions/:id/reject')
  @RequirePermissions('offgrid.scenario.approve')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.projects.reject(id, body.note);
  }

  @Get('versions/:id/report.pdf')
  @RequirePermissions('offgrid.project.read')
  async report(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.projects.reportPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }
}
