/** Chaves do cache de consultas (TanStack Query). Centralizadas para invalidar sem erro de digitação. */
export const queryKeys = {
  tenant: ['tenant'] as const,
  branches: ['branches'] as const,
  teams: ['teams'] as const,
  users: (filters?: unknown) =>
    filters === undefined ? (['users'] as const) : (['users', filters] as const),
  invitations: ['invitations'] as const,
  audit: (filters?: unknown) =>
    filters === undefined ? (['audit'] as const) : (['audit', filters] as const),
};
