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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  changeStageSchema,
  createNoteSchema,
  createCustomStageSchema,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  OpportunityStatus,
  updateOpportunitySchema,
  updateCustomStageSchema,
  updatePipelineStageSchema,
} from '@voltex/shared';
import { createCalculationSchema } from '@voltex/solar-engine';
import { RequirePermissions } from '../../common/decorators';
import { OpportunitiesService } from './opportunities.service';
import { PipelineService } from './pipeline.service';

class CreateOpportunityDto extends createZodDto(createOpportunitySchema) {}
class UpdateOpportunityDto extends createZodDto(updateOpportunitySchema) {}
class ChangeStageDto extends createZodDto(changeStageSchema) {}
class ListOpportunitiesQueryDto extends createZodDto(listOpportunitiesQuerySchema) {}
class CreateNoteDto extends createZodDto(createNoteSchema) {}
class UpdatePipelineStageDto extends createZodDto(updatePipelineStageSchema) {}
class CreateCustomStageDto extends createZodDto(createCustomStageSchema) {}
class UpdateCustomStageDto extends createZodDto(updateCustomStageSchema) {}
class CreateCalculationDto extends createZodDto(createCalculationSchema) {}
class LinkCalculationDto extends createZodDto(z.object({ sessionId: z.uuid() })) {}
class BoardQueryDto extends createZodDto(
  z.object({
    ownerId: z.uuid().optional(),
    search: z.string().trim().min(1).max(120).optional(),
    status: z.enum(OpportunityStatus).optional(),
  }),
) {}

@ApiTags('CRM · Pipeline')
@ApiBearerAuth()
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get()
  @RequirePermissions('crm.opportunity.read')
  list() {
    return this.pipeline.list();
  }

  @Patch('stages/:id')
  @RequirePermissions('crm.pipeline.manage')
  updateStage(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePipelineStageDto) {
    return this.pipeline.updateStage(id, body);
  }

  @Get('custom-stages')
  @RequirePermissions('crm.opportunity.read')
  customStages() {
    return this.pipeline.customStages();
  }

  @Post('custom-stages')
  @RequirePermissions('crm.pipeline.manage')
  createCustomStage(@Body() body: CreateCustomStageDto) {
    return this.pipeline.createCustom(body);
  }

  @Patch('custom-stages/:id')
  @RequirePermissions('crm.pipeline.manage')
  updateCustomStage(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCustomStageDto) {
    return this.pipeline.updateCustom(id, body);
  }

  @Delete('custom-stages/:id')
  @RequirePermissions('crm.pipeline.manage')
  removeCustomStage(@Param('id', ParseUUIDPipe) id: string) {
    return this.pipeline.removeCustom(id);
  }
}

@ApiTags('CRM · Oportunidades')
@ApiBearerAuth()
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  @RequirePermissions('crm.opportunity.read')
  list(@Query() query: ListOpportunitiesQueryDto) {
    return this.opportunities.list(query);
  }

  @Get('board')
  @RequirePermissions('crm.opportunity.read')
  board(@Query() query: BoardQueryDto) {
    return this.opportunities.board(query);
  }

  @Post()
  @RequirePermissions('crm.opportunity.write')
  create(@Body() body: CreateOpportunityDto) {
    return this.opportunities.create(body);
  }

  @Get(':id')
  @RequirePermissions('crm.opportunity.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.get(id);
  }

  @Patch(':id')
  @RequirePermissions('crm.opportunity.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOpportunityDto) {
    return this.opportunities.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('crm.opportunity.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.remove(id);
  }

  @Post(':id/stage')
  @HttpCode(200)
  @RequirePermissions('crm.opportunity.write')
  changeStage(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeStageDto) {
    return this.opportunities.changeStage(id, body);
  }

  @Get(':id/timeline')
  @RequirePermissions('crm.opportunity.read')
  timeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.timelineOf(id);
  }

  @Post(':id/notes')
  @RequirePermissions('crm.opportunity.write')
  addNote(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNoteDto) {
    return this.opportunities.addNote(id, body.body);
  }

  // ---- Solar Calculator ----

  @Get(':id/calculation-context')
  @RequirePermissions('crm.opportunity.read', 'calculator.session.read')
  calculationContext(@Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.calculationContext(id);
  }

  @Get(':id/calculations')
  @RequirePermissions('crm.opportunity.read', 'calculator.session.read')
  listCalculations(@Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.listCalculations(id);
  }

  @Post(':id/calculations')
  @RequirePermissions('crm.opportunity.write', 'calculator.session.create')
  createCalculation(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateCalculationDto) {
    return this.opportunities.createCalculation(id, body);
  }

  @Post(':id/calculations/link')
  @HttpCode(200)
  @RequirePermissions('crm.opportunity.write', 'calculator.session.read')
  linkCalculation(@Param('id', ParseUUIDPipe) id: string, @Body() body: LinkCalculationDto) {
    return this.opportunities.linkCalculation(id, body.sessionId);
  }

  @Get(':id/engineering-requests')
  @RequirePermissions('crm.opportunity.read')
  engineeringRequests(@Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.listEngineeringRequests(id);
  }
}
