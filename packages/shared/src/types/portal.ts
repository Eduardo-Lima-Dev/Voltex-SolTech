import type { TicketPriority, TicketStatus } from '../schemas/aftersales.js';
import type { ReceivableDto } from './finance.js';
import type { PlantMonitoringPageDto } from './monitoring.js';

export interface PortalMeDto {
  companyName: string;
  accountName: string;
  email: string;
}

export interface PortalMilestoneDto {
  key: string;
  label: string;
  /** `AAAA-MM-DD`; nulo quando ainda não aconteceu (ou a data não foi registrada). */
  date: string | null;
  done: boolean;
}

export interface PortalVisitDto {
  title: string;
  type: string;
  status: string;
  start: string | null;
  end: string | null;
}

export interface PortalDocumentDto {
  id: string;
  kind: 'PROPOSAL' | 'CONTRACT' | 'COMMISSIONING_REPORT' | 'PHOTO' | 'SENT_BY_YOU';
  label: string;
  filename: string;
  createdAt: string;
}

export interface PortalWarrantyDto {
  id: string;
  assetLabel: string;
  kind: string;
  endsOn: string;
  daysLeft: number;
}

export interface PortalTicketDto {
  id: string;
  code: string;
  plantId: string;
  plantName: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PortalTicketCommentDto {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  fromYou: boolean;
}

export interface PortalTicketDetailDto extends PortalTicketDto {
  description: string | null;
  resolution: string | null;
  comments: PortalTicketCommentDto[];
}

export interface PortalUploadDto {
  id: string;
  filename: string;
  note: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  reviewNote: string | null;
  createdAt: string;
}

export interface PortalAcceptanceDto {
  /** `NOT_YET`: ainda não chegou a hora; `PENDING`: o cliente pode dar o aceite; `DONE`: já aceito. */
  status: 'NOT_YET' | 'PENDING' | 'DONE';
  installationId: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
}

export interface PortalPlantDto {
  id: string;
  name: string;
  powerKwp: number | null;
  activatedAt: string;
}

export interface PortalProjectSummaryDto {
  id: string;
  projectCode: string;
  title: string;
  statusLabel: string;
  milestones: PortalMilestoneDto[];
  nextVisit: PortalVisitDto | null;
}

export interface PortalProjectDto extends PortalProjectSummaryDto {
  schedule: PortalVisitDto[];
  documents: PortalDocumentDto[];
  warranties: PortalWarrantyDto[];
  tickets: PortalTicketDto[];
  receivables: Pick<
    ReceivableDto,
    'id' | 'order' | 'referenceId' | 'amountCents' | 'dueOn' | 'paidOn' | 'status'
  >[];
  plant: PortalPlantDto | null;
  monitoring: Pick<PlantMonitoringPageDto, 'snapshot' | 'months' | 'daily' | 'hasExpected'> | null;
  acceptance: PortalAcceptanceDto;
  uploads: PortalUploadDto[];
}

export interface PortalAccessDto {
  id: string;
  accountId: string;
  email: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PortalLinkDto {
  /** O link só aparece aqui, uma vez. Vale 30 minutos e uma única abertura. */
  url: string;
  expiresAt: string;
}

export interface PortalUploadReviewDto extends PortalUploadDto {
  projectId: string;
  projectCode: string;
  accountName: string;
  documentId: string;
}
