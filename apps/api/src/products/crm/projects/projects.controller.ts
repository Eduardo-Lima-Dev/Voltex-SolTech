import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  changeProjectStatusSchema,
  listProjectsQuerySchema,
  updateChecklistItemSchema,
  updateProjectSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { ProjectsService } from './projects.service';

class ListProjectsDto extends createZodDto(listProjectsQuerySchema) {}
class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
class UpdateChecklistItemDto extends createZodDto(updateChecklistItemSchema) {}
class ChangeStatusDto extends createZodDto(changeProjectStatusSchema) {}

@ApiTags('CRM · Projetos e homologação')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  @RequirePermissions('crm.project.read')
  list(@Query() query: ListProjectsDto) {
    return this.projects.list(query);
  }

  @Get('projects/:id')
  @RequirePermissions('crm.project.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(id);
  }

  @Get('opportunities/:id/project')
  @RequirePermissions('crm.project.read')
  byOpportunity(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.getByOpportunity(id);
  }

  @Patch('projects/:id')
  @RequirePermissions('crm.project.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProjectDto) {
    return this.projects.update(id, body);
  }

  @Patch('projects/:id/checklist/:itemId')
  @RequirePermissions('crm.project.write')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpdateChecklistItemDto,
  ) {
    return this.projects.updateChecklistItem(id, itemId, body);
  }

  @Post('projects/:id/status')
  @HttpCode(200)
  @RequirePermissions('crm.project.write')
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeStatusDto) {
    return this.projects.changeStatus(id, body);
  }
}
