import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '@voltex/shared';
import type { RequestUser } from '../context/request-user';

export const IS_PUBLIC_KEY = 'voltex:isPublic';
export const PERMISSIONS_KEY = 'voltex:permissions';
export const AUTHENTICATED_KEY = 'voltex:authenticated';
export const AUDIT_KEY = 'voltex:audit';

/** Rota aberta (sem token). Use com parcimônia: o padrão é negar. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Exige uma ou mais permissões (todas). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Exige apenas usuário autenticado, sem permissão específica (ex.: `GET /auth/me`). */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);

export interface AuditMetadata {
  action: string;
  entity: string;
}
/** Registra a resposta bem-sucedida da rota no audit log. */
export const Audit = (action: string, entity: string) =>
  SetMetadata(AUDIT_KEY, { action, entity } satisfies AuditMetadata);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) throw new Error('CurrentUser usado em rota sem autenticação');
    return request.user;
  },
);
