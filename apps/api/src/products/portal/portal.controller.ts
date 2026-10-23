import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import type { Request, Response } from 'express';
import {
  addPortalTicketCommentSchema,
  createPortalTicketSchema,
  exchangePortalTokenSchema,
  portalAcceptanceSchema,
  portalUploadNoteSchema,
  requestPortalLinkSchema,
} from '@voltex/shared';
import { Public } from '../../common/decorators';
import type { Env } from '../../config/env';
import type { UploadedFile as UploadedFileType } from '../../platform/documents/documents.service';
import { PortalAuthService, type PortalPrincipal } from './portal-auth.service';
import { PORTAL_COOKIE, PORTAL_COOKIE_PATH } from './portal.constants';
import { CurrentPortal, PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';

class RequestLinkDto extends createZodDto(requestPortalLinkSchema) {}
class ExchangeDto extends createZodDto(exchangePortalTokenSchema) {}
class CreateTicketDto extends createZodDto(createPortalTicketSchema) {}
class CommentDto extends createZodDto(addPortalTicketCommentSchema) {}
class AcceptanceDto extends createZodDto(portalAcceptanceSchema) {}
class UploadNoteDto extends createZodDto(portalUploadNoteSchema) {}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/** Entrada do cliente (sem sessão): pedir o link e trocar o link pela sessão. */
@ApiTags('Portal do cliente')
@Controller('public/portal')
export class PortalPublicController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** A resposta é sempre a mesma: não revela se o e-mail tem acesso. */
  @Post('request-link')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestLink(@Body() body: RequestLinkDto) {
    await this.auth.requestLinks(body.email);
    return { message: 'Se este e-mail tiver acesso ao portal, enviamos um link para ele.' };
  }

  @Post('exchange')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async exchange(
    @Body() body: ExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.exchange(body.token, meta(req));
    res.cookie(PORTAL_COOKIE, session.sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: PORTAL_COOKIE_PATH,
      expires: session.expiresAt,
    });
    return { expiresAt: session.expiresAt.toISOString() };
  }
}

/** Área do cliente: exige a sessão do portal (cookie próprio, separado do login interno). */
@ApiTags('Portal do cliente')
@Controller('portal')
@Public()
@UseGuards(PortalGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly auth: PortalAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('me')
  me(@CurrentPortal() who: PortalPrincipal) {
    return this.portal.me(who);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPortal() who: PortalPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(who.sessionId);
    res.clearCookie(PORTAL_COOKIE, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: PORTAL_COOKIE_PATH,
    });
  }

  @Get('projects')
  projects(@CurrentPortal() who: PortalPrincipal) {
    return this.portal.projects(who);
  }

  @Get('projects/:id')
  project(@CurrentPortal() who: PortalPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.project(who, id);
  }

  @Get('projects/:id/documents/:documentId/download')
  download(
    @CurrentPortal() who: PortalPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.portal.downloadUrl(who, id, documentId);
  }

  @Post('projects/:id/acceptance')
  @HttpCode(200)
  accept(
    @CurrentPortal() who: PortalPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcceptanceDto,
    @Req() req: Request,
  ) {
    return this.portal.accept(who, id, body, meta(req));
  }

  @Post('projects/:id/uploads')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentPortal() who: PortalPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileType | undefined,
    @Body() body: UploadNoteDto,
  ) {
    return this.portal.upload(who, id, file, body.note);
  }

  @Get('tickets')
  tickets(@CurrentPortal() who: PortalPrincipal) {
    return this.portal.listTickets(who);
  }

  @Post('tickets')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createTicket(@CurrentPortal() who: PortalPrincipal, @Body() body: CreateTicketDto) {
    return this.portal.createTicket(who, body);
  }

  @Get('tickets/:id')
  ticket(@CurrentPortal() who: PortalPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.ticket(who, id);
  }

  @Post('tickets/:id/comments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  comment(
    @CurrentPortal() who: PortalPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CommentDto,
  ) {
    return this.portal.commentTicket(who, id, body);
  }
}
