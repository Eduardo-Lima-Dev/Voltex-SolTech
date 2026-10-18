import { describe, expect, it } from 'vitest';
import { Role } from '@voltex/shared';
import { canManageRole } from './role-policy';

describe('canManageRole', () => {
  it('OWNER gerencia qualquer perfil', () => {
    for (const role of Object.values(Role)) expect(canManageRole(Role.OWNER, role)).toBe(true);
  });

  it('ADMIN gerencia todos, menos OWNER', () => {
    expect(canManageRole(Role.ADMIN, Role.ADMIN)).toBe(true);
    expect(canManageRole(Role.ADMIN, Role.SALESPERSON)).toBe(true);
    expect(canManageRole(Role.ADMIN, Role.OWNER)).toBe(false);
  });

  it('demais perfis não gerenciam ninguém', () => {
    for (const actor of Object.values(Role).filter((r) => r !== Role.OWNER && r !== Role.ADMIN)) {
      for (const target of Object.values(Role)) expect(canManageRole(actor, target)).toBe(false);
    }
  });
});
