import {
  permissionsForRole,
  type BranchDto,
  type CurrentUser,
  type Role,
  type SessionResponse,
  type TeamDto,
  type UserSummary,
} from '@voltex/shared';

export const API = 'http://api.test/api/v1';

export function makeUser(role: Role = 'OWNER', overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: `user-${role.toLowerCase()}`,
    name: 'Eduardo Silva',
    email: `${role.toLowerCase()}@voltex.test`,
    role,
    tenantId: 'tenant-1',
    tenantName: 'Voltex Demo',
    permissions: [...permissionsForRole(role)],
    ...overrides,
  };
}

export function makeSession(
  role: Role = 'OWNER',
  overrides: Partial<CurrentUser> = {},
): SessionResponse {
  return { accessToken: `token-${role}`, expiresIn: 900, user: makeUser(role, overrides) };
}

const now = '2026-10-18T12:00:00.000Z';

export function makeUserSummary(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: 'u-1',
    name: 'Ana Admin',
    email: 'ana@voltex.test',
    role: 'ADMIN',
    isActive: true,
    branchId: null,
    teamId: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export const branch = (overrides: Partial<BranchDto> = {}): BranchDto => ({
  id: 'b-1',
  tenantId: 'tenant-1',
  name: 'Matriz',
  city: 'Fortaleza',
  state: 'CE',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

export const team = (overrides: Partial<TeamDto> = {}): TeamDto => ({
  id: 't-1',
  tenantId: 'tenant-1',
  branchId: 'b-1',
  name: 'Comercial',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

// ---- Solar Calculator ----

import {
  ALGORITHM_VERSION,
  calculateQuick,
  quickCalculationInputSchema,
  type CalculationSessionDto,
  type CalculatorConfigDto,
  type QuickCalculationInput,
  type QuickCalculationSnapshotDto,
} from '@voltex/solar-engine';
import {
  thresholdsSchema,
  type DistributorDto,
  type RuleSetDto,
  type SolarResourceDto,
  type TariffDto,
} from '@voltex/shared';

/** Caso de referência dos testes do motor: 500 kWh/mês, HSP 5, PR 0,80 → 8 módulos de 550 Wp (4,4 kWp). */
export const referenceInput = (
  overrides: Partial<QuickCalculationInput> = {},
): QuickCalculationInput => ({
  consumptionMonthlyKwh: Array<number>(12).fill(500),
  availabilityCostKwh: 30,
  hspMonthly: Array<number>(12).fill(5),
  performanceRatio: 0.8,
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
  ...overrides,
});

export const makeConfig = (overrides: Partial<CalculatorConfigDto> = {}): CalculatorConfigDto => ({
  ruleSetRef: 'builtin@1',
  thresholds: thresholdsSchema.parse({}),
  availabilityCostKwh: {},
  sources: [{ type: 'BOOK', reference: 'EnergIF 2023, p. 16 (EF-M01)' }],
  ...overrides,
});

export function makeCalculation(
  overrides: Partial<CalculationSessionDto> = {},
  input: QuickCalculationInput = referenceInput(),
): CalculationSessionDto {
  const parsed = quickCalculationInputSchema.parse(input);
  const result = calculateQuick(parsed);
  return {
    id: 'calc-1',
    tenantId: 'tenant-1',
    createdById: 'user-owner',
    title: 'Residência Silva',
    customerName: 'João Silva',
    input: parsed,
    result,
    trafficLight: result.trafficLight,
    algorithmVersion: ALGORITHM_VERSION,
    ruleSetRef: 'builtin@1',
    references: { solarResource: null, tariff: null },
    opportunityId: null,
    createdAt: now,
    ...overrides,
  };
}

export function makeSnapshot(
  overrides: Partial<QuickCalculationSnapshotDto> = {},
): QuickCalculationSnapshotDto {
  const { title: _title, opportunityId: _opp, ...session } = makeCalculation();
  return {
    ...session,
    id: 'snap-1',
    sessionId: 'calc-1',
    note: 'Enviado ao cliente',
    ...overrides,
  };
}

export const distributor = (overrides: Partial<DistributorDto> = {}): DistributorDto => ({
  id: 'd-1',
  tenantId: 'tenant-1',
  name: 'Enel Ceará',
  state: 'CE',
  cnpj: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

export const tariff = (overrides: Partial<TariffDto> = {}): TariffDto => ({
  id: 'tf-1',
  tenantId: 'tenant-1',
  distributorId: 'd-1',
  customerGroup: 'B',
  modality: 'Convencional',
  energyCentsPerKwh: 95.5,
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
  source: 'Fatura do cliente',
  createdAt: now,
  ...overrides,
});

export const solarResource = (overrides: Partial<SolarResourceDto> = {}): SolarResourceDto => ({
  id: 'sr-1',
  tenantId: 'tenant-1',
  name: 'Fortaleza',
  state: 'CE',
  latitude: -3.73,
  longitude: -38.52,
  hspMonthly: Array<number>(12).fill(5.5),
  source: 'CRESESB SunData',
  plane: 'Plano horizontal',
  temperatures: null,
  createdAt: now,
  ...overrides,
});

export const ruleSet = (overrides: Partial<RuleSetDto> = {}): RuleSetDto => ({
  id: 'rs-1',
  key: 'calculator.rules',
  scope: null,
  scopeKey: '',
  version: 1,
  status: 'ACTIVE',
  validFrom: '2026-02-01T00:00:00.000Z',
  validTo: null,
  definition: {},
  sources: [{ type: 'INTERNAL_POLICY', reference: 'Política interna' }],
  reviewedBy: 'Eng. Maria Souza',
  reviewedAt: '2026-02-01T00:00:00.000Z',
  notes: null,
  createdAt: now,
  ...overrides,
});

export const page = <T>(data: T[], total = data.length, pageNo = 1, pageSize = 10) => ({
  data,
  meta: { page: pageNo, pageSize, total },
});

// ---- CRM ----

import {
  DEFAULT_PIPELINE_STAGES,
  type AccountDetailDto,
  type ApprovalDto,
  type CommercialDashboardDto,
  type ContractDto,
  type ProjectChecklistItemDto,
  type ProjectDto,
  type EnergyBillDto,
  type EnergyBillSnapshotDto,
  type LeadDto,
  type OpportunityBoardDto,
  type OpportunityCalculationContext,
  type GuardEvaluationDto,
  type MarginPolicyDto,
  type OpportunityDto,
  type PipelineStageDto,
  type ProposalDto,
  type PublicProposalDto,
  type QuoteDto,
  type TaskDto,
  type TimelineEventDto,
} from '@voltex/shared';

export const makeLead = (overrides: Partial<LeadDto> = {}): LeadDto => ({
  id: 'lead-1',
  tenantId: 'tenant-1',
  name: 'Maria Silva',
  email: 'maria@exemplo.com',
  phone: '(85) 98888-7777',
  document: null,
  source: 'MANUAL',
  segment: 'RESIDENTIAL',
  preliminaryGroup: null,
  city: 'Fortaleza',
  state: 'CE',
  notes: null,
  utm: null,
  status: 'NEW',
  ownerId: 'user-owner',
  ownerName: 'Eduardo Silva',
  firstContactDueAt: '2099-01-01T12:00:00.000Z',
  firstContactAt: null,
  slaBreached: false,
  disqualifiedReason: null,
  convertedAccountId: null,
  convertedOpportunityId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

export const stages = (): PipelineStageDto[] =>
  DEFAULT_PIPELINE_STAGES.map((s) => ({
    id: `stage-${s.key}`,
    key: s.key,
    name: s.name,
    order: s.order,
    terminal: s.terminal,
    hidden: false,
  }));

export const makeOpportunity = (overrides: Partial<OpportunityDto> = {}): OpportunityDto => ({
  id: 'opp-1',
  tenantId: 'tenant-1',
  projectCode: 'VLX-7K3M9QX2',
  title: 'Casa da Maria',
  stage: 'NEW_LEAD',
  status: 'OPEN',
  projectType: 'ON_GRID',
  accountId: 'acc-1',
  accountName: 'Maria Silva',
  siteId: null,
  consumerUnitId: null,
  leadId: null,
  ownerId: 'user-owner',
  ownerName: 'Eduardo Silva',
  lostReason: null,
  expectedCloseDate: null,
  valueCents: null,
  openTaskCount: 0,
  nextTaskDueAt: null,
  customStageId: null,
  customStageName: null,
  stageChangedAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

export const makeBoard = (items: OpportunityDto[] = []): OpportunityBoardDto => ({
  columns: stages().map((stage) => {
    const inStage = items.filter((o) => o.stage === stage.key);
    const totalValueCents = inStage.reduce((sum, o) => sum + (o.valueCents ?? 0), 0);
    return { stage, customStage: null, total: inStage.length, totalValueCents, items: inStage };
  }),
});

export const makeAccount = (overrides: Partial<AccountDetailDto> = {}): AccountDetailDto => ({
  id: 'acc-1',
  tenantId: 'tenant-1',
  type: 'PERSON',
  name: 'Maria Silva',
  document: null,
  segment: 'RESIDENTIAL',
  email: 'maria@exemplo.com',
  phone: '(85) 98888-7777',
  notes: null,
  createdAt: now,
  updatedAt: now,
  contacts: [
    {
      id: 'ct-1',
      accountId: 'acc-1',
      name: 'Maria Silva',
      email: null,
      phone: null,
      roleTitle: null,
      isPrimary: true,
      createdAt: now,
    },
  ],
  sites: [
    {
      id: 'site-1',
      accountId: 'acc-1',
      name: 'Residência',
      street: 'Rua das Flores',
      number: '100',
      district: 'Centro',
      city: 'Fortaleza',
      state: 'CE',
      zip: null,
      latitude: -3.73,
      longitude: -38.52,
      intake: { roofType: 'CERAMIC', roofAzimuthDegrees: 0, tiltDegrees: 15, shading: 'LOW' },
      createdAt: now,
    },
  ],
  consumerUnits: [
    {
      id: 'uc-1',
      accountId: 'acc-1',
      siteId: 'site-1',
      number: '12345678',
      distributorId: 'd-1',
      distributorName: 'Enel Ceará',
      customerGroup: 'B',
      phaseSystem: 'TWO_PHASE',
      consumerClass: 'Residencial',
      createdAt: now,
    },
  ],
  ...overrides,
});

export const makeTask = (overrides: Partial<TaskDto> = {}): TaskDto => ({
  id: 'task-1',
  title: 'Ligar para o cliente',
  description: null,
  dueAt: '2099-01-01T12:00:00.000Z',
  status: 'OPEN',
  assigneeId: 'user-owner',
  assigneeName: 'Eduardo Silva',
  opportunityId: 'opp-1',
  leadId: null,
  accountId: null,
  completedAt: null,
  overdue: false,
  createdAt: now,
  ...overrides,
});

export const makeTimelineEvent = (overrides: Partial<TimelineEventDto> = {}): TimelineEventDto => ({
  id: 'ev-1',
  opportunityId: 'opp-1',
  type: 'CREATED',
  summary: 'Oportunidade criada (VLX-7K3M9QX2)',
  data: {},
  actorId: 'user-owner',
  actorName: 'Eduardo Silva',
  createdAt: now,
  ...overrides,
});

export const makeBill = (overrides: Partial<EnergyBillDto> = {}): EnergyBillDto => ({
  id: 'bill-1',
  opportunityId: 'opp-1',
  consumerUnitId: 'uc-1',
  documentId: 'doc-1',
  filename: 'fatura.pdf',
  status: 'PARSED',
  extracted: {
    ucNumber: { value: '12345678-9', confidence: 0.85 },
    distributorName: { value: 'Enel Ceará', confidence: 0.9 },
    customerName: { value: 'JOAO DA SILVA', confidence: 0.5 },
    consumptionHistory: {
      value: [
        { month: '2026-06', kwh: 400 },
        { month: '2026-07', kwh: 405 },
        { month: '2026-08', kwh: 1020 },
      ],
      confidence: 0.65,
    },
    phaseSystem: { value: 'TWO_PHASE', confidence: 0.8 },
  },
  overallConfidence: 0.74,
  parserName: 'pdf-text-heuristic',
  parserVersion: '1.0.0',
  rejectedReason: null,
  validatedAt: null,
  snapshotId: null,
  createdAt: now,
  ...overrides,
});

export const makeBillSnapshot = (
  overrides: Partial<EnergyBillSnapshotDto> = {},
): EnergyBillSnapshotDto => ({
  id: 'snap-1',
  billId: 'bill-1',
  fields: { ucNumber: '12345678-9', consumptionHistory: [{ month: '2026-08', kwh: 480 }] },
  note: null,
  validatedById: 'user-owner',
  createdAt: now,
  ...overrides,
});

export const makeContext = (
  overrides: Partial<OpportunityCalculationContext> = {},
): OpportunityCalculationContext => ({
  opportunityId: 'opp-1',
  title: 'Casa da Maria',
  customerName: 'Maria Silva',
  consumptionHistory: [
    { month: '2026-03', kwh: 480 },
    { month: '2026-04', kwh: 450 },
  ],
  consumptionMonthlyKwh: [480, 450],
  billSnapshotId: 'snap-1',
  customerGroup: 'B',
  phaseSystem: 'TWO_PHASE',
  distributorId: 'd-1',
  distributorName: 'Enel Ceará',
  tariffCentsPerKwh: 98.5,
  tariffId: 'tf-1',
  latitude: -3.73,
  roofAzimuthDegrees: 0,
  tiltDegrees: 15,
  availableAreaM2: 50,
  shadingRelevant: false,
  projectType: 'ON_GRID',
  ...overrides,
});

// ---- Triagem, cotação e proposta (7B) ----

export const makeGuard = (overrides: Partial<GuardEvaluationDto> = {}): GuardEvaluationDto => ({
  id: 'guard-1',
  opportunityId: 'opp-1',
  version: 1,
  status: 'GREEN',
  checks: [],
  missingFields: [],
  needsHumanReview: false,
  needsEngineeringReview: false,
  algorithmVersion: 'guard-1.0.0',
  ruleSetRef: 'builtin@1',
  inputs: { billSnapshotId: 'snap-1', calculationSessionId: 'calc-1' },
  stale: false,
  invalidatedAt: null,
  invalidatedReason: null,
  override: null,
  releasedForQuote: true,
  createdById: 'user-owner',
  createdByName: 'Eduardo Silva',
  createdAt: now,
  ...overrides,
});

export const makeQuote = (overrides: Partial<QuoteDto> = {}): QuoteDto => ({
  id: 'quote-1',
  opportunityId: 'opp-1',
  version: 1,
  title: null,
  calculationSessionId: 'calc-1',
  items: [{ category: 'MODULE', description: 'Módulo 550 Wp', quantity: 8, unitCostCents: 60_000 }],
  costs: {
    freightCents: 40_000,
    installationCents: 200_000,
    travelCents: 20_000,
    otherCostsCents: 10_000,
    commissionRate: 0.05,
    taxRate: 0.06,
    financingRate: 0.02,
    contingencyRate: 0.03,
  },
  priceCents: 1_980_000,
  margin: {
    materialsCents: 850_000,
    directCostsCents: 1_120_000,
    contingencyCents: 33_600,
    commissionCents: 99_000,
    taxesCents: 118_800,
    financingCents: 39_600,
    totalCostsCents: 1_411_000,
    contributionMarginCents: 569_000,
    marginRate: 0.2874,
    markupRate: 0.4033,
  },
  marginStatus: 'WITHIN_POLICY',
  minMarginRate: 0.2,
  policyId: 'policy-1',
  minPriceCents: 1_721_793,
  approvalStatus: 'NONE',
  releasedForProposal: true,
  locked: false,
  createdById: 'user-owner',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

export const makePolicy = (overrides: Partial<MarginPolicyDto> = {}): MarginPolicyDto => ({
  id: 'policy-1',
  name: 'Mínimo geral',
  minMarginRate: 0.2,
  projectType: null,
  teamId: null,
  active: true,
  createdAt: now,
  ...overrides,
});

export const makeApproval = (overrides: Partial<ApprovalDto> = {}): ApprovalDto => ({
  id: 'appr-1',
  type: 'MARGIN',
  status: 'PENDING',
  quoteId: 'quote-1',
  quoteVersion: 1,
  opportunityId: 'opp-1',
  opportunityTitle: 'Casa da Maria',
  projectCode: 'VLX-7K3M9QX2',
  accountName: 'Maria Silva',
  marginRate: 0.12,
  minMarginRate: 0.2,
  priceCents: 1_500_000,
  justification: 'Cliente estratégico, fecha hoje.',
  requestedById: 'user-seller',
  requestedByName: 'Victor Vendedor',
  decisionJustification: null,
  decidedById: null,
  decidedByName: null,
  decidedAt: null,
  createdAt: now,
  ...overrides,
});

export const makeProposal = (overrides: Partial<ProposalDto> = {}): ProposalDto => ({
  id: 'prop-1',
  opportunityId: 'opp-1',
  version: 1,
  status: 'GENERATED',
  scenarios: [
    {
      label: 'Proposta',
      quoteId: 'quote-1',
      quoteVersion: 1,
      installedPowerKwp: 4.4,
      priceCents: 1_980_000,
    },
  ],
  validUntil: '2026-11-02T12:00:00.000Z',
  expired: false,
  sentAt: null,
  firstViewedAt: null,
  viewCount: 0,
  acceptedAt: null,
  acceptedByName: null,
  snapshotId: 'psnap-1',
  pdfDocumentId: 'doc-1',
  createdById: 'user-owner',
  createdAt: now,
  ...overrides,
});

export const makePublicProposal = (
  overrides: Partial<PublicProposalDto> = {},
): PublicProposalDto => ({
  status: 'SENT',
  version: 1,
  tenantName: 'Sol do Nordeste',
  brand: { primaryColor: '#0a7d3b', hasLogo: false },
  title: 'Casa da Maria',
  customerName: 'Maria Silva',
  projectCode: 'VLX-7K3M9QX2',
  scenarios: [
    {
      label: 'Proposta',
      installedPowerKwp: 4.4,
      moduleCount: 8,
      estimatedAreaM2: 20.6,
      annualGenerationKwh: 7_200,
      monthlyGenerationKwh: Array<number>(12).fill(600),
      averageMonthlyConsumptionKwh: 500,
      compensationRatio: 1,
      priceCents: 1_980_000,
      firstYearSavingsCents: 520_000,
      accumulatedSavingsCents: 21_000_000,
      simplePaybackYears: 3.8,
      horizonYears: 25,
      cashFlow: [
        { year: 0, cumulativeCents: -1_980_000 },
        { year: 1, cumulativeCents: -1_460_000 },
      ],
    },
  ],
  conditions: { paymentTerms: '30% de entrada + 6x', notes: null },
  validUntil: '2026-11-02T12:00:00.000Z',
  expired: false,
  acceptedAt: null,
  acceptedByName: null,
  disclaimer: 'Estimativas sujeitas à vistoria técnica.',
  ...overrides,
});

// ---- Contrato, projeto e painel (7C) ----

export const makeContract = (overrides: Partial<ContractDto> = {}): ContractDto => ({
  id: 'contract-1',
  opportunityId: 'opp-1',
  proposalId: 'prop-1',
  proposalVersion: 1,
  scenarioLabel: 'Proposta',
  version: 1,
  status: 'DRAFT',
  templateVersion: null,
  templateIsDefault: true,
  body: 'CONTRATO DE FORNECIMENTO\n\nCONTRATANTE: Maria Silva.',
  missingVariables: [],
  valueCents: 1_980_000,
  pdfDocumentId: 'doc-c1',
  fileKind: 'PDF',
  signedDocumentId: null,
  signedAt: null,
  signedByName: null,
  cancelledAt: null,
  cancelReason: null,
  projectId: null,
  createdById: 'user-owner',
  createdAt: now,
  ...overrides,
});

export const makeChecklistItem = (
  overrides: Partial<ProjectChecklistItemDto> = {},
): ProjectChecklistItemDto => ({
  id: 'item-1',
  code: 'FORM',
  title: 'Formulário de solicitação de acesso',
  description: null,
  required: true,
  status: 'PENDING',
  note: null,
  dueAt: null,
  completedAt: null,
  completedByName: null,
  documentId: null,
  source: 'EnergIF 2023, EF-R04 (p. 121 e 123), a',
  ...overrides,
});

export const makeProject = (overrides: Partial<ProjectDto> = {}): ProjectDto => ({
  id: 'proj-1',
  opportunityId: 'opp-1',
  projectCode: 'VLX-7K3M9QX2',
  title: 'Casa da Maria',
  accountId: 'acc-1',
  accountName: 'Maria Silva',
  contractId: 'contract-1',
  distributorId: null,
  distributorName: null,
  status: 'DOCUMENTATION',
  valueCents: 1_980_000,
  generationClass: 'MICRO',
  responsibleId: null,
  responsibleName: null,
  rules: {
    ref: 'energif-2023@1',
    scope: 'BUILT_IN',
    source: 'EnergIF — Energia Fotovoltaica vol. 3 (2023): EF-R03 a EF-R06',
    reviewedBy: null,
    notes: 'Lista de 2023: confirme com a distribuidora.',
  },
  checklist: [
    makeChecklistItem(),
    makeChecklistItem({
      id: 'item-2',
      code: 'MEMORIAL',
      title: 'Memorial descritivo',
      source: 'EnergIF 2023, EF-R04, f',
    }),
  ],
  pendingRequired: 2,
  protocolNumber: null,
  submittedAt: null,
  accessOpinionDueAt: null,
  accessOpinionDueSource: null,
  inspectionRequestedAt: null,
  inspectionDueAt: null,
  approvedAt: null,
  cancelledAt: null,
  deadlineSuggestions: [
    {
      code: 'ACCESS_OPINION',
      label: 'Parecer de acesso da distribuidora',
      days: 60,
      source: 'EnergIF 2023, EF-R06: parecer em até 60 dias (ANEEL, 2023)',
      suggestedDueAt: '2026-12-17T12:00:00.000Z',
    },
  ],
  overdue: false,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

export const makeDashboard = (
  overrides: Partial<CommercialDashboardDto> = {},
): CommercialDashboardDto => ({
  from: '2026-09-18T00:00:00.000Z',
  to: '2026-10-18T23:59:59.000Z',
  leadsBySource: [
    { source: 'FORM', count: 6 },
    { source: 'REFERRAL', count: 2 },
  ],
  totalLeads: 8,
  funnel: [
    { stage: 'NEW_LEAD', reached: 8, conversionFromPrevious: null },
    { stage: 'QUOTING', reached: 4, conversionFromPrevious: 0.5 },
    { stage: 'WON', reached: 1, conversionFromPrevious: 0.25 },
  ],
  proposals: { generated: 4, sent: 3, viewed: 2, accepted: 1 },
  won: { count: 1, totalCents: 1_980_000, averageTicketCents: 1_980_000 },
  forecast: {
    openCount: 3,
    openTotalCents: 5_940_000,
    withoutValueCount: 1,
    byMonth: [{ month: '2026-12', count: 1, totalCents: 1_980_000 }],
    withoutExpectedDateCount: 2,
    weightedTotalCents: null,
  },
  ...overrides,
});
