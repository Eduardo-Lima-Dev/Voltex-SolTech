import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { acceptProposalSchema, brandingSchema, createProposalSchema } from '@voltex/shared';
import { Authenticated, Public, RequirePermissions } from '../../../common/decorators';
import { BrandingService } from './branding.service';
import { ProposalsService } from './proposals.service';

class CreateProposalDto extends createZodDto(createProposalSchema) {}
class AcceptProposalDto extends createZodDto(acceptProposalSchema) {}
class BrandingDto extends createZodDto(brandingSchema) {}

@ApiTags('CRM · Propostas')
@ApiBearerAuth()
@Controller()
export class ProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly branding: BrandingService,
  ) {}

  @Get('opportunities/:id/proposals')
  @RequirePermissions('crm.proposal.read')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.list(id);
  }

  @Post('opportunities/:id/proposals')
  @RequirePermissions('crm.proposal.write')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateProposalDto) {
    return this.proposals.create(id, body);
  }

  @Get('proposals/:id')
  @RequirePermissions('crm.proposal.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.get(id);
  }

  /** Cria o link público (o anterior deixa de funcionar) e marca a proposta como enviada. */
  @Post('proposals/:id/send')
  @HttpCode(200)
  @RequirePermissions('crm.proposal.write')
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.send(id);
  }

  @Get('proposals/:id/pdf-url')
  @RequirePermissions('crm.proposal.read')
  pdfUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.pdfUrl(id);
  }

  @Post('proposals/:id/pdf')
  @HttpCode(200)
  @RequirePermissions('crm.proposal.write')
  regeneratePdf(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.regeneratePdf(id);
  }

  // ---- Identidade visual da empresa ----

  @Get('branding')
  @Authenticated()
  getBranding() {
    return this.branding.get();
  }

  @Put('branding')
  @RequirePermissions('platform.tenant.manage')
  updateBranding(@Body() body: BrandingDto) {
    return this.branding.update(body);
  }
}

/** Página pública da proposta (link com token): sem login, com limite de requisições. */
@ApiTags('CRM · Proposta pública')
@Controller('public/proposals')
export class PublicProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get(':token')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  open(@Param('token') token: string) {
    return this.proposals.openPublic(token);
  }

  @Post(':token/accept')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(@Param('token') token: string, @Body() body: AcceptProposalDto, @Req() req: Request) {
    return this.proposals.acceptPublic(token, body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get(':token/pdf')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async pdf(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.proposals.publicPdf(token);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }

  @Get(':token/logo')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async logo(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, mimeType } = await this.proposals.publicLogo(token);
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, max-age=300' });
    return new StreamableFile(buffer);
  }
}
