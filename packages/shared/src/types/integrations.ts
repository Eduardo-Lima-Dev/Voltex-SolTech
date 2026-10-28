import type {
  CommunicationChannel,
  IntegrationHealth,
  IntegrationKind,
  IntegrationRunStatus,
  IntegrationStatus,
} from '../schemas/integrations.js';

/** Contratos JSON do Integration Hub (datas em ISO 8601). Credenciais nunca saem da API. */

export interface IntegrationCredentialFieldDto {
  name: string;
  label: string;
  /** Segredo: a API nunca devolve o valor, só se está configurado. */
  secret: boolean;
  required: boolean;
  hint: string | null;
}

export interface IntegrationProviderDto {
  key: string;
  kind: IntegrationKind;
  label: string;
  /** `false` = endpoint não oficial (usado pelos apps do fabricante): exige aceite dos termos para ligar. */
  official: boolean;
  docsUrl: string | null;
  licenseStatus: 'PENDING_REVIEW' | 'CLEARED' | 'BLOCKED';
  /** `false` = o adaptador ainda não existe (falta documentação ou contrato do provedor): não dá para ligar. */
  available: boolean;
  notes: string | null;
  credentialFields: IntegrationCredentialFieldDto[];
  /** Ligado no servidor (`INTEGRATIONS_ENABLED_PROVIDERS`). Desligado: nada é consultado na internet. */
  enabled: boolean;
  rateBudget: { perDay?: number; perMonth?: number } | null;
  minIntervalMinutes: number;
}

export interface IntegrationCredentialSummaryDto {
  name: string;
  label: string;
  secret: boolean;
  configured: boolean;
  /** Valor visível apenas dos campos não secretos (ex.: ID da usina). */
  value: string | null;
}

export interface IntegrationConnectionDto {
  id: string;
  provider: string;
  providerLabel: string;
  /** `false` = o adaptador do provedor ainda não existe: a conexão guarda as credenciais, mas não liga. */
  providerAvailable: boolean;
  kind: IntegrationKind;
  label: string;
  status: IntegrationStatus;
  official: boolean;
  health: IntegrationHealth;
  consecutiveFailures: number;
  lastSyncAt: string | null;
  lastError: string | null;
  termsAcceptedAt: string | null;
  termsAcceptedById: string | null;
  config: Record<string, unknown>;
  credentials: IntegrationCredentialSummaryDto[];
  createdAt: string;
}

export interface IntegrationRunDto {
  id: string;
  connectionId: string;
  trigger: string;
  status: IntegrationRunStatus;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  summary: Record<string, unknown>;
}

export interface IntegrationDeadLetterDto {
  id: string;
  connectionId: string;
  error: string;
  attempts: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CommunicationTemplateDto {
  id: string;
  label: string;
  variables: string[];
}

export interface CommunicationLogDto {
  id: string;
  channel: CommunicationChannel;
  template: string;
  recipient: string | null;
  subject: string | null;
  entityType: string | null;
  entityId: string | null;
  accountId: string | null;
  sentById: string | null;
  createdAt: string;
}

export interface WhatsAppLinkDto {
  url: string;
  text: string;
  log: CommunicationLogDto;
}
