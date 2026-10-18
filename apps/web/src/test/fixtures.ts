import {
  permissionsForRole,
  type BranchDto,
  type CurrentUser,
  type Role,
  type SessionResponse,
  type TeamDto,
  type UserSummary,
} from '@voltex/shared';

export const API = 'http://api.test/api/v1';

export function makeUser(role: Role = 'OWNER', overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: `user-${role.toLowerCase()}`,
    name: 'Eduardo Silva',
    email: `${role.toLowerCase()}@voltex.test`,
    role,
    tenantId: 'tenant-1',
    tenantName: 'Voltex Demo',
    permissions: [...permissionsForRole(role)],
    ...overrides,
  };
}

export function makeSession(
  role: Role = 'OWNER',
  overrides: Partial<CurrentUser> = {},
): SessionResponse {
  return { accessToken: `token-${role}`, expiresIn: 900, user: makeUser(role, overrides) };
}

const now = '2026-10-18T12:00:00.000Z';

export function makeUserSummary(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: 'u-1',
    name: 'Ana Admin',
    email: 'ana@voltex.test',
    role: 'ADMIN',
    isActive: true,
    branchId: null,
    teamId: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export const branch = (overrides: Partial<BranchDto> = {}): BranchDto => ({
  id: 'b-1',
  tenantId: 'tenant-1',
  name: 'Matriz',
  city: 'Fortaleza',
  state: 'CE',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

export const team = (overrides: Partial<TeamDto> = {}): TeamDto => ({
  id: 't-1',
  tenantId: 'tenant-1',
  branchId: 'b-1',
  name: 'Comercial',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
