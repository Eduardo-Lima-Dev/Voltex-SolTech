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
  createdAt: now,
  ...overrides,
});

export const ruleSet = (overrides: Partial<RuleSetDto> = {}): RuleSetDto => ({
  id: 'rs-1',
  key: 'calculator.rules',
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
