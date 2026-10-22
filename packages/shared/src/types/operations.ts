import type { InstallationStatus } from '../enums/index.js';
import type { AcceptanceDto, FieldCommissioningDto } from './commissioning.js';
import type {
  FieldIssueType,
  MaterialItemStatus,
  WorkOrderStatus,
  WorkOrderType,
} from '../schemas/operations.js';

/** Contratos JSON da Operação (Fase 11B). Datas em ISO 8601. */

export interface InstallationSummaryDto {
  id: string;
  projectId: string;
  projectCode: string;
  opportunityId: string;
  accountId: string;
  accountName: string;
  siteLabel: string | null;
  status: InstallationStatus;
  responsibleId: string | null;
  materialsTotal: number;
  materialsReady: number;
  openIssues: number;
  nextScheduledStart: string | null;
  createdAt: string;
}

export interface MaterialItemDto {
  id: string;
  category: string;
  equipmentId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitCostCents: number | null;
  status: MaterialItemStatus;
  supplier: string | null;
  purchaseOrder: string | null;
  orderedCents: number | null;
  expectedAt: string | null;
  receivedAt: string | null;
  separatedAt: string | null;
  note: string | null;
}

export interface ChecklistItemDto {
  id: string;
  label: string;
  done: boolean;
  note: string | null;
  doneAt: string | null;
  doneById: string | null;
}

export interface WorkOrderDto {
  id: string;
  installationId: string | null;
  projectCode: string | null;
  accountId: string | null;
  accountName: string | null;
  siteLabel: string | null;
  type: WorkOrderType;
  status: WorkOrderStatus;
  title: string;
  notes: string | null;
  crewId: string | null;
  crewName: string | null;
  assigneeId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  checklist: ChecklistItemDto[];
  signedByName: string | null;
  signedAt: string | null;
  photoCount: number;
  /** Outras ordens da mesma equipe ou do mesmo técnico no mesmo horário (aviso, não bloqueio). */
  conflictsWith: string[];
}

export interface FieldIssueDto {
  id: string;
  installationId: string;
  workOrderId: string | null;
  type: FieldIssueType;
  description: string;
  blocking: boolean;
  status: 'OPEN' | 'RESOLVED';
  resolution: string | null;
  reportedById: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface InstallationHistoryDto {
  id: string;
  fromStatus: InstallationStatus | null;
  toStatus: InstallationStatus;
  reason: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface InstallationDetailDto extends InstallationSummaryDto {
  engineeringSnapshotId: string | null;
  projectStatus: string;
  materialsGeneratedAt: string | null;
  materialsReadyAt: string | null;
  installedAt: string | null;
  doneAt: string | null;
  cancelReason: string | null;
  /** Aceite do cliente, quando registrado. */
  acceptance: AcceptanceDto | null;
  /** Próximos estados permitidos a partir do atual (a regra fica no servidor). */
  allowedTransitions: InstallationStatus[];
  materials: MaterialItemDto[];
  workOrders: WorkOrderDto[];
  issues: FieldIssueDto[];
  history: InstallationHistoryDto[];
}

export interface CrewDto {
  id: string;
  name: string;
  active: boolean;
  members: { userId: string; name: string }[];
}

export interface AgendaDto {
  from: string;
  to: string;
  orders: WorkOrderDto[];
}

/** Comparação de preços por item (RF-CRM-054): tabelas vigentes de fornecedores diferentes. */
export interface MaterialQuoteDto {
  materialItemId: string;
  description: string;
  quantity: number;
  unit: string;
  plannedUnitCostCents: number | null;
  offers: {
    priceListItemId: string;
    supplier: string;
    sku: string | null;
    unitPriceCents: number;
    totalCents: number;
    validTo: string | null;
    best: boolean;
  }[];
}

export interface OperationsDashboardDto {
  byStatus: Partial<Record<InstallationStatus, number>>;
  scheduledCount: number;
  overdueCount: number;
  awaitingMaterialCount: number;
  openIssuesCount: number;
  crews: { crewId: string; crewName: string; doneLast30Days: number }[];
  /** Instalações com mais de uma ordem de instalação ou com pendência de campo (retrabalho de campo). */
  reworkCount: number;
}

export interface WorkOrderPhotoDto {
  id: string;
  workOrderId: string;
  caption: string | null;
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
  visibleToCustomer: boolean;
  /** Link temporário de leitura (alguns minutos). */
  url: string;
}

/** O que o técnico precisa em campo: a ordem, o local, o contato, as pendências abertas e as fotos. */
export interface FieldWorkOrderDto extends WorkOrderDto {
  address: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  contactName: string | null;
  contactPhone: string | null;
  openIssues: FieldIssueDto[];
  photos: WorkOrderPhotoDto[];
  /** Ensaios do comissionamento, quando a ordem é de comissionamento. */
  commissioning: FieldCommissioningDto | null;
  /** Quando o servidor montou esta cópia: o app a guarda para uso sem internet. */
  fetchedAt: string;
}

export interface FieldSyncResultDto {
  clientActionId: string;
  /** `APPLIED`: aplicada; `DUPLICATE`: já tinha sido recebida; `REJECTED`: o servidor recusou (ver a mensagem). */
  status: 'APPLIED' | 'DUPLICATE' | 'REJECTED';
  message: string | null;
}
