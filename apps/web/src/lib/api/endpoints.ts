import {
  ROUTES,
  type AcceptInvitationInput,
  type AuditLogDto,
  type BranchDto,
  type CreateBranchInput,
  type CreateInvitationInput,
  type CreateTeamInput,
  type CreatedInvitationDto,
  type InvitationDto,
  type ListAuditLogsQuery,
  type ListUsersQuery,
  type LoginInput,
  type Paginated,
  type SessionResponse,
  type TeamDto,
  type TenantDto,
  type UpdateBranchInput,
  type UpdateTeamInput,
  type UpdateTenantInput,
  type UpdateUserInput,
  type UserSummary,
  type HealthResponse,
} from '@voltex/shared';
import { api as defaultClient } from './index';
import type { ApiClient, QueryParams } from './client';

/** Filtros de auditoria como chegam da URL (datas em string; a API converte). */
export type AuditQuery = Partial<Omit<ListAuditLogsQuery, 'from' | 'to'>> & {
  from?: string;
  to?: string;
};

/** Todas as chamadas à API, tipadas com os contratos de `@voltex/shared`. */
export function createEndpoints(client: ApiClient) {
  return {
    auth: {
      login: (input: LoginInput) =>
        client.post<SessionResponse>(ROUTES.auth.login, input, { auth: false }),
      logout: () => client.post<void>(ROUTES.auth.logout, undefined, { auth: false }),
      acceptInvitation: (input: AcceptInvitationInput) =>
        client.post<SessionResponse>(ROUTES.invitations.accept, input, { auth: false }),
    },
    health: () => client.get<HealthResponse>(ROUTES.health, { auth: false }),
    tenant: {
      get: () => client.get<TenantDto>(ROUTES.tenant),
      update: (input: UpdateTenantInput) => client.patch<TenantDto>(ROUTES.tenant, input),
    },
    branches: {
      list: () => client.get<BranchDto[]>(ROUTES.branches),
      create: (input: CreateBranchInput) => client.post<BranchDto>(ROUTES.branches, input),
      update: (id: string, input: UpdateBranchInput) =>
        client.patch<BranchDto>(`${ROUTES.branches}/${id}`, input),
      remove: (id: string) => client.delete<BranchDto>(`${ROUTES.branches}/${id}`),
    },
    teams: {
      list: () => client.get<TeamDto[]>(ROUTES.teams),
      create: (input: CreateTeamInput) => client.post<TeamDto>(ROUTES.teams, input),
      update: (id: string, input: UpdateTeamInput) =>
        client.patch<TeamDto>(`${ROUTES.teams}/${id}`, input),
      remove: (id: string) => client.delete<TeamDto>(`${ROUTES.teams}/${id}`),
    },
    users: {
      list: (query: Partial<ListUsersQuery> & { isActive?: boolean }) =>
        client.get<Paginated<UserSummary>>(ROUTES.users, { query: query as QueryParams }),
      update: (id: string, input: UpdateUserInput) =>
        client.patch<UserSummary>(`${ROUTES.users}/${id}`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.users}/${id}`),
    },
    invitations: {
      list: () => client.get<InvitationDto[]>(ROUTES.invitations.base),
      create: (input: CreateInvitationInput) =>
        client.post<CreatedInvitationDto>(ROUTES.invitations.base, input),
      revoke: (id: string) => client.delete<{ id: string }>(`${ROUTES.invitations.base}/${id}`),
    },
    audit: {
      list: (query: AuditQuery) =>
        client.get<Paginated<AuditLogDto>>(ROUTES.auditLogs, { query: query as QueryParams }),
    },
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
export const endpoints = createEndpoints(defaultClient);
