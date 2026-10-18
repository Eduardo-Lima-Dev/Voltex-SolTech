import { Role } from '@voltex/shared';

/**
 * Quem pode conceder/gerenciar cada perfil. OWNER gerencia tudo; ADMIN gerencia tudo, exceto OWNER.
 * Demais perfis não gerenciam usuários. Evita escalada de privilégio por convite ou edição.
 */
export const canManageRole = (actor: Role, target: Role): boolean => {
  if (actor === Role.OWNER) return true;
  if (actor === Role.ADMIN) return target !== Role.OWNER;
  return false;
};
