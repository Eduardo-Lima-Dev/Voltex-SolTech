import type { EngineeringProjectStatus, EngineeringVersionStatus } from './engineering.js';
import type { OffgridDesign, OffgridSystemType } from '../schemas/offgrid.js';

/** Resultados do Off-Grid Designer (Fase 10). Calculados pelo motor puro, no navegador e no servidor. */

export interface OffgridCheck {
  code: string;
  severity: 'OK' | 'WARNING' | 'ERROR';
  message: string;
  value?: number;
  limit?: number;
  unit?: string;
}

export interface OffgridLoadResult {
  /** Energia diária média (Wh/dia) no mês de maior consumo, no lado CA e CC. */
  dailyAcWh: number;
  dailyDcWh: number;
  dailyWh: number;
  /** Energia diária das cargas críticas. */
  criticalDailyWh: number;
  /** Energia diária média por mês (Wh/dia), com a sazonalidade. */
  monthlyDailyWh: number[];
  monthlyDailyAcWh: number[];
  monthlyDailyDcWh: number[];
  /** Curva de carga do dia típico do mês crítico (Wh em cada hora, 24 valores). */
  hourlyWh: number[];
  peakW: number;
  surgeW: number;
  installedW: number;
  /** Fração da energia consumida entre 18 h e 6 h. */
  nightFraction: number;
  criticalMonthIndex: number;
}

export interface OffgridResourceResult {
  source: 'SERIES' | 'SYNTHETIC' | 'NONE';
  /** Horas de sol pleno (kWh/m²·dia) no plano do arranjo, por mês. */
  hspMonthly: number[];
  /** Mês de projeto: o de pior relação carga ÷ recurso solar. */
  designMonthIndex: number;
  hspDesign: number;
  hspMin: number;
  tiltDegrees: number | null;
  azimuthDegrees: number | null;
}

export interface OffgridSizing {
  /** Energia que o banco entrega ao sistema por dia no mês de projeto (CRESESB 6.2), Wh. */
  energyRequiredWh: number;
  red1: number;
  red2: number;
  batteryEfficiency: number;
  inverterEfficiency: number;
  /** Potência de pico necessária do arranjo FV (CRESESB 6.3), Wp. */
  pvPowerWp: number;
  moduleCount: number | null;
  /** Autonomia de projeto e a sugerida por CRESESB 6.13 (referência, a revisar). */
  autonomyDays: number;
  suggestedAutonomyDays: number | null;
  dodPct: number | null;
  /** Capacidade útil do banco (Wh e Ah) para a autonomia pedida (CRESESB 6.10–6.12). */
  bankWhRequired: number | null;
  bankAhRequired: number | null;
  batterySeries: number | null;
  batteryParallel: number | null;
  controllerCurrentA: number | null;
  inverterContinuousW: number;
  inverterSurgeW: number;
  systemVoltageV: number;
}

export interface OffgridSelected {
  pvPowerWp: number;
  moduleCount: number;
  bankNominalWh: number;
  bankUsableWh: number;
  bankAh: number;
  batteryCount: number;
  controllerCurrentA: number;
  inverterContinuousW: number;
  inverterSurgeW: number;
  generatorW: number;
}

export interface OffgridSimulationResult {
  source: 'SERIES' | 'SYNTHETIC';
  hours: number;
  pvKwh: number;
  loadKwh: number;
  servedKwh: number;
  unmetKwh: number;
  /** Fração das horas em que a carga não foi atendida (perda de carga). */
  lolpPct: number;
  coveragePct: number;
  curtailedKwh: number;
  generatorKwh: number;
  generatorHours: number;
  fuelLiters: number;
  gridKwh: number;
  batteryCycles: number;
  batteryLifeYears: number | null;
  minSocPct: number;
  monthly: {
    pvKwh: number[];
    loadKwh: number[];
    unmetKwh: number[];
    generatorKwh: number[];
    gridKwh: number[];
    minSocPct: number[];
  };
  /** Dia típico (média anual por hora): kW de FV, kW de carga e SOC (%). */
  typicalDay: { pvKw: number[]; loadKw: number[]; socPct: number[] };
  /** SOC mínimo de cada dia do ano (%), para o gráfico sazonal. */
  dailyMinSocPct: number[];
  longestOutageHours: number;
  warnings: string[];
}

export interface OffgridStressResult {
  cloudyDays: number;
  irradianceFactor: number;
  loadGrowthPct: number;
  survives: boolean;
  unmetKwh: number;
  minSocPct: number;
  hoursToDepletion: number | null;
  /** Dias de autonomia efetivos do banco com a carga do mês de projeto. */
  autonomyDaysEffective: number;
}

