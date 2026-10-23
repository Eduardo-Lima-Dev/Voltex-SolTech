import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { loginSchema, type CurrentUser as CurrentUserDto } from '@voltex/shared';
import { Authenticated, CurrentUser, Public } from '../../common/decorators';
import type { RequestUser } from '../../common/context/request-user';
import { AuthService } from './auth.service';
import { SessionCookieService } from './session-cookie.service';

class LoginDto extends createZodDto(loginSchema) {}

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body, this.meta(req));
    // Desafio do segundo fator: ainda não há sessão, nem cookie.
    if ('mfaToken' in result) return result;
    return this.cookies.respond(res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.cookies.read(req);
    if (!token) throw new UnauthorizedException('Sessão ausente');
    const session = await this.auth.refresh(token, this.meta(req));
    return this.cookies.respond(res, session);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.cookies.read(req));
    this.cookies.clear(res);
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  me(@CurrentUser() user: RequestUser): CurrentUserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: user.tenantName,
      permissions: [...user.permissions],
    };
  }

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
