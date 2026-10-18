/** Caminhos da API (relativos ao prefixo `/api/v1`). Contrato conceitual da seção 39. */
export const ROUTES = {
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
  },
  users: '/users',
  tenant: '/tenant',
  branches: '/branches',
  teams: '/teams',
  invitations: {
    base: '/invitations',
    accept: '/invitations/accept',
  },
  auditLogs: '/audit-logs',
  documents: '/documents',
  leads: '/leads',
  opportunities: '/opportunities',
  projects: '/projects',
  energyBills: {
    parse: '/energy-bills/parse',
    validate: (id: string) => `/energy-bills/${id}/validate`,
  },
  calculations: {
    quick: '/calculations/quick',
    quickById: (id: string) => `/calculations/quick/${id}`,
    quickSnapshot: (id: string) => `/calculations/quick/${id}/snapshot`,
  },
  catalog: {
    modules: '/catalog/modules',
    inverters: '/catalog/inverters',
    batteries: '/catalog/batteries',
    controllers: '/catalog/controllers',
  },
  health: '/health',
} as const;
