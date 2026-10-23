/**
 * Prazos de retenção LGPD (Lei 13.709/2018).
 * Após o prazo, dados pessoais são purgados automaticamente.
 */

export const RETENTION_DEFAULTS = {
  // Fotos de campo: 3 anos (prazos de garantia + LB)
  FIELD_PHOTOS_DAYS: 3 * 365,

  // Geolocalização (field actions): 2 anos (cobertura de chamados)
  GEOLOCATION_DAYS: 2 * 365,

  // Acessos ao portal: 2 anos (histórico de sessão)
  PORTAL_SESSIONS_DAYS: 2 * 365,

  // Logs de comunicação (e-mail, WhatsApp): 1 ano
  COMMUNICATION_LOGS_DAYS: 1 * 365,

  // Audit logs (anônimos): 7 anos (compliance fiscal)
  AUDIT_LOGS_DAYS: 7 * 365,

  // Documentos assinados (contratos, propostas): 10 anos (SPC)
  SIGNED_DOCUMENTS_DAYS: 10 * 365,

  // Dados de chamado/ticket: 3 anos (pós-garantia)
  TICKETS_DAYS: 3 * 365,
} as const;

export type RetentionKey = keyof typeof RETENTION_DEFAULTS;

/**
 * Retorna quantos dias faltam até purga.
 */
export function daysUntilPurge(createdAt: Date, retentionDays: number): number {
  const purgeDate = new Date(createdAt);
  purgeDate.setDate(purgeDate.getDate() + retentionDays);
  const daysLeft = Math.ceil((purgeDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysLeft);
}

/**
 * Verifica se um registro deve ser purgado.
 */
export function shouldPurge(createdAt: Date, retentionDays: number): boolean {
  return daysUntilPurge(createdAt, retentionDays) === 0;
}
