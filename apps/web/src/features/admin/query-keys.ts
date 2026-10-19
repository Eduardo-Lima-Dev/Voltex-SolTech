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
  opportunities: (filters?: unknown) =>
    filters === undefined ? (['opportunities'] as const) : (['opportunities', filters] as const),
  opportunityBoard: (ownerId?: string) => ['opportunity-board', ownerId ?? 'all'] as const,
  opportunity: (id: string) => ['opportunity', id] as const,
  opportunityTimeline: (id: string) => ['opportunity', id, 'timeline'] as const,
  opportunityBills: (id: string) => ['opportunity', id, 'bills'] as const,
  opportunityCalculations: (id: string) => ['opportunity', id, 'calculations'] as const,
  opportunityEngineering: (id: string) => ['opportunity', id, 'engineering'] as const,
  calculationContext: (id: string) => ['opportunity', id, 'calculation-context'] as const,
  tasks: (filters?: unknown) =>
    filters === undefined ? (['tasks'] as const) : (['tasks', filters] as const),
  energyBill: (id: string) => ['energy-bill', id] as const,
  effectiveRules: ['rules', 'effective'] as const,
  audit: (filters?: unknown) =>
    filters === undefined ? (['audit'] as const) : (['audit', filters] as const),
};
