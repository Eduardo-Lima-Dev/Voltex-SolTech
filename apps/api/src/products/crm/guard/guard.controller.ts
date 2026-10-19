import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { overrideGuardSchema } from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { GuardService } from './guard.service';

class OverrideGuardDto extends createZodDto(overrideGuardSchema) {}

/** Project Guard: triagem técnico-comercial. É triagem, nunca homologação nem aprovação técnica (ADR-0014). */
@ApiTags('CRM · Triagem (Project Guard)')
@ApiBearerAuth()
@Controller('opportunities/:id/guard')
export class GuardController {
  constructor(private readonly guard: GuardService) {}

  @Get()
  @RequirePermissions('crm.guard.read')
  overview(@Param('id', ParseUUIDPipe) id: string) {
    return this.guard.overview(id);
  }

  @Post('evaluate')
  @HttpCode(200)
  @RequirePermissions('crm.guard.evaluate')
  evaluate(@Param('id', ParseUUIDPipe) id: string) {
    return this.guard.evaluate(id);
  }

  @Post('override')
  @HttpCode(200)
  @RequirePermissions('crm.guard.review')
  override(@Param('id', ParseUUIDPipe) id: string, @Body() body: OverrideGuardDto) {
    return this.guard.override(id, body);
  }
}
