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
  /** CNPJ (só dígitos), quando veio da ANEEL. */
  cnpj: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AneelImportResult {
  rowsRead: number;
  distributorsCreated: number;
  distributorsUpdated: number;
  tariffsCreated: number;
  tariffsUpdated: number;
  tariffsUnchanged: number;
  /** Linhas de tarifa lidas e descartadas (fora do escopo importado ou com unidade diferente de MWh). */
  rowsSkipped: number;
  source: { dataset: string; license: string; url: string };
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
  /** Temperaturas mensais vindas da Central de Dados (não são a temperatura de projeto). */
  temperatures: {
    meanC: (number | null)[];
    minC: (number | null)[];
    maxC: (number | null)[];
    source: string;
    note: string;
  } | null;
  createdAt: string;
}

export interface RuleSetDto {
  id: string;
  key: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  validFrom: string | null;
  validTo: string | null;
  /** Escopo da regra (distribuidora, estado, tipo de projeto, grupo); nulo = geral. */
  scope: Record<string, string> | null;
  scopeKey: string;
  definition: Record<string, unknown>;
  sources: { type: string; reference: string; url?: string; notes?: string }[];
  reviewedBy: string | null;
  reviewedByRegistration: string | null;
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
export * from './crm.js';
export * from './commercial.js';
export * from './delivery.js';
export * from './privacy.js';
export * from './data-hub.js';
export * from './equipment.js';
export * from './engineering.js';
export * from './engineering-management.js';
export * from './offgrid.js';
export * from './integrations.js';
export * from './operations.js';
export * from './commissioning.js';
export * from './aftersales.js';
export * from './finance.js';
