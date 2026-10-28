import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { leadScoringConfigSchema } from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { LeadScoringService } from './lead-scoring.service';

class ConfigDto extends createZodDto(leadScoringConfigSchema) {}

/** Pontuação e distribuição de leads (RF-CRM-006): a empresa define critérios, pesos e quem recebe. */
@ApiTags('CRM · Pontuação de leads')
@ApiBearerAuth()
@Controller('lead-scoring')
export class LeadScoringController {
  constructor(private readonly scoring: LeadScoringService) {}

  @Get('config')
  @RequirePermissions('crm.lead.read')
  config() {
    return this.scoring.getConfig();
  }

  @Put('config')
  @RequirePermissions('crm.lead-scoring.manage')
  save(@Body() body: ConfigDto) {
    return this.scoring.setConfig(body);
  }

  @Post('rescore')
  @HttpCode(200)
  @RequirePermissions('crm.lead-scoring.manage')
  rescore() {
    return this.scoring.rescoreOpen();
  }
}
