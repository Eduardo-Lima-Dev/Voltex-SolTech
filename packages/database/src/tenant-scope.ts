/**
 * Modelos com coluna `tenantId`. A extensão de tenant da API (Fase 4) injeta o filtro
 * automaticamente nestes modelos. Todo modelo novo com `tenantId` DEVE entrar aqui —
 * `tenant-scope.test.ts` falha se algum for esquecido.
 */
export const TENANT_SCOPED_MODELS = [
  'Branch',
  'Team',
  'User',
  'RefreshToken',
  'AuditLog',
  'OutboxEvent',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

export const isTenantScopedModel = (model: string): model is TenantScopedModel =>
  (TENANT_SCOPED_MODELS as readonly string[]).includes(model);
