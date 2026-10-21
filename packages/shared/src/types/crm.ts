import type {
  AccountType,
  CustomerGroup,
  CustomerSegment,
  EnergyBillStatus,
  LeadSource,
  LeadStatus,
  OpportunityStage,
  OpportunityStatus,
  PhaseSystem,
  ProjectType,
  TaskStatus,
  TimelineEventType,
} from '../enums/index.js';
import type { EnergyBillField, EnergyBillFields, SiteIntake, Utm } from '../schemas/crm.js';

/** Contratos JSON do CRM (datas em ISO 8601). */

export interface LeadDto {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  document: string | null;
  source: LeadSource;
  segment: CustomerSegment | null;
  preliminaryGroup: CustomerGroup | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  utm: Utm | null;
  status: LeadStatus;
  ownerId: string | null;
  ownerName: string | null;
  /** Prazo para o primeiro contato (SLA). */
  firstContactDueAt: string | null;
  firstContactAt: string | null;
  /** Verdadeiro quando o prazo passou e ainda não houve contato. */
  slaBreached: boolean;
  disqualifiedReason: string | null;
  convertedAccountId: string | null;
  convertedOpportunityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConvertLeadResult {
  lead: LeadDto;
  accountId: string;
  opportunityId: string | null;
}

export interface AccountDto {
  id: string;
  tenantId: string;
  type: AccountType;
  name: string;
  document: string | null;
  segment: CustomerSegment | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDto {
  id: string;
  accountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface SiteDto {
  id: string;
  accountId: string;
  name: string;
  street: string | null;
  number: string | null;
  district: string | null;
  city: string;
  state: string;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  intake: SiteIntake;
  createdAt: string;
}

export interface ConsumerUnitDto {
  id: string;
  accountId: string;
  siteId: string | null;
  number: string;
  distributorId: string | null;
  distributorName: string | null;
  customerGroup: CustomerGroup;
  phaseSystem: PhaseSystem | null;
  consumerClass: string | null;
  createdAt: string;
}

export interface AccountDetailDto extends AccountDto {
  contacts: ContactDto[];
  sites: SiteDto[];
  consumerUnits: ConsumerUnitDto[];
}

export interface PipelineStageDto {
  id: string;
  key: OpportunityStage;
  name: string;
  order: number;
  terminal: boolean;
  /** Escondida do quadro (reaparece sozinha se ainda tiver negócios). */
  hidden: boolean;
}

/** Coluna criada pela empresa; segue as regras da etapa-base. */
export interface CustomStageDto {
  id: string;
  name: string;
  baseStage: OpportunityStage;
  position: number;
}

export interface OpportunityDto {
  id: string;
  tenantId: string;
  /** Project ID global (Digital Thread): nasce aqui e acompanha o negócio até o O&M. */
  projectCode: string;
  title: string;
  stage: OpportunityStage;
  customStageId: string | null;
  customStageName: string | null;
  status: OpportunityStatus;
  projectType: ProjectType;
  accountId: string;
  accountName: string;
  siteId: string | null;
  consumerUnitId: string | null;
  leadId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  lostReason: string | null;
  expectedCloseDate: string | null;
  /** Valor da proposta vigente, em centavos (preenchido a partir da cotação, Fase 7B). */
  valueCents: number | null;
  openTaskCount: number;
  nextTaskDueAt: string | null;
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityBoardColumnDto {
  /** Etapa padrão da coluna (para coluna personalizada, a etapa-base). */
  stage: PipelineStageDto;
  /** Preenchido quando a coluna é personalizada. */
  customStage: CustomStageDto | null;
  /** Total de oportunidades na etapa (os cartões podem ser limitados). */
  total: number;
  /** Soma do valor (preço da cotação mais recente) de TODAS as oportunidades da etapa, mesmo as não exibidas. */
  totalValueCents: number;
  items: OpportunityDto[];
}

export interface OpportunityBoardDto {
  columns: OpportunityBoardColumnDto[];
}

export interface TimelineEventDto {
  id: string;
  opportunityId: string;
  type: TimelineEventType;
  /** Texto curto já pronto para exibir. */
  summary: string;
  data: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  opportunityId: string | null;
  leadId: string | null;
  accountId: string | null;
  completedAt: string | null;
  overdue: boolean;
  createdAt: string;
}

export interface ExtractedField<T = unknown> {
  value: T;
  /** Confiança da leitura (0–1). Campos sem valor confiável vêm abaixo do limite e são destacados na revisão. */
  confidence: number;
}

export type ExtractedBillFields = {
  [K in EnergyBillField]?: ExtractedField<NonNullable<EnergyBillFields[K]>>;
};

export interface EnergyBillDto {
  id: string;
  opportunityId: string | null;
  consumerUnitId: string | null;
  documentId: string;
  filename: string;
  status: EnergyBillStatus;
  extracted: ExtractedBillFields;
  /** Média das confianças dos campos lidos (0–1); `null` quando nada foi lido. */
  overallConfidence: number | null;
  parserName: string | null;
  parserVersion: string | null;
  rejectedReason: string | null;
  validatedAt: string | null;
  snapshotId: string | null;
  createdAt: string;
}

/** Registro IMUTÁVEL do que foi confirmado pela pessoa: alimenta o Calculator. */
export interface EnergyBillSnapshotDto {
  id: string;
  billId: string;
  fields: EnergyBillFields;
  note: string | null;
  validatedById: string | null;
  createdAt: string;
}

export interface EngineeringRequestDto {
  id: string;
  opportunityId: string;
  calculationSessionId: string | null;
  reason: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  /** Projeto aberto no Solar Engine Studio para este pedido, quando já existe. */
  projectId: string | null;
  assigneeId: string | null;
  resolution: string | null;
  createdAt: string;
}

/** Dados que pré-preenchem o cálculo a partir da oportunidade (RF-CRM-040). */
export interface OpportunityCalculationContext {
  opportunityId: string;
  title: string;
  customerName: string;
  /** Últimos 12 meses da fatura validada, em ordem cronológica. */
  consumptionHistory: { month: string; kwh: number }[];
  consumptionMonthlyKwh: number[];
  billSnapshotId: string | null;
  customerGroup: CustomerGroup | null;
  phaseSystem: PhaseSystem | null;
  distributorId: string | null;
  distributorName: string | null;
  tariffCentsPerKwh: number | null;
  tariffId: string | null;
  latitude: number | null;
  roofAzimuthDegrees: number | null;
  tiltDegrees: number | null;
  availableAreaM2: number | null;
  shadingRelevant: boolean;
  projectType: ProjectType;
}
