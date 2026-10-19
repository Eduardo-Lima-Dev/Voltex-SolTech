import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Role, permissionsForRole } from '@voltex/shared';
import { AUTHENTICATED_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../common/decorators';
import type { RequestUser } from '../../common/context/request-user';
import { PermissionsGuard } from './permissions.guard';

type Meta = { public?: boolean; permissions?: string[]; authenticated?: boolean };

function run(meta: Meta, role?: Role): boolean {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === IS_PUBLIC_KEY) return meta.public;
      if (key === PERMISSIONS_KEY) return meta.permissions;
      if (key === AUTHENTICATED_KEY) return meta.authenticated;
      return undefined;
    },
  } as unknown as Reflector;
  const user: RequestUser | undefined = role
    ? {
        id: 'u',
        tenantId: 't',
        tenantName: 'T',
        role,
        name: 'n',
        email: 'e',
        permissions: permissionsForRole(role),
      }
    : undefined;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user, originalUrl: '/api/v1/teste' }) }),
  } as unknown as ExecutionContext;
  return new PermissionsGuard(reflector).canActivate(context);
}

describe('PermissionsGuard (negado por padrão)', () => {
  it('rota pública passa sem usuário', () => {
    expect(run({ public: true })).toBe(true);
  });

  it('rota sem nenhuma declaração é NEGADA, mesmo para o OWNER', () => {
    expect(() => run({}, Role.OWNER)).toThrow(ForbiddenException);
  });

  it('@Authenticated() libera qualquer usuário autenticado', () => {
    expect(run({ authenticated: true }, Role.CUSTOMER)).toBe(true);
  });

  it('exige TODAS as permissões declaradas', () => {
    expect(run({ permissions: ['platform.user.read'] }, Role.OWNER)).toBe(true);
    expect(() =>
      run({ permissions: ['platform.user.read', 'crm.margin.approve'] }, Role.SALESPERSON),
    ).toThrow(ForbiddenException);
    expect(() => run({ permissions: ['platform.user.manage'] }, Role.SDR)).toThrow(/insuficiente/);
  });

  it('permissão exigida sem usuário é negada', () => {
    expect(() => run({ permissions: ['platform.user.read'] })).toThrow(ForbiddenException);
  });
});