export interface OffgridEconomicsResult {
  capexCents: number;
  capexItems: {
    description: string;
    quantity: number;
    unitCostCents: number | null;
    totalCents: number | null;
  }[];
  missingPrices: string[];
  annualOpexCents: number;
  annualFuelCents: number;
  annualGridCents: number;
  batteryReplacementYears: number | null;
  npvCostCents: number;
  /** Custo nivelado da energia entregue (centavos por kWh), no horizonte. */
  lcoeCentsPerKwh: number | null;
  /** Economia anual frente ao custo evitado informado (centavos), se informado. */
  annualSavingsCents: number | null;
  paybackYears: number | null;
}

export interface OffgridScenarioResult {
  id: string;
  name: string;
  pvPowerWp: number;
  bankNominalWh: number;
  generator: boolean;
  lolpPct: number;
  unmetKwh: number;
  generatorKwh: number;
  fuelLiters: number;
  capexCents: number;
  lcoeCentsPerKwh: number | null;
  batteryLifeYears: number | null;
}

export interface OffgridResults {
  algorithmVersions: Record<string, string>;
  systemType: OffgridSystemType;
  load: OffgridLoadResult;
  resource: OffgridResourceResult;
  sizing: OffgridSizing;
  selected: OffgridSelected | null;
  checks: OffgridCheck[];
  simulation: OffgridSimulationResult | null;
  stress: OffgridStressResult | null;
  economics: OffgridEconomicsResult | null;
  scenarios: OffgridScenarioResult[];
  /** Pendências que impedem concluir/aprovar (equipamento não escolhido, regra sem parâmetro...). */
  pending: { code: string; message: string }[];
  warnings: string[];
  status: 'INCOMPLETE' | 'INVALID' | 'VALID_WITH_WARNINGS' | 'VALID';
}

export interface OffgridSuggestion {
  moduleId: string;
  batteryId: string;
  controllerId: string | null;
  inverterId: string;
  systemVoltageV: number;
  modulesInSeries: number;
  parallelStrings: number;
  batterySeries: number;
  batteryParallel: number;
  inverterCount: number;
  pvPowerWp: number;
  bankNominalWh: number;
  capexCents: number | null;
  lolpPct: number | null;
  notes: string[];
}

export interface OffgridRequestDto {
  id: string;
  title: string;
  description: string | null;
  systemType: OffgridSystemType;
  status: string;
  priority: string;
  dueAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  projectId: string | null;
  opportunityId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OffgridEventDto {
  id: string;
  type: string;
  text: string | null;
  data: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface OffgridRequestDetailDto extends OffgridRequestDto {
  events: OffgridEventDto[];
  project: { id: string; code: string; name: string } | null;
}

export interface OffgridProjectDto {
  id: string;
  code: string;
  name: string;
  systemType: OffgridSystemType;
  status: EngineeringProjectStatus;
  opportunityId: string | null;
  responsibleId: string | null;
  artType: string | null;
  artNumber: string | null;
  notes: string | null;
  currentVersion: { id: string; number: number; status: EngineeringVersionStatus } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OffgridVersionDto {
  id: string;
  projectId: string;
  number: number;
  status: EngineeringVersionStatus;
  design: OffgridDesign;
  results: OffgridResults | null;
  fingerprint: string | null;
  stale: boolean;
  staleReasons: string[];
  ruleRefs: string[];
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OffgridProjectDetailDto extends OffgridProjectDto {
  versions: Pick<
    OffgridVersionDto,
    'id' | 'number' | 'status' | 'stale' | 'createdAt' | 'decidedAt'
  >[];
  events: OffgridEventDto[];
  openRequests: { id: string; title: string; status: string }[];
}

export interface OffgridCommentDto {
  id: string;
  section: string;
  text: string;
  status: 'OPEN' | 'RESOLVED';
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface OffgridDashboardDto {
  requests: Record<string, number>;
  projects: Record<string, number>;
  versionsAwaitingReview: number;
  overdueRequests: number;
}

export interface OffgridVersionDetailDto extends OffgridVersionDto {
  project: { id: string; code: string; name: string; systemType: OffgridSystemType };
  openComments: number;
  /** Quem pode agir agora: a versão enviada aguarda o responsável técnico. */
  canApprove: boolean;
}

export interface OffgridProjectListItemDto extends OffgridProjectDto {
  requestId: string | null;
}
