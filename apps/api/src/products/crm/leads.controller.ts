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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import {
  convertLeadSchema,
  createLeadSchema,
  importLeadsSchema,
  listLeadsQuerySchema,
  publicLeadSchema,
  updateLeadSchema,
} from '@voltex/shared';
import { Public, RequirePermissions } from '../../common/decorators';
import { LeadsService } from './leads.service';

class CreateLeadDto extends createZodDto(createLeadSchema) {}
class UpdateLeadDto extends createZodDto(updateLeadSchema) {}
class ImportLeadsDto extends createZodDto(importLeadsSchema) {}
class ConvertLeadDto extends createZodDto(convertLeadSchema) {}
class ListLeadsQueryDto extends createZodDto(listLeadsQuerySchema) {}
class PublicLeadDto extends createZodDto(publicLeadSchema) {}

@ApiTags('CRM · Leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermissions('crm.lead.read')
  list(@Query() query: ListLeadsQueryDto) {
    return this.leads.list(query);
  }

  @Post()
  @RequirePermissions('crm.lead.write')
  create(@Body() body: CreateLeadDto) {
    return this.leads.create(body);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions('crm.lead.write')
  import(@Body() body: ImportLeadsDto) {
    return this.leads.import(body.rows);
  }

  @Get(':id')
  @RequirePermissions('crm.lead.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @Patch(':id')
  @RequirePermissions('crm.lead.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateLeadDto) {
    return this.leads.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('crm.lead.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.remove(id);
  }

  @Post(':id/convert')
  @RequirePermissions('crm.lead.write', 'crm.account.write')
  convert(@Param('id', ParseUUIDPipe) id: string, @Body() body: ConvertLeadDto) {
    return this.leads.convert(id, body);
  }
}

@ApiTags('CRM · Captação de leads')
@ApiBearerAuth()
@Controller('lead-capture')
export class LeadCaptureController {
  constructor(private readonly leads: LeadsService) {}

  /** Chave do formulário público da empresa (usada na URL de captação). */
  @Get()
  @RequirePermissions('platform.tenant.manage')
  key() {
    return this.leads.captureKey();
  }

  @Post('rotate')
  @HttpCode(200)
  @RequirePermissions('platform.tenant.manage')
  rotate() {
    return this.leads.rotateCaptureKey();
  }
}

@ApiTags('CRM · Captação pública')
@Controller('public/leads')
export class PublicLeadsController {
  constructor(private readonly leads: LeadsService) {}

  /** Recebe um lead de formulário/landing. Sempre responde igual, para não revelar quem já é cliente. */
  @Post(':key')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async capture(@Param('key') key: string, @Body() body: PublicLeadDto, @Req() req: Request) {
    await this.leads.capturePublic(key, body, { ip: req.ip });
    return { ok: true };
  }
}
