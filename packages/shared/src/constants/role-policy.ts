import { Role } from '../enums/index.js';

/**
 * Quem pode conceder/gerenciar cada perfil. OWNER gerencia tudo; ADMIN gerencia tudo, exceto OWNER.
 * Demais perfis não gerenciam usuários. Evita escalada de privilégio por convite ou edição.
 *
 * A API aplica a regra (fonte da verdade); o front a usa só para não oferecer ações que seriam recusadas.
 */
export const canManageRole = (actor: Role, target: Role): boolean => {
  if (actor === Role.OWNER) return true;
  if (actor === Role.ADMIN) return target !== Role.OWNER;
  return false;
};

/** Perfis que `actor` pode atribuir em convites e edições. */
export const assignableRoles = (actor: Role): Role[] =>
  Object.values(Role).filter((target) => canManageRole(actor, target));
