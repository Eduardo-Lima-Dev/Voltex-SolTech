/** Chaves do cache de consultas (TanStack Query). Centralizadas para invalidar sem erro de digitação. */
export const queryKeys = {
  tenant: ['tenant'] as const,
  branches: ['branches'] as const,
  teams: ['teams'] as const,
  users: (filters?: unknown) =>
    filters === undefined ? (['users'] as const) : (['users', filters] as const),
  invitations: ['invitations'] as const,
  calculations: (filters?: unknown) =>
    filters === undefined ? (['calculations'] as const) : (['calculations', filters] as const),
  calculation: (id: string) => ['calculation', id] as const,
  calculationSnapshots: (id: string) => ['calculation', id, 'snapshots'] as const,
  calculatorConfig: ['calculator-config'] as const,
  distributors: ['distributors'] as const,
  tariffs: (filters?: unknown) =>
    filters === undefined ? (['tariffs'] as const) : (['tariffs', filters] as const),
  solarResources: (filters?: unknown) =>
    filters === undefined
      ? (['solar-resources'] as const)
      : (['solar-resources', filters] as const),
  rules: ['rules'] as const,
  leads: (filters?: unknown) =>
    filters === undefined ? (['leads'] as const) : (['leads', filters] as const),
  leadCaptureKey: ['lead-capture-key'] as const,
  accounts: (filters?: unknown) =>
    filters === undefined ? (['accounts'] as const) : (['accounts', filters] as const),
  account: (id: string) => ['account', id] as const,
  pipeline: ['pipeline'] as const,
  customStages: ['pipeline', 'custom-stages'] as const,
  opportunities: (filters?: unknown) =>
    filters === undefined ? (['opportunities'] as const) : (['opportunities', filters] as const),
  opportunityBoard: (filters: { ownerId?: string; search?: string; status?: string } = {}) =>
    ['opportunity-board', filters] as const,
  opportunity: (id: string) => ['opportunity', id] as const,
  opportunityTimeline: (id: string) => ['opportunity', id, 'timeline'] as const,
  opportunityBills: (id: string) => ['opportunity', id, 'bills'] as const,
  opportunityCalculations: (id: string) => ['opportunity', id, 'calculations'] as const,
  opportunityEngineering: (id: string) => ['opportunity', id, 'engineering'] as const,
  opportunityGuard: (id: string) => ['opportunity', id, 'guard'] as const,
  opportunityQuotes: (id: string) => ['opportunity', id, 'quotes'] as const,
  opportunityProposals: (id: string) => ['opportunity', id, 'proposals'] as const,
  approvals: (filters?: unknown) =>
    filters === undefined ? (['approvals'] as const) : (['approvals', filters] as const),
  marginPolicies: ['margin-policies'] as const,
  opportunityContracts: (id: string) => ['opportunity', id, 'contracts'] as const,
  opportunityProject: (id: string) => ['opportunity', id, 'project'] as const,
  contractTemplate: ['contract-template'] as const,
  projects: (filters?: unknown) =>
    filters === undefined ? (['projects'] as const) : (['projects', filters] as const),
  project: (id: string) => ['project', id] as const,
  homologation: ['homologation'] as const,
  commercialDashboard: (filters?: unknown) => ['commercial-dashboard', filters] as const,
  branding: ['branding'] as const,
  retentionPolicy: ['retention-policy'] as const,
  erasures: (page?: number) => ['erasures', page ?? 1] as const,
  publicProposal: (token: string) => ['public-proposal', token] as const,
  calculationContext: (id: string) => ['opportunity', id, 'calculation-context'] as const,
  tasks: (filters?: unknown) =>
    filters === undefined ? (['tasks'] as const) : (['tasks', filters] as const),
  energyBill: (id: string) => ['energy-bill', id] as const,
  effectiveRules: ['rules', 'effective'] as const,
  dataSources: ['data-hub', 'sources'] as const,
  integrationProviders: ['integrations', 'providers'] as const,
  integrationConnections: ['integrations', 'connections'] as const,
  integrationRuns: (connectionId?: string) =>
    ['integrations', 'runs', connectionId ?? 'all'] as const,
  integrationDeadLetters: ['integrations', 'dead-letters'] as const,
  catalog: (filters?: unknown) =>
    filters === undefined ? (['catalog'] as const) : (['catalog', filters] as const),
  catalogItem: (id: string) => ['catalog', 'item', id] as const,
  catalogSources: ['catalog', 'sources'] as const,
  catalogSourceLinks: ['catalog', 'source-links'] as const,
  catalogLinkDocuments: (id: string, filters?: unknown) =>
    ['catalog', 'source-links', id, 'documents', filters ?? {}] as const,
  catalogSourceDocuments: (key: string, filters?: unknown) =>
    ['catalog', 'sources', key, 'documents', filters ?? {}] as const,
  catalogReferences: (filters?: unknown) => ['catalog', 'references', filters ?? {}] as const,
  engineeringRequests: (filters?: unknown) =>
    filters === undefined
      ? (['engineering', 'requests'] as const)
      : (['engineering', 'requests', filters] as const),
  engineeringProjects: (filters?: unknown) =>
    filters === undefined
      ? (['engineering', 'projects'] as const)
      : (['engineering', 'projects', filters] as const),
  engineeringRequest: (id: string) => ['engineering', 'request', id] as const,
  engineeringDashboard: ['engineering', 'dashboard'] as const,
  engineeringProject: (id: string) => ['engineering', 'project', id] as const,
  engineeringVersion: (id: string) => ['engineering', 'version', id] as const,
  offgridRequests: (filters?: object) =>
    filters ? (['offgrid', 'requests', filters] as const) : (['offgrid', 'requests'] as const),
  offgridRequest: (id: string) => ['offgrid', 'request', id] as const,
  offgridProjects: (filters?: object) =>
    filters ? (['offgrid', 'projects', filters] as const) : (['offgrid', 'projects'] as const),
  offgridProject: (id: string) => ['offgrid', 'project', id] as const,
  offgridVersion: (id: string) => ['offgrid', 'version', id] as const,
  offgridDashboard: ['offgrid', 'dashboard'] as const,
  catalogPrices: ['catalog', 'prices'] as const,
  sourceWatches: ['data-hub', 'watches'] as const,
  updateProposals: (filters?: unknown) =>
    filters === undefined
      ? (['data-hub', 'updates'] as const)
      : (['data-hub', 'updates', filters] as const),
  audit: (filters?: unknown) =>
    filters === undefined ? (['audit'] as const) : (['audit', filters] as const),
};
