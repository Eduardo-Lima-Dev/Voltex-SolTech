import type { CustomerGroup, Role, TenantStatus } from '../enums/index.js';
import type { CurrentUser } from '../schemas/auth.js';

/**
 * Formato das respostas JSON da API (datas chegam como string ISO 8601).
 * Mantido junto dos schemas para que API e Web falem exatamente o mesmo contrato.
 */

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  branchId: string | null;
  teamId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDto {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  status: TenantStatus;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface BranchDto {
  id: string;
  tenantId: string;
  name: string;
  city: string | null;
  state: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamDto {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: InvitationStatus;
}

/** Resposta de `POST /invitations`. `devAcceptUrl` só existe fora de produção. */
export interface CreatedInvitationDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
  emailSent: boolean;
  devAcceptUrl?: string;
}

export interface AuditLogDto {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface DocumentDto {
  id: string;
  tenantId: string;
  uploadedById: string | null;
  groupId: string;
  version: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export interface DistributorDto {
  id: string;
  tenantId: string;
  name: string;
  state: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TariffDto {
  id: string;
  tenantId: string;
  distributorId: string;
  customerGroup: CustomerGroup;
  modality: string | null;
  energyCentsPerKwh: number;
  validFrom: string;
  validTo: string | null;
  source: string;
  createdAt: string;
}

export interface SolarResourceDto {
  id: string;
  tenantId: string;
  name: string;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  hspMonthly: number[];
  source: string;
  plane: string;
  createdAt: string;
}

export interface RuleSetDto {
  id: string;
  key: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  validFrom: string | null;
  validTo: string | null;
  definition: Record<string, unknown>;
  sources: { type: string; reference: string; url?: string; notes?: string }[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface SessionResponse {
  accessToken: string;
  /** Validade do access token, em segundos. */
  expiresIn: number;
  user: CurrentUser;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: Record<string, { status: 'up' | 'down'; latencyMs: number; error?: string }>;
  uptimeSeconds: number;
}

export type { CustomerGroup };
