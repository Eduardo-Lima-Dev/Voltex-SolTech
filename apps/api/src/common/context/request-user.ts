import type { Permission, Role } from '@voltex/shared';

/** Usuário autenticado, montado pelo JwtAuthGuard a partir do token e do estado atual no banco. */
export interface RequestUser {
  id: string;
  tenantId: string;
  tenantName: string;
  role: Role;
  name: string;
  email: string;
  permissions: readonly Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}
