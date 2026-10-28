import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequestContext } from '../../common/context/request-context';
import { PortalAuthService, type PortalPrincipal } from './portal-auth.service';
import { PORTAL_COOKIE } from './portal.constants';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portal?: PortalPrincipal;
    }
  }
}

/**
 * Guarda das rotas do cliente (usadas junto de `@Public()`, que dispensa o login interno). Valida o cookie da sessão
 * do portal e fixa a empresa no contexto: as consultas continuam filtradas por tenant, e cada serviço filtra
 * também pela conta do cliente.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly context: RequestContext,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const request = execution.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const principal = await this.auth.authenticate(cookies?.[PORTAL_COOKIE]);
    request.portal = principal;
    this.context.set({ tenantId: principal.tenantId });
    return true;
  }
}

export const CurrentPortal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PortalPrincipal => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.portal) throw new Error('CurrentPortal usado fora de uma rota do portal');
    return request.portal;
  },
);
