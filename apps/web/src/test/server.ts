import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const API = 'http://api.test/api/v1';
const empty = { data: [], meta: { page: 1, pageSize: 5, total: 0 } };

/**
 * Respostas padrão do início (cartões por perfil). Cada teste registra os handlers de que precisa com
 * `server.use(...)`, que têm prioridade sobre estes.
 */
const homeDefaults = [
  http.get(`${API}/tasks`, () => HttpResponse.json(empty)),
  http.get(`${API}/operations/field/work-orders`, () => HttpResponse.json([])),
  http.get(`${API}/dashboard/commercial`, () =>
    HttpResponse.json({
      totalLeads: 0,
      proposals: { generated: 0, sent: 0, viewed: 0, accepted: 0 },
      won: { count: 0, totalCents: 0, averageTicketCents: null },
      forecast: { openCount: 0, openTotalCents: 0, byMonth: [] },
    }),
  ),
  http.get(`${API}/operations/dashboard`, () =>
    HttpResponse.json({
      byStatus: {},
      scheduledCount: 0,
      overdueCount: 0,
      awaitingMaterialCount: 0,
      openIssuesCount: 0,
      crews: [],
      reworkCount: 0,
    }),
  ),
  http.get(`${API}/operations/aftersales/dashboard`, () =>
    HttpResponse.json({
      installedBase: { plants: 0, powerKwp: 0 },
      mrrCents: 0,
      openTickets: 0,
      breachedTickets: 0,
      mttrHours: null,
      ticketsByPlant: [],
      warrantiesExpiring: null,
      warrantiesMissing: 0,
      contractsExpiring: null,
      upsellOpportunities: 0,
    }),
  ),
  http.get(`${API}/finance/overview`, () =>
    HttpResponse.json({
      totalOpenCents: 0,
      totalOverdueCents: 0,
      receivedLast30DaysCents: 0,
      commissionsPendingCents: 0,
      overdue: [],
    }),
  ),
  http.get(`${API}/engineering/dashboard`, () =>
    HttpResponse.json({
      byStatus: {},
      open: 0,
      overdue: 0,
      unassigned: 0,
      urgent: 0,
      avgResolutionDays: null,
      byAssignee: [],
      projects: { inProgress: 0, approved: 0, cancelled: 0 },
      upcoming: [],
    }),
  ),
];

/** Servidor MSW compartilhado pelos testes. */
export const server = setupServer(...homeDefaults);
