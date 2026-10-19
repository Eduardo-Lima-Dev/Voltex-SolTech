import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { createHomologationChecklistSchema } from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { HomologationRulesService } from './homologation-rules.service';

class CreateChecklistDto extends createZodDto(createHomologationChecklistSchema) {}
class EffectiveQueryDto extends createZodDto(z.object({ distributorId: z.uuid().optional() })) {}

@ApiTags('CRM · Regras de homologação')
@ApiBearerAuth()
@Controller('homologation/checklists')
export class HomologationRulesController {
  constructor(private readonly rules: HomologationRulesService) {}

  @Get()
  @RequirePermissions('platform.rule.read')
  list() {
    return this.rules.list();
  }

  /** Regra que valeria hoje para a distribuidora informada (ou o padrão da empresa). */
  @Get('effective')
  @RequirePermissions('platform.rule.read')
  effective(@Query() query: EffectiveQueryDto) {
    return this.rules.resolve(query.distributorId ?? null);
  }

  @Post()
  @RequirePermissions('platform.rule.manage')
  publish(@Body() body: CreateChecklistDto) {
    return this.rules.publish(body);
  }
}
