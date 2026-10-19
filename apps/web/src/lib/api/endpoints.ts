import type {
  SaveQuoteInput,
  UpdateQuoteInput,
  CalculationSessionDto,
  CalculatorConfigDto,
  CreateCalculationInput,
  CreateSnapshotInput,
  QuickCalculationSnapshotDto,
} from '@voltex/solar-engine';
import {
  ROUTES,
  type AcceptProposalInput,
  type CreateErasureInput,
  type PrivacyRequestDto,
  type RetentionPolicyDto,
  type RetentionPolicyInput,
  type CancelContractInput,
  type ChangeProjectStatusInput,
  type CommercialDashboardDto,
  type CommercialDashboardQuery,
  type ContractDto,
  type ContractTemplateDto,
  type CreateContractInput,
  type CreateHomologationChecklistInput,
  type HomologationChecklistDto,
  type HomologationRules,
  type ListProjectsQuery,
  type ProjectDto,
  type ProjectSummaryDto,
  type UpdateChecklistItemInput,
  type UpdateContractTemplateInput,
  type UpdateProjectInput,
  type ApprovalDto,
  type Branding,
  type CreateMarginPolicyInput,
  type CreateProposalInput,
  type DecideApprovalInput,
  type DocumentDto,
  type GuardEvaluationDto,
  type GuardOverviewDto,
  type ListApprovalsQuery,
  type MarginPolicyDto,
  type OverrideGuardInput,
  type ProposalDto,
  type PublicProposalDto,
  type QuoteDto,
  type RequestApprovalInput,
  type UpdateMarginPolicyInput,
  type AccountDetailDto,
  type AccountDto,
  type AneelImportResult,
  type ContactDto,
  type ConsumerUnitDto,
  type ConvertLeadInput,
  type ConvertLeadResult,
  type CreateAccountInput,
  type CreateConsumerUnitInput,
  type CreateContactInput,
  type CreateLeadInput,
  type CreateNoteInput,
  type CreateOpportunityInput,
  type CreateSiteInput,
  type CreateTaskInput,
  type EnergyBillDto,
  type EnergyBillSnapshotDto,
  type EngineeringRequestDto,
  type ImportLeadsInput,
  type ImportLeadsResult,
  type LeadDto,
  type ListAccountsQuery,
  type ListLeadsQuery,
  type ListOpportunitiesQuery,
  type ListTasksQuery,
  type OpportunityBoardDto,
  type OpportunityCalculationContext,
  type OpportunityDto,
  type PipelineStageDto,
  type RejectEnergyBillInput,
  type SiteDto,
  type TaskDto,
  type TimelineEventDto,
  type UpdateAccountInput,
  type UpdateConsumerUnitInput,
  type UpdateContactInput,
  type UpdateLeadInput,
  type UpdateOpportunityInput,
  type UpdatePipelineStageInput,
  type UpdateSiteInput,
  type UpdateTaskInput,
  type ValidateEnergyBillInput,
  type ChangeStageInput,
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
      /** Todos os dados da empresa (LGPD), em JSON. */
      export: () => client.get<Record<string, unknown>>(`${ROUTES.tenant}/export`),
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
    leads: {
      list: (query: Partial<ListLeadsQuery>) =>
        client.get<Paginated<LeadDto>>(ROUTES.leads, { query: query as QueryParams }),
      get: (id: string) => client.get<LeadDto>(`${ROUTES.leads}/${id}`),
      create: (input: CreateLeadInput) => client.post<LeadDto>(ROUTES.leads, input),
      update: (id: string, input: UpdateLeadInput) =>
        client.patch<LeadDto>(`${ROUTES.leads}/${id}`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.leads}/${id}`),
      import: (input: ImportLeadsInput) =>
        client.post<ImportLeadsResult>(`${ROUTES.leads}/import`, input),
      convert: (id: string, input: ConvertLeadInput) =>
        client.post<ConvertLeadResult>(`${ROUTES.leads}/${id}/convert`, input),
      captureKey: () => client.get<{ key: string }>('/lead-capture'),
      rotateCaptureKey: () => client.post<{ key: string }>('/lead-capture/rotate'),
    },
    accounts: {
      list: (query: Partial<ListAccountsQuery>) =>
        client.get<Paginated<AccountDto>>(ROUTES.accounts, { query: query as QueryParams }),
      get: (id: string) => client.get<AccountDetailDto>(`${ROUTES.accounts}/${id}`),
      create: (input: CreateAccountInput) => client.post<AccountDto>(ROUTES.accounts, input),
      update: (id: string, input: UpdateAccountInput) =>
        client.patch<AccountDto>(`${ROUTES.accounts}/${id}`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.accounts}/${id}`),
      addContact: (accountId: string, input: CreateContactInput) =>
        client.post<ContactDto>(`${ROUTES.accounts}/${accountId}/contacts`, input),
      updateContact: (id: string, input: UpdateContactInput) =>
        client.patch<ContactDto>(`/contacts/${id}`, input),
      removeContact: (id: string) => client.delete<{ id: string }>(`/contacts/${id}`),
      addSite: (accountId: string, input: CreateSiteInput) =>
        client.post<SiteDto>(`${ROUTES.accounts}/${accountId}/sites`, input),
      updateSite: (id: string, input: UpdateSiteInput) =>
        client.patch<SiteDto>(`${ROUTES.sites}/${id}`, input),
      removeSite: (id: string) => client.delete<{ id: string }>(`${ROUTES.sites}/${id}`),
      addConsumerUnit: (accountId: string, input: CreateConsumerUnitInput) =>
        client.post<ConsumerUnitDto>(`${ROUTES.accounts}/${accountId}/consumer-units`, input),
      updateConsumerUnit: (id: string, input: UpdateConsumerUnitInput) =>
        client.patch<ConsumerUnitDto>(`${ROUTES.consumerUnits}/${id}`, input),
      removeConsumerUnit: (id: string) =>
        client.delete<{ id: string }>(`${ROUTES.consumerUnits}/${id}`),
    },
    pipeline: {
      list: () => client.get<PipelineStageDto[]>(ROUTES.pipeline),
      updateStage: (id: string, input: UpdatePipelineStageInput) =>
        client.patch<PipelineStageDto>(`${ROUTES.pipeline}/stages/${id}`, input),
    },
    opportunities: {
      list: (query: Partial<ListOpportunitiesQuery>) =>
        client.get<Paginated<OpportunityDto>>(ROUTES.opportunities, {
          query: query as QueryParams,
        }),
      board: (filters: { ownerId?: string; search?: string; status?: string } = {}) =>
        client.get<OpportunityBoardDto>(`${ROUTES.opportunities}/board`, { query: filters }),
      get: (id: string) => client.get<OpportunityDto>(`${ROUTES.opportunities}/${id}`),
      create: (input: CreateOpportunityInput) =>
        client.post<OpportunityDto>(ROUTES.opportunities, input),
      update: (id: string, input: UpdateOpportunityInput) =>
        client.patch<OpportunityDto>(`${ROUTES.opportunities}/${id}`, input),
      changeStage: (id: string, input: ChangeStageInput) =>
        client.post<OpportunityDto>(`${ROUTES.opportunities}/${id}/stage`, input),
      timeline: (id: string) =>
        client.get<TimelineEventDto[]>(`${ROUTES.opportunities}/${id}/timeline`),
      addNote: (id: string, input: CreateNoteInput) =>
        client.post<{ ok: true }>(`${ROUTES.opportunities}/${id}/notes`, input),
      calculationContext: (id: string) =>
        client.get<OpportunityCalculationContext>(
          `${ROUTES.opportunities}/${id}/calculation-context`,
        ),
      calculations: (id: string) =>
        client.get<CalculationSessionDto[]>(`${ROUTES.opportunities}/${id}/calculations`),
      createCalculation: (id: string, input: CreateCalculationInput) =>
        client.post<CalculationSessionDto>(`${ROUTES.opportunities}/${id}/calculations`, input),
      linkCalculation: (id: string, sessionId: string) =>
        client.post<CalculationSessionDto>(`${ROUTES.opportunities}/${id}/calculations/link`, {
          sessionId,
        }),
      engineeringRequests: (id: string) =>
        client.get<EngineeringRequestDto[]>(`${ROUTES.opportunities}/${id}/engineering-requests`),
      guard: (id: string) => client.get<GuardOverviewDto>(`${ROUTES.opportunities}/${id}/guard`),
      evaluateGuard: (id: string) =>
        client.post<GuardEvaluationDto>(`${ROUTES.opportunities}/${id}/guard/evaluate`),
      overrideGuard: (id: string, input: OverrideGuardInput) =>
        client.post<GuardEvaluationDto>(`${ROUTES.opportunities}/${id}/guard/override`, input),
      quotes: (id: string) => client.get<QuoteDto[]>(`${ROUTES.opportunities}/${id}/quotes`),
      createQuote: (id: string, input: SaveQuoteInput) =>
        client.post<QuoteDto>(`${ROUTES.opportunities}/${id}/quotes`, input),
      proposals: (id: string) =>
        client.get<ProposalDto[]>(`${ROUTES.opportunities}/${id}/proposals`),
      createProposal: (id: string, input: CreateProposalInput) =>
        client.post<ProposalDto>(`${ROUTES.opportunities}/${id}/proposals`, input),
    },
    contracts: {
      template: () => client.get<ContractTemplateDto>(ROUTES.contractTemplate),
      uploadTemplate: (file: File, name?: string) => {
        const form = new FormData();
        form.append('file', file);
        if (name) form.append('name', name);
        return client.upload<ContractTemplateDto>(`${ROUTES.contractTemplate}/upload`, form);
      },
      templateFileUrl: () =>
        client.get<{ url: string; expiresIn: number }>(`${ROUTES.contractTemplate}/file-url`),
      saveTemplate: (input: UpdateContractTemplateInput) =>
        client.put<ContractTemplateDto>(ROUTES.contractTemplate, input),
      list: (opportunityId: string) =>
        client.get<ContractDto[]>(`${ROUTES.opportunities}/${opportunityId}/contracts`),
      generate: (opportunityId: string, input: CreateContractInput) =>
        client.post<ContractDto>(`${ROUTES.opportunities}/${opportunityId}/contracts`, input),
      cancel: (id: string, input: CancelContractInput) =>
        client.post<ContractDto>(`${ROUTES.contracts}/${id}/cancel`, input),
      pdfUrl: (id: string) =>
        client.get<{ url: string; expiresIn: number }>(`${ROUTES.contracts}/${id}/pdf-url`),
      signedUrl: (id: string) =>
        client.get<{ url: string; expiresIn: number }>(`${ROUTES.contracts}/${id}/signed-url`),
      sign: (id: string, file: File, fields: { signedAt?: string; signedByName?: string }) => {
        const form = new FormData();
        form.append('file', file);
        if (fields.signedAt) form.append('signedAt', fields.signedAt);
        if (fields.signedByName) form.append('signedByName', fields.signedByName);
        return client.upload<ContractDto>(`${ROUTES.contracts}/${id}/sign`, form);
      },
    },
    projects: {
      list: (query: Partial<ListProjectsQuery>) =>
        client.get<Paginated<ProjectSummaryDto>>(ROUTES.projects, { query: query as QueryParams }),
      get: (id: string) => client.get<ProjectDto>(`${ROUTES.projects}/${id}`),
      byOpportunity: (opportunityId: string) =>
        client.get<ProjectDto | null>(`${ROUTES.opportunities}/${opportunityId}/project`),
      update: (id: string, input: UpdateProjectInput) =>
        client.patch<ProjectDto>(`${ROUTES.projects}/${id}`, input),
      updateItem: (id: string, itemId: string, input: UpdateChecklistItemInput) =>
        client.patch<ProjectDto>(`${ROUTES.projects}/${id}/checklist/${itemId}`, input),
      changeStatus: (id: string, input: ChangeProjectStatusInput) =>
        client.post<ProjectDto>(`${ROUTES.projects}/${id}/status`, input),
    },
    homologation: {
      list: () => client.get<HomologationChecklistDto[]>(ROUTES.homologationChecklists),
      effective: (distributorId?: string) =>
        client.get<HomologationRules>(`${ROUTES.homologationChecklists}/effective`, {
          query: { distributorId },
        }),
      publish: (input: CreateHomologationChecklistInput) =>
        client.post<HomologationChecklistDto>(ROUTES.homologationChecklists, input),
    },
    dashboard: {
      commercial: (query: Partial<CommercialDashboardQuery>) =>
        client.get<CommercialDashboardDto>(ROUTES.commercialDashboard, {
          query: query as QueryParams,
        }),
    },
    quotes: {
      update: (id: string, input: UpdateQuoteInput) =>
        client.patch<QuoteDto>(`${ROUTES.quotes}/${id}`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.quotes}/${id}`),
      requestApproval: (id: string, input: RequestApprovalInput) =>
        client.post<QuoteDto>(`${ROUTES.quotes}/${id}/request-approval`, input),
    },
    approvals: {
      list: (query: Partial<ListApprovalsQuery>) =>
        client.get<Paginated<ApprovalDto>>(ROUTES.approvals, { query: query as QueryParams }),
      decide: (id: string, input: DecideApprovalInput) =>
        client.post<ApprovalDto>(`${ROUTES.approvals}/${id}/decide`, input),
    },
    marginPolicies: {
      list: () => client.get<MarginPolicyDto[]>(ROUTES.marginPolicies),
      create: (input: CreateMarginPolicyInput) =>
        client.post<MarginPolicyDto>(ROUTES.marginPolicies, input),
      update: (id: string, input: UpdateMarginPolicyInput) =>
        client.patch<MarginPolicyDto>(`${ROUTES.marginPolicies}/${id}`, input),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.marginPolicies}/${id}`),
    },
    proposals: {
      get: (id: string) => client.get<ProposalDto>(`${ROUTES.proposals}/${id}`),
      send: (id: string) => client.post<ProposalDto>(`${ROUTES.proposals}/${id}/send`),
      pdfUrl: (id: string) =>
        client.get<{ url: string; expiresIn: number }>(`${ROUTES.proposals}/${id}/pdf-url`),
      regeneratePdf: (id: string) => client.post<ProposalDto>(`${ROUTES.proposals}/${id}/pdf`),
    },
    publicProposals: {
      get: (token: string) =>
        client.get<PublicProposalDto>(`${ROUTES.publicProposals}/${token}`, { auth: false }),
      accept: (token: string, input: AcceptProposalInput) =>
        client.post<PublicProposalDto>(`${ROUTES.publicProposals}/${token}/accept`, input, {
          auth: false,
        }),
      pdfUrl: (token: string) => `${ROUTES.publicProposals}/${token}/pdf`,
      logoUrl: (token: string) => `${ROUTES.publicProposals}/${token}/logo`,
    },
    privacy: {
      policy: () => client.get<RetentionPolicyDto>(`${ROUTES.privacy}/retention`),
      updatePolicy: (input: RetentionPolicyInput) =>
        client.put<RetentionPolicyDto>(`${ROUTES.privacy}/retention`, input),
      erasures: (query: { page?: number; pageSize?: number } = {}) =>
        client.get<Paginated<PrivacyRequestDto>>(`${ROUTES.privacy}/erasures`, {
          query: query as QueryParams,
        }),
      erase: (input: CreateErasureInput) =>
        client.post<PrivacyRequestDto>(`${ROUTES.privacy}/erasures`, input),
    },
    documents: {
      upload: (file: File, target?: { entityType?: string; entityId?: string }) => {
        const form = new FormData();
        form.append('file', file);
        if (target?.entityType) form.append('entityType', target.entityType);
        if (target?.entityId) form.append('entityId', target.entityId);
        return client.upload<DocumentDto>('/documents', form);
      },
    },
    branding: {
      get: () => client.get<Branding>('/branding'),
      update: (input: Branding) => client.put<Branding>('/branding', input),
    },
    tasks: {
      list: (query: Partial<ListTasksQuery>) =>
        client.get<Paginated<TaskDto>>(ROUTES.tasks, { query: query as QueryParams }),
      create: (input: CreateTaskInput) => client.post<TaskDto>(ROUTES.tasks, input),
      update: (id: string, input: UpdateTaskInput) =>
        client.patch<TaskDto>(`${ROUTES.tasks}/${id}`, input),
      complete: (id: string) => client.post<TaskDto>(`${ROUTES.tasks}/${id}/complete`),
      remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.tasks}/${id}`),
    },
    energyBills: {
      upload: (file: File, target: { opportunityId?: string; consumerUnitId?: string }) => {
        const form = new FormData();
        form.append('file', file);
        if (target.opportunityId) form.append('opportunityId', target.opportunityId);
        if (target.consumerUnitId) form.append('consumerUnitId', target.consumerUnitId);
        return client.upload<EnergyBillDto>('/energy-bills', form);
      },
      list: (query: { opportunityId?: string; consumerUnitId?: string }) =>
        client.get<EnergyBillDto[]>('/energy-bills', { query }),
      get: (id: string) => client.get<EnergyBillDto>(`/energy-bills/${id}`),
      snapshots: (id: string) =>
        client.get<EnergyBillSnapshotDto[]>(`/energy-bills/${id}/snapshots`),
      downloadUrl: (id: string) =>
        client.get<{ url: string; expiresIn: number }>(`/energy-bills/${id}/download-url`),
      validate: (id: string, input: ValidateEnergyBillInput) =>
        client.post<EnergyBillDto>(`/energy-bills/${id}/validate`, input),
      reject: (id: string, input: RejectEnergyBillInput) =>
        client.post<EnergyBillDto>(`/energy-bills/${id}/reject`, input),
    },
    aneel: {
      import: () => client.post<AneelImportResult>('/reference-data/aneel/import'),
    },
    audit: {
      list: (query: AuditQuery) =>
        client.get<Paginated<AuditLogDto>>(ROUTES.auditLogs, { query: query as QueryParams }),
    },
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
export const endpoints = createEndpoints(defaultClient);
