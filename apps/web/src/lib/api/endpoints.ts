import type {
  CalculationSessionDto,
  CalculatorConfigDto,
  CreateCalculationInput,
  CreateSnapshotInput,
  QuickCalculationSnapshotDto,
} from '@voltex/solar-engine';
import {
  ROUTES,
  type AcceptInvitationInput,
  type ActivateRuleSetInput,
  type AvailabilityCost,
  type RuleSource,
  type Thresholds,
  type CreateDistributorInput,
  type CreateRuleSetInput,
  type CreateSolarResourceInput,
  type CreateTariffInput,
  type DistributorDto,
  type ImportSolarResourcesInput,
  type ListCalculationsQuery,
  type RuleSetDto,
  type SolarResourceDto,
  type TariffDto,
  type UpdateDistributorInput,
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

/** Regra em vigor (ativa ou padrão do produto), como devolvida por `GET /rules/effective`. */
export interface EffectiveRulesDto {
  ref: string;
  key: string;
  thresholds: Thresholds;
  availabilityCostKwh: AvailabilityCost;
  sources: RuleSource[];
}

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
    calculator: {
      config: () => client.get<CalculatorConfigDto>(`${ROUTES.calculations.quick}/config`),
      list: (query: Partial<ListCalculationsQuery>) =>
        client.get<Paginated<CalculationSessionDto>>(ROUTES.calculations.quick, {
          query: query as QueryParams,
        }),
      get: (id: string) => client.get<CalculationSessionDto>(ROUTES.calculations.quickById(id)),
      getSnapshot: (snapshotId: string) =>
        client.get<QuickCalculationSnapshotDto>(
          `${ROUTES.calculations.quick}/snapshots/${snapshotId}`,
        ),
      create: (input: CreateCalculationInput) =>
        client.post<CalculationSessionDto>(ROUTES.calculations.quick, input),
      createSnapshot: (id: string, input: CreateSnapshotInput) =>
        client.post<QuickCalculationSnapshotDto>(ROUTES.calculations.quickSnapshot(id), input),
      listSnapshots: (id: string) =>
        client.get<QuickCalculationSnapshotDto[]>(`${ROUTES.calculations.quickById(id)}/snapshots`),
    },
    distributors: {
      list: () => client.get<DistributorDto[]>(ROUTES.distributors),
      create: (input: CreateDistributorInput) =>
        client.post<DistributorDto>(ROUTES.distributors, input),
      update: (id: string, input: UpdateDistributorInput) =>
        client.patch<DistributorDto>(`${ROUTES.distributors}/${id}`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.distributors}/${id}`),
    },
    tariffs: {
      list: (query: { distributorId?: string; customerGroup?: string } = {}) =>
        client.get<TariffDto[]>(ROUTES.tariffs, { query }),
      create: (input: CreateTariffInput) => client.post<TariffDto>(ROUTES.tariffs, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.tariffs}/${id}`),
    },
    solarResources: {
      list: (query: { page?: number; pageSize?: number; search?: string } = {}) =>
        client.get<Paginated<SolarResourceDto>>(ROUTES.solarResources, { query }),
      create: (input: CreateSolarResourceInput) =>
        client.post<SolarResourceDto>(ROUTES.solarResources, input),
      import: (input: ImportSolarResourcesInput) =>
        client.post<{ created: number; updated: number }>(`${ROUTES.solarResources}/import`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.solarResources}/${id}`),
    },
    rules: {
      list: () => client.get<RuleSetDto[]>(ROUTES.rules),
      effective: () => client.get<EffectiveRulesDto>(`${ROUTES.rules}/effective`),
      create: (input: CreateRuleSetInput) => client.post<RuleSetDto>(ROUTES.rules, input),
      activate: (id: string, input: ActivateRuleSetInput) =>
        client.post<RuleSetDto>(`${ROUTES.rules}/${id}/activate`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.rules}/${id}`),
    },
    audit: {
      list: (query: AuditQuery) =>
        client.get<Paginated<AuditLogDto>>(ROUTES.auditLogs, { query: query as QueryParams }),
    },
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
export const endpoints = createEndpoints(defaultClient);
