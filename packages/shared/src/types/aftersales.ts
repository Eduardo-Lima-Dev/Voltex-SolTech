import type {
  AssetCategory,
  AssetStatus,
  MaintenanceKind,
  OmContractStatus,
  PlantStatus,
  TicketOrigin,
  TicketPriority,
  TicketStatus,
  TicketType,
  WarrantyKind,
} from '../schemas/aftersales.js';

/** Contratos JSON do pós-venda (datas em ISO 8601; datas de calendário em `AAAA-MM-DD`). */

export interface WarrantyDto {
  id: string;
  assetId: string;
  kind: WarrantyKind;
  startsOn: string;
  endsOn: string;
  /** Dias até vencer (negativo = vencida). */
  daysLeft: number;
  performanceEndPct: number | null;
  origin: string;
  termId: string | null;
  note: string | null;
}

export interface PlantAssetDto {
  id: string;
  equipmentId: string | null;
  category: AssetCategory;
  manufacturer: string;
  model: string;
  quantity: number;
  serials: string[];
  installedAt: string;
  status: AssetStatus;
  notes: string | null;
  warranties: WarrantyDto[];
  /** Sem nenhuma garantia cadastrada (falta o termo do fabricante). */
  warrantyMissing: boolean;
}

export interface PlantEventDto {
  id: string;
  type: string;
  text: string;
  actorId: string | null;
  createdAt: string;
}

export interface PlantSummaryDto {
  id: string;
  installationId: string;
  projectId: string;
  projectCode: string;
  accountId: string;
  accountName: string;
  siteLabel: string | null;
  name: string;
  status: PlantStatus;
  powerKwp: number | null;
  expectedAnnualKwh: number | null;
  activatedAt: string;
  openTickets: number;
  assetsWithoutWarranty: number;
}

export interface MaintenancePlanDto {
  id: string;
  plantId: string;
  title: string;
  kind: MaintenanceKind;
  everyMonths: number;
  lastDoneAt: string | null;
  nextDueAt: string;
  active: boolean;
  notes: string | null;
}

export interface OmContractDto {
  id: string;
  plantId: string;
  plantName: string;
  accountId: string;
  title: string;
  status: OmContractStatus;
  startsOn: string;
  endsOn: string;
  daysLeft: number;
  monthlyCents: number;
  billing: string | null;
  autoRenew: boolean;
  notes: string | null;
  renewalOpportunityId: string | null;
}

export interface TicketCommentDto {
  id: string;
  authorId: string | null;
  authorName: string;
  internal: boolean;
  body: string;
  createdAt: string;
}

export interface TicketSummaryDto {
  id: string;
  number: number;
  code: string;
  plantId: string;
  plantName: string;
  accountName: string;
  type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  title: string;
  origin: TicketOrigin;
  assigneeId: string | null;
  assetId: string | null;
  workOrderId: string | null;
  slaDueAt: string | null;
  /** Prazo vencido e ainda não resolvido. */
  slaBreached: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export interface TicketDetailDto extends TicketSummaryDto {
  description: string | null;
  resolution: string | null;
  closedAt: string | null;
  comments: TicketCommentDto[];
  allowedTransitions: TicketStatus[];
}

export interface PlantDetailDto extends PlantSummaryDto {
  opportunityId: string;
  notes: string | null;
  expectedMonthlyKwh: number[];
  expectedSource: string | null;
  assets: PlantAssetDto[];
  events: PlantEventDto[];
  plans: MaintenancePlanDto[];
  contracts: OmContractDto[];
  tickets: TicketSummaryDto[];
}

export interface WarrantyTermDto {
  id: string;
  manufacturer: string;
  category: AssetCategory;
  productYears: number | null;
  performanceYears: number | null;
  performanceEndPct: number | null;
  conditions: string | null;
  documentId: string | null;
  source: string;
  reviewedBy: string | null;
  validFrom: string;
  supersededAt: string | null;
}

/** Garantia com a planta e o ativo, para a lista de vencimentos. */
export interface WarrantyRowDto extends WarrantyDto {
  plantId: string;
  plantName: string;
  accountName: string;
  assetLabel: string;
}

export interface OperationsSettingsDto {
  warrantyAlertDays: number | null;
  renewalNoticeDays: number | null;
  maintenanceLeadDays: number | null;
  slaHours: Partial<Record<TicketPriority, number>>;
  upsellGridKwh: number | null;
  upsellMinBills: number | null;
}

/** Indicadores do pós-venda (modelagem §53). */
export interface AftersalesDashboardDto {
  installedBase: { plants: number; powerKwp: number };
  /** Receita mensal recorrente de O&M, informada à mão, dos contratos ativos. */
  mrrCents: number;
  openTickets: number;
  breachedTickets: number;
  /** Tempo médio até resolver, em horas, dos chamados resolvidos nos últimos 90 dias (nulo sem amostra). */
  mttrHours: number | null;
  ticketsByPlant: { plantId: string; plantName: string; open: number }[];
  /** Garantias que vencem na janela de aviso da empresa; nulo se a empresa não definiu a janela. */
  warrantiesExpiring: number | null;
  warrantiesMissing: number;
  /** Contratos que terminam na janela de aviso da empresa; nulo se a empresa não definiu a janela. */
  contractsExpiring: number | null;
  upsellOpportunities: number;
}
