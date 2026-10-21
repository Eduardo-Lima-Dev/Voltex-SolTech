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
  type CreateCustomStageInput,
  type CustomStageDto,
  type PipelineStageDto,
  type UpdateCustomStageInput,
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
  type CreateEngineeringProjectInput,
  type CreateQuoteFromEngineeringInput,
  type CreateEquipmentInput,
  type EngineeringDesignInput,
  type EngineeringProjectDetailDto,
  type EngineeringProjectDto,
  type EngineeringRequestListItemDto,
  type CatalogLinkDocumentDto,
  type EquipmentKind,
  type CatalogSearchResultDto,
  type CatalogSourceLinkDto,
  type CreateCatalogSourceLinkInput,
  type ListLinkDocumentsQuery,
  type CatalogSourceDocumentDto,
  type CatalogSourceDto,
  type ListSourceDocumentsQuery,
  type ChangeRequestStatusInput,
  type EngineeringDashboardDto,
  type EngineeringEventDto,
  type EngineeringRequestDetailDto,
  type EngineeringSurveyDto,
  type LoadAnalysisDto,
  type ProjectDocumentItemDto,
  type SurveyInput,
  type UpdateDocumentItemInput,
  type UpdateProjectProfileInput,
  type UpdateRequestPlanInput,
  type EngineeringVersionComparisonDto,
  type EngineeringShareLinkDto,
  type PublicEngineeringReportDto,
  type EngineeringReviewerDto,
  type EngineeringVersionDetailDto,
  type SubmitEngineeringVersionInput,
  type EngineeringDecisionInput,
  type EngineeringReviewCommentInput,
  type HorizonResultDto,
  type ListEngineeringProjectsQuery,
  type SuggestConfigurationsInput,
  type SuggestConfigurationsResult,
  type ListEngineeringRequestsQuery,
  type WeatherResultDto,
  type CreateSourceWatchInput,
  type EquipmentDetailDto,
  type EquipmentDto,
  type ExternalReferenceDto,
  type ImportCommitInput,
  type ImportFormat,
  type ImportPreviewDto,
  type InmetroCheckInput,
  type ListEquipmentQuery,
  type ListReferencesQuery,
  type PriceImportResultDto,
  type PriceItemDto,
  type ProposeSolarResourceInput,
  type UpdateEquipmentInput,
  type DataSourceDto,
  type DecideProposalInput,
  type ListProposalsQuery,
  type SourceWatchDto,
  type UpdateProposalDto,
  type UpdateSourceWatchInput,
  type TariffScanResultDto,
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
    engineering: {
      requests: (query: Partial<ListEngineeringRequestsQuery> = {}) =>
        client.get<EngineeringRequestListItemDto[]>('/engineering/requests', {
          query: query as QueryParams,
        }),
      requestDetail: (id: string) =>
        client.get<EngineeringRequestDetailDto>(`/engineering/requests/${id}`),
      changeRequestStatus: (id: string, input: ChangeRequestStatusInput) =>
        client.post<EngineeringRequestListItemDto>(`/engineering/requests/${id}/status`, input),
      commentRequest: (id: string, text: string) =>
        client.post<EngineeringRequestDetailDto>(`/engineering/requests/${id}/comments`, { text }),
      requestInfo: (id: string, question: string) =>
        client.post<EngineeringRequestDetailDto>(`/engineering/requests/${id}/info-requests`, {
          question,
        }),
      updateRequestPlan: (id: string, input: UpdateRequestPlanInput) =>
        client.patch<EngineeringRequestListItemDto>(`/engineering/requests/${id}/plan`, input),
      dashboard: () => client.get<EngineeringDashboardDto>('/engineering/dashboard'),
      updateProfile: (id: string, input: UpdateProjectProfileInput) =>
        client.patch<EngineeringProjectDetailDto>(`/engineering/projects/${id}`, input),
      projectTimeline: (id: string) =>
        client.get<EngineeringEventDto[]>(`/engineering/projects/${id}/timeline`),
      survey: (id: string) =>
        client.get<EngineeringSurveyDto>(`/engineering/projects/${id}/survey`),
      saveSurvey: (id: string, data: SurveyInput) =>
        client.put<EngineeringSurveyDto>(`/engineering/projects/${id}/survey`, { data }),
      completeSurvey: (id: string) =>
        client.post<EngineeringSurveyDto>(`/engineering/projects/${id}/survey/complete`),
      reopenSurvey: (id: string) =>
        client.post<EngineeringSurveyDto>(`/engineering/projects/${id}/survey/reopen`),
      loadAnalysis: (id: string) =>
        client.get<LoadAnalysisDto>(`/engineering/projects/${id}/load-analysis`),
      documentItems: (id: string) =>
        client.get<ProjectDocumentItemDto[]>(`/engineering/projects/${id}/documents`),
      updateDocumentItem: (id: string, code: string, input: UpdateDocumentItemInput) =>
        client.patch<ProjectDocumentItemDto[]>(
          `/engineering/projects/${id}/documents/${code}`,
          input,
        ),
      assign: (id: string) =>
        client.post<EngineeringRequestListItemDto>(`/engineering/requests/${id}/assign`),
      cancelRequest: (id: string, reason: string) =>
        client.post<EngineeringRequestListItemDto>(`/engineering/requests/${id}/cancel`, {
          reason,
        }),
      projects: (query: Partial<ListEngineeringProjectsQuery> = {}) =>
        client.get<Paginated<EngineeringProjectDto>>('/engineering/projects', {
          query: query as QueryParams,
        }),
      project: (id: string) =>
        client.get<EngineeringProjectDetailDto>(`/engineering/projects/${id}`),
      createProject: (input: CreateEngineeringProjectInput) =>
        client.post<EngineeringProjectDetailDto>('/engineering/projects', input),
      fromRequest: (requestId: string, coordinates?: { latitude: number; longitude: number }) =>
        client.post<EngineeringProjectDetailDto>(
          `/engineering/projects/from-request/${requestId}`,
          coordinates ?? {},
        ),
      cancelProject: (id: string, reason: string) =>
        client.post<EngineeringProjectDetailDto>(`/engineering/projects/${id}/cancel`, { reason }),
      version: (id: string) =>
        client.get<EngineeringVersionDetailDto>(`/engineering/versions/${id}`),
      saveDesign: (id: string, design: EngineeringDesignInput) =>
        client.put<EngineeringVersionDetailDto>(`/engineering/versions/${id}/design`, { design }),
      suggestConfigurations: (id: string, input: SuggestConfigurationsInput) =>
        client.post<SuggestConfigurationsResult>(
          `/engineering/versions/${id}/configurations`,
          input,
        ),
      recalculate: (id: string) =>
        client.post<EngineeringVersionDetailDto>(`/engineering/versions/${id}/recalculate`),
      submit: (id: string, input: SubmitEngineeringVersionInput = {}) =>
        client.post<EngineeringVersionDetailDto>(`/engineering/versions/${id}/submit`, input),
      reviewers: () => client.get<EngineeringReviewerDto[]>('/engineering/reviewers'),
      comments: (id: string) =>
        client.get<
          {
            id: string;
            section: string;
            text: string;
            status: 'OPEN' | 'RESOLVED';
            authorId: string | null;
            resolvedAt: string | null;
            createdAt: string;
          }[]
        >(`/engineering/versions/${id}/comments`),
      addComment: (id: string, input: EngineeringReviewCommentInput) =>
        client.post(`/engineering/versions/${id}/comments`, input),
      resolveComment: (id: string, commentId: string) =>
        client.post(`/engineering/versions/${id}/comments/${commentId}/resolve`),
      approve: (id: string, input: EngineeringDecisionInput) =>
        client.post<EngineeringVersionDetailDto>(`/engineering/versions/${id}/approve`, input),
      reject: (id: string, input: EngineeringDecisionInput) =>
        client.post<EngineeringVersionDetailDto>(`/engineering/versions/${id}/reject`, input),
      newVersion: (id: string) =>
        client.post<EngineeringVersionDetailDto>(`/engineering/versions/${id}/new-version`),
      compare: (id: string, withId: string) =>
        client.get<EngineeringVersionComparisonDto>(`/engineering/versions/${id}/compare`, {
          query: { with: withId },
        }),
      shareLinks: (id: string) =>
        client.get<EngineeringShareLinkDto[]>(`/engineering/versions/${id}/share-links`),
      createShareLink: (id: string, validDays: number) =>
        client.post<EngineeringShareLinkDto & { token: string; path: string }>(
          `/engineering/versions/${id}/share-links`,
          { validDays },
        ),
      revokeShareLink: (linkId: string) =>
        client.post<EngineeringShareLinkDto>(`/engineering/share-links/${linkId}/revoke`),
      attachHomologation: (id: string) =>
        client.post<{
          projectId: string;
          attached: { code: string; documentId: string }[];
          skipped: { code: string; reason: string }[];
        }>(`/engineering/versions/${id}/attach-homologation`),
      /** Entregáveis do projeto: memorial e unifilar (PDF), unifilar em SVG e DXF. */
      deliverable: (
        id: string,
        file: 'report.pdf' | 'single-line.pdf' | 'single-line.svg' | 'single-line.dxf',
      ) => client.getBlob(`/engineering/versions/${id}/${file}`),
      removeVersion: (id: string) => client.delete<{ id: string }>(`/engineering/versions/${id}`),
    },
    catalog: {
      list: (query: Partial<ListEquipmentQuery> = {}) =>
        client.get<Paginated<EquipmentDto>>('/catalog/items', { query: query as QueryParams }),
      get: (id: string) => client.get<EquipmentDetailDto>(`/catalog/items/${id}`),
      create: (input: CreateEquipmentInput) => client.post<EquipmentDto>('/catalog/items', input),
      update: (id: string, input: UpdateEquipmentInput) =>
        client.patch<EquipmentDto>(`/catalog/items/${id}`, input),
      remove: (id: string) => client.delete<{ id: string }>(`/catalog/items/${id}`),
      approve: (id: string) => client.post<EquipmentDetailDto>(`/catalog/items/${id}/approve`),
      retire: (id: string) => client.post<EquipmentDto>(`/catalog/items/${id}/retire`),
      revise: (id: string) => client.post<EquipmentDto>(`/catalog/items/${id}/revise`),
      inmetro: (id: string, input: InmetroCheckInput) =>
        client.post<EquipmentDto>(`/catalog/items/${id}/inmetro`, input),
      preview: (file: File, format: ImportFormat, kind?: string) => {
        const form = new FormData();
        form.append('file', file);
        return client.upload<ImportPreviewDto>('/catalog/import/preview', form, {
          query: { format, ...(kind ? { kind } : {}) },
        });
      },
      commit: (input: ImportCommitInput) =>
        client.post<{ created: EquipmentDto[] }>('/catalog/import/commit', input),
      attachDatasheet: (id: string, documentId: string) =>
        client.post<EquipmentDto>(`/catalog/items/${id}/datasheet`, { documentId }),
      search: (q: string, kind?: EquipmentKind, limit = 15) =>
        client.get<CatalogSearchResultDto[]>('/catalog/search', {
          query: { q, ...(kind ? { kind } : {}), limit },
        }),
      sourceLinks: () => client.get<CatalogSourceLinkDto[]>('/catalog/source-links'),
      addSourceLink: (input: CreateCatalogSourceLinkInput) =>
        client.post<CatalogSourceLinkDto>('/catalog/source-links', input),
      analyzeSourceLink: (id: string) =>
        client.post<CatalogSourceLinkDto>(`/catalog/source-links/${id}/analyze`),
      removeSourceLink: (id: string) =>
        client.delete<{ id: string }>(`/catalog/source-links/${id}`),
      linkDocuments: (id: string, query: Partial<ListLinkDocumentsQuery> = {}) =>
        client.get<Paginated<CatalogLinkDocumentDto>>(`/catalog/source-links/${id}/documents`, {
          query: query as QueryParams,
        }),
      previewLinkDocument: (id: string, kind?: EquipmentKind) =>
        client.post<ImportPreviewDto>(
          `/catalog/source-links/documents/${id}/preview${kind ? `?kind=${kind}` : ''}`,
        ),
      sources: () => client.get<CatalogSourceDto[]>('/catalog/sources'),
      refreshSource: (key: string) =>
        client.post<{ pages: number; found: number; created: number }>(
          `/catalog/sources/${key}/refresh`,
        ),
      sourceDocuments: (key: string, query: Partial<ListSourceDocumentsQuery> = {}) =>
        client.get<Paginated<CatalogSourceDocumentDto>>(`/catalog/sources/${key}/documents`, {
          query: query as QueryParams,
        }),
      previewSourceDocument: (id: string) =>
        client.post<ImportPreviewDto>(`/catalog/sources/documents/${id}/preview`),
      references: (query: Partial<ListReferencesQuery> = {}) =>
        client.get<Paginated<ExternalReferenceDto>>('/catalog/references', {
          query: query as QueryParams,
        }),
      adopt: (id: string, spec?: Record<string, unknown>) =>
        client.post<EquipmentDto>(`/catalog/references/${id}/adopt`, { spec }),
      prices: (equipmentId?: string) =>
        client.get<PriceItemDto[]>('/catalog/prices', {
          query: equipmentId ? { equipmentId } : {},
        }),
      importPrices: (file: File, dryRun: boolean) => {
        const form = new FormData();
        form.append('file', file);
        return client.upload<PriceImportResultDto>('/catalog/prices/import', form, {
          query: { dryRun: String(dryRun) },
        });
      },
    },
    dataHub: {
      weather: (query: {
        latitude: number;
        longitude: number;
        source?: 'nasa-power' | 'pvgis';
        kind?: 'climatology' | 'hourly';
        year?: number;
        refresh?: boolean;
      }) =>
        client.get<WeatherResultDto>(`${ROUTES.dataHub}/weather`, {
          query: Object.fromEntries(
            Object.entries(query).map(([k, v]) => [k, String(v)]),
          ) as QueryParams,
        }),
      horizon: (query: { latitude: number; longitude: number }) =>
        client.get<HorizonResultDto>(`${ROUTES.dataHub}/horizon`, { query: query as QueryParams }),
      proposeSolarResource: (input: ProposeSolarResourceInput) =>
        client.post<UpdateProposalDto>(`${ROUTES.dataHub}/solar-resources/propose`, input),
      sources: () => client.get<DataSourceDto[]>(`${ROUTES.dataHub}/sources`),
      watches: {
        list: () => client.get<SourceWatchDto[]>(`${ROUTES.dataHub}/watches`),
        create: (input: CreateSourceWatchInput) =>
          client.post<SourceWatchDto>(`${ROUTES.dataHub}/watches`, input),
        update: (id: string, input: UpdateSourceWatchInput) =>
          client.patch<SourceWatchDto>(`${ROUTES.dataHub}/watches/${id}`, input),
        remove: (id: string) => client.delete<{ id: string }>(`${ROUTES.dataHub}/watches/${id}`),
        check: (id: string) =>
          client.post<{
            status: 'BASELINE' | 'UNCHANGED' | 'CHANGED' | 'ERROR';
            watch: SourceWatchDto;
          }>(`${ROUTES.dataHub}/watches/${id}/check`),
      },
      updates: {
        list: (query: ListProposalsQuery = {}) =>
          client.get<UpdateProposalDto[]>(`${ROUTES.dataHub}/updates`, {
            query: query as QueryParams,
          }),
        decide: (id: string, input: DecideProposalInput) =>
          client.post<UpdateProposalDto>(`${ROUTES.dataHub}/updates/${id}/decide`, input),
      },
      scanTariffs: () => client.post<TariffScanResultDto>(`${ROUTES.dataHub}/tariffs/scan`),
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
      customStages: () => client.get<CustomStageDto[]>(`${ROUTES.pipeline}/custom-stages`),
      createCustomStage: (input: CreateCustomStageInput) =>
        client.post<CustomStageDto>(`${ROUTES.pipeline}/custom-stages`, input),
      updateCustomStage: (id: string, input: UpdateCustomStageInput) =>
        client.patch<CustomStageDto>(`${ROUTES.pipeline}/custom-stages/${id}`, input),
      removeCustomStage: (id: string) =>
        client.delete<{ id: string; movedBack: number }>(`${ROUTES.pipeline}/custom-stages/${id}`),
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
      fromEngineering: (opportunityId: string, input: CreateQuoteFromEngineeringInput) =>
        client.post<QuoteDto>(`/opportunities/${opportunityId}/quotes/from-engineering`, input),
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
    publicEngineering: {
      get: (token: string) =>
        client.get<PublicEngineeringReportDto>(`/public/engineering/${token}`, { auth: false }),
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
