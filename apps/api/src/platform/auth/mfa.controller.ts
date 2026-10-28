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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import {
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaLoginConfirmSchema,
  mfaLoginSetupSchema,
  mfaPolicySchema,
  mfaVerifySchema,
} from '@voltex/shared';
import type { RequestUser } from '../../common/context/request-user';
import { Authenticated, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { MfaService, type MfaUser } from './mfa.service';
import { SessionCookieService } from './session-cookie.service';

class VerifyDto extends createZodDto(mfaVerifySchema) {}
class LoginSetupDto extends createZodDto(mfaLoginSetupSchema) {}
class LoginConfirmDto extends createZodDto(mfaLoginConfirmSchema) {}
class ConfirmDto extends createZodDto(mfaConfirmSchema) {}
class DisableDto extends createZodDto(mfaDisableSchema) {}
class PolicyDto extends createZodDto(mfaPolicySchema) {}

/** Segundo fator por aplicativo (RNF-SEG-011): etapa do login, cadastro, desativação e política da empresa. */
@ApiTags('Autenticação · Segundo fator')
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly cookies: SessionCookieService,
    private readonly prisma: PrismaService,
  ) {}

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private async me(user: RequestUser): Promise<MfaUser> {
    return this.prisma.system.user.findFirstOrThrow({
      where: { id: user.id, tenantId: user.tenantId, deletedAt: null },
      include: { tenant: true },
    });
  }

  // --- etapa do login (sem sessão ainda) -------------------------------------------------------------------

  @Public()
  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(
    @Body() body: VerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookies.respond(res, await this.auth.completeMfa(body, this.meta(req)));
  }

  @Public()
  @Post('login/setup')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  loginSetup(@Body() body: LoginSetupDto) {
    return this.auth.loginSetup(body.mfaToken);
  }

  @Public()
  @Post('login/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async loginConfirm(
    @Body() body: LoginConfirmDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, recovery } = await this.auth.loginConfirm(body, this.meta(req));
    return { ...this.cookies.respond(res, session), ...recovery };
  }

  // --- conta do usuário -------------------------------------------------------------------------------------

  @Get('status')
  @Authenticated()
  @ApiBearerAuth()
  async status(@CurrentUser() user: RequestUser) {
    return this.mfa.status(await this.me(user));
  }

  @Post('setup')
  @HttpCode(200)
  @Authenticated()
  @ApiBearerAuth()
  async setup(@CurrentUser() user: RequestUser) {
    return this.mfa.startSetup(await this.me(user));
  }

  @Post('confirm')
  @HttpCode(200)
  @Authenticated()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async confirm(@CurrentUser() user: RequestUser, @Body() body: ConfirmDto) {
    return this.mfa.confirmSetup(await this.me(user), body.code);
  }

  @Post('disable')
  @HttpCode(204)
  @Authenticated()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async disable(@CurrentUser() user: RequestUser, @Body() body: DisableDto): Promise<void> {
    await this.mfa.disable(await this.me(user), body.password, body.code);
  }

  // --- empresa e administração ------------------------------------------------------------------------------

  @Get('policy')
  @ApiBearerAuth()
  @RequirePermissions('platform.tenant.read')
  policy(@CurrentUser() user: RequestUser) {
    return this.mfa.getPolicy(user.tenantId);
  }

  @Put('policy')
  @ApiBearerAuth()
  @RequirePermissions('platform.tenant.manage')
  setPolicy(@CurrentUser() user: RequestUser, @Body() body: PolicyDto) {
    return this.mfa.setPolicy(user.tenantId, user.id, body);
  }

  /** Quem perdeu o aparelho e os códigos de recuperação: o administrador remove o segundo fator. */
  @Post('users/:id/reset')
  @HttpCode(204)
  @ApiBearerAuth()
  @RequirePermissions('platform.user.manage')
  async reset(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.mfa.adminReset(user.tenantId, id, user.id);
  }
}
