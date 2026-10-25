import { z } from 'zod';

/**
 * Inteligência artificial (Fase 12, ADR-0029): códigos de indisponibilidade, mensagens fixas em português e
 * configurações da empresa. O usuário nunca fica esperando: cada falha tem uma resposta pronta, escrita aqui.
 */

export const AI_UNAVAILABLE_CODES = [
  /** `AI_ENABLED=false`, sem provedor ou sem credencial: o ambiente não tem IA. */
  'ENV_DISABLED',
  /** A empresa não ligou (ou o administrador ainda não aceitou os termos). */
  'TENANT_DISABLED',
  /** Aguardando a revisão jurídica: só empresas de demonstração usam a IA. */
  'LEGAL_REVIEW_PENDING',
  /** O plano da empresa não inclui a IA. */
  'PLAN_EXCLUDES_AI',
  /** Cota diária da empresa esgotada. */
  'QUOTA_TENANT',
  /** Cota diária do usuário esgotada. */
  'QUOTA_USER',
  /** Teto diário da plataforma esgotado (a cota grátis do provedor). */
  'QUOTA_GLOBAL',
  /** O provedor recusou por limite de uso (a cota grátis dele acabou). */
  'PROVIDER_QUOTA',
  /** Credencial recusada pelo provedor. */
  'PROVIDER_AUTH',
  /** Provedor fora do ar, erro 5xx ou rede. */
  'PROVIDER_DOWN',
  /** O provedor não respondeu no prazo. */
  'TIMEOUT',
  /** Falhas seguidas: o sistema parou de tentar por alguns instantes. */
  'CIRCUIT_OPEN',
  /** O modelo respondeu vazio (acontece com modelos que "pensam" além do limite). */
  'EMPTY_RESPONSE',
] as const;
export type AiUnavailableCode = (typeof AI_UNAVAILABLE_CODES)[number];

/** Hora (Brasília) em que as cotas do dia voltam: os contadores viram à meia-noite UTC. */
export const AI_QUOTA_RESET_LABEL = '21h (horário de Brasília)';

export const AI_UNAVAILABLE_MESSAGES: Record<AiUnavailableCode, string> = {
  ENV_DISABLED: 'O assistente de IA não está disponível neste ambiente.',
  TENANT_DISABLED:
    'O assistente de IA está desligado na sua empresa. Um administrador pode ligar em Administração → Inteligência.',
  LEGAL_REVIEW_PENDING:
    'O assistente de IA ainda não foi liberado para empresas reais: ele aguarda a revisão jurídica dos termos. Por enquanto só funciona em empresas de demonstração.',
  PLAN_EXCLUDES_AI: 'O plano da sua empresa não inclui o assistente de IA.',
  QUOTA_TENANT: `O limite de uso da IA da sua empresa foi atingido hoje. Ele volta às ${AI_QUOTA_RESET_LABEL}.`,
  QUOTA_USER: `O seu limite de uso da IA foi atingido hoje. Ele volta às ${AI_QUOTA_RESET_LABEL}.`,
  QUOTA_GLOBAL: `O assistente atingiu o limite de uso do dia. Ele volta às ${AI_QUOTA_RESET_LABEL}.`,
  PROVIDER_QUOTA: 'O assistente atingiu o limite de uso do dia. Tente de novo amanhã.',
  PROVIDER_AUTH:
    'O assistente de IA está indisponível: a credencial do serviço foi recusada. Avise a administração.',
  PROVIDER_DOWN:
    'O assistente de IA está indisponível no momento. Os dados do sistema continuam acessíveis normalmente.',
  TIMEOUT: 'A IA demorou demais para responder. Tente de novo em instantes.',
  CIRCUIT_OPEN:
    'O assistente de IA está instável e foi pausado por alguns instantes. Os dados do sistema continuam acessíveis normalmente.',
  EMPTY_RESPONSE: 'A IA não conseguiu montar uma resposta. Tente reformular a pergunta.',
};

/** Códigos que o usuário pode resolver esperando (cota) ou que merecem aviso à administração. */
export const AI_QUOTA_CODES: readonly AiUnavailableCode[] = [
  'QUOTA_TENANT',
  'QUOTA_USER',
  'QUOTA_GLOBAL',
  'PROVIDER_QUOTA',
];

/** Configuração da IA na empresa, guardada em `tenant.settings.ai`. */
export const tenantAiSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  termsAcceptedBy: z.string().nullable().default(null),
  termsAcceptedAt: z.string().nullable().default(null),
});
export type TenantAiSettings = z.infer<typeof tenantAiSettingsSchema>;

/** Liga ou desliga a IA da empresa. Ligar exige o aceite dos termos de uso da IA. */
export const updateAiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    acceptTerms: z.boolean().optional(),
  })
  .refine((v) => !v.enabled || v.acceptTerms === true, {
    path: ['acceptTerms'],
    message: 'Para ligar a IA é preciso aceitar os termos de uso da IA',
  });
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

export const AI_PURPOSES = ['CHAT', 'INSIGHTS', 'PROCUREMENT', 'DIAGNOSTICS'] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];
