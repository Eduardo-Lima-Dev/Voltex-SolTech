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
  effectiveRules: ['rules', 'effective'] as const,
  audit: (filters?: unknown) =>
    filters === undefined ? (['audit'] as const) : (['audit', filters] as const),
};
