import { z } from 'zod';

/** Integration Hub (Fase 11A, ADR-0019): contratos de entrada da API. */

export const INTEGRATION_KINDS = ['MONITORING', 'SIGNATURE'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const INTEGRATION_STATUSES = ['DISABLED', 'ACTIVE', 'PAUSED'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const INTEGRATION_HEALTHS = ['UNKNOWN', 'GREEN', 'YELLOW', 'RED'] as const;
export type IntegrationHealth = (typeof INTEGRATION_HEALTHS)[number];

export const INTEGRATION_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const;
export type IntegrationRunStatus = (typeof INTEGRATION_RUN_STATUSES)[number];

export const COMMUNICATION_CHANNELS = ['EMAIL', 'WHATSAPP_LINK', 'COPY_LINK'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

/** Falhas seguidas que pausam a conexão e mandam o trabalho para a fila de falhas. */
export const INTEGRATION_MAX_FAILURES = 5;

export const createIntegrationConnectionSchema = z.object({
  provider: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  /** Campos definidos pelo adaptador (`credentialFields`); validados contra o schema do adaptador. */
  credentials: z.record(z.string(), z.string().max(4000)),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type CreateIntegrationConnectionInput = z.infer<typeof createIntegrationConnectionSchema>;

export const updateIntegrationConnectionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  /** Só os campos enviados são trocados; os demais continuam como estavam. */
  credentials: z.record(z.string(), z.string().max(4000)).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateIntegrationConnectionInput = z.infer<typeof updateIntegrationConnectionSchema>;

export const activateIntegrationConnectionSchema = z.object({
  /** Obrigatório para endpoints não oficiais: o administrador assume o risco de violar os termos do provedor. */
  acceptTerms: z.boolean().default(false),
});
export type ActivateIntegrationConnectionInput = z.infer<
  typeof activateIntegrationConnectionSchema
>;

export const listIntegrationRunsQuerySchema = z.object({
  connectionId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Modelos de mensagem conhecidos (o texto fica no código; ver `communication-templates.ts` na API). */
export const sendEmailSchema = z.object({
  template: z.string().trim().min(1).max(80),
  to: z.email(),
  variables: z.record(z.string(), z.string().max(2000)).default({}),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.uuid().optional(),
  accountId: z.uuid().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export const whatsAppLinkSchema = z.object({
  template: z.string().trim().min(1).max(80),
  /** Telefone com DDD; o sistema normaliza para o formato internacional (Brasil, +55). */
  phone: z.string().trim().min(8).max(20),
  variables: z.record(z.string(), z.string().max(2000)).default({}),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.uuid().optional(),
  accountId: z.uuid().optional(),
});
export type WhatsAppLinkInput = z.infer<typeof whatsAppLinkSchema>;

export const logCopiedLinkSchema = z.object({
  template: z.string().trim().min(1).max(80),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.uuid().optional(),
  accountId: z.uuid().optional(),
});
export type LogCopiedLinkInput = z.infer<typeof logCopiedLinkSchema>;

export const listCommunicationsQuerySchema = z.object({
  entityType: z.string().trim().max(64).optional(),
  entityId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Plano da empresa (RF-PLAT-013), guardado em `tenant.settings.plan`. Sem plano: tudo liberado, sem limites. */
export const tenantPlanSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** `true`/`false` por recurso. Recurso ausente = liberado. */
  features: z.record(z.string(), z.boolean()).default({}),
  limits: z
    .object({
      users: z.number().int().positive().optional(),
      monitoringConnections: z.number().int().positive().optional(),
      storageMb: z.number().int().positive().optional(),
      /** Cotas diárias de IA, em *neurons* do provedor (Fase 12). Sem valor: padrão da plataforma. */
      aiDailyNeurons: z.number().int().min(0).optional(),
      aiDailyNeuronsPerUser: z.number().int().min(0).optional(),
      aiInsightsDailyNeurons: z.number().int().min(0).optional(),
    })
    .default({}),
});
export type TenantPlan = z.infer<typeof tenantPlanSchema>;
