import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import type { Session } from './auth.service';

export const REFRESH_COOKIE = 'voltex_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Cookie httpOnly do refresh token. O token nunca aparece no corpo JSON. */
@Injectable()
export class SessionCookieService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Grava o cookie e devolve o corpo da resposta (sem o refresh token). */
  respond(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.options(),
      expires: session.refreshExpiresAt,
    });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.options());
  }

  read(req: Request): string | undefined {
    return (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
  }

  private options() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: REFRESH_COOKIE_PATH,
    };
  }
}
