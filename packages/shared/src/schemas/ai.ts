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
  /** O conteúdo a enviar ainda tinha dado pessoal: por segurança, nada foi enviado ao provedor. */
  'PRIVACY_BLOCKED',
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
  PRIVACY_BLOCKED:
    'Por segurança, a pergunta não foi enviada à IA porque ainda continha dado pessoal. Reformule sem CPF, CNPJ, e-mail, telefone ou endereço.',
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

/** Motivos pelos quais o assistente diz que NÃO pode responder (texto fixo do sistema, nunca do modelo). */
export const AI_CANNOT_ANSWER_REASONS = [
  'NO_DATA',
  'NO_TOOL',
  'ACCESS_DENIED',
  'OUT_OF_SCOPE',
  'INSUFFICIENT_SAMPLE',
] as const;
export type AiCannotAnswerReason = (typeof AI_CANNOT_ANSWER_REASONS)[number];

export const AI_CANNOT_ANSWER_MESSAGES: Record<AiCannotAnswerReason, string> = {
  NO_DATA: 'Não posso responder: o sistema não tem esse dado registrado.',
  NO_TOOL:
    'Não posso responder: essa informação não está entre as que o assistente consegue consultar.',
  ACCESS_DENIED: 'Não posso responder: o seu perfil não tem acesso a essa informação.',
  OUT_OF_SCOPE:
    'Não posso responder: a pergunta está fora do que o assistente cobre (os dados da sua empresa no sistema).',
  INSUFFICIENT_SAMPLE: 'Não posso responder com segurança: há poucos registros para essa análise.',
};

/** Pergunta ao assistente. `context` é a tela de onde a pessoa pergunta (para o assistente saber de qual projeto ou cliente fala). */
export const aiChatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  question: z
    .string()
    .trim()
    .min(2, 'Escreva a pergunta')
    .max(1000, 'A pergunta pode ter até 1.000 caracteres'),
  context: z
    .object({
      /** Código do projeto da tela (ex.: VLX-ABC12345). */
      projectCode: z.string().trim().max(40).optional(),
      /** Nome da tela (ex.: `financeiro`, `funil`, `planta`), só para a conversa começar no assunto certo. */
      screen: z.string().trim().max(40).optional(),
    })
    .optional(),
});
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const aiFeedbackSchema = z.object({
  helpful: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});
export type AiFeedbackInput = z.infer<typeof aiFeedbackSchema>;

// ---- Insights proativos (12G) ----

export const INSIGHT_SEVERITIES = ['INFO', 'ATTENTION', 'CRITICAL'] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const INSIGHT_STATUSES = ['NEW', 'SEEN', 'RESOLVED', 'DISMISSED'] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

/** Detectores de insight. Cada um é uma regra determinística; a IA só redige a frase. */
export const INSIGHT_KINDS = [
  'OVERDUE_RECEIVABLES',
  'STALLED_OPPORTUNITIES',
  'OVERDUE_INSTALLATIONS',
  'WARRANTIES_EXPIRING',
  'BREACHED_TICKETS',
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

/**
 * Parâmetros PADRÃO dos detectores (não são norma): a parcela só vira achado depois deste atraso. As demais regras
 * usam os prazos que a empresa já configurou (oportunidade parada na analítica, garantia a vencer na operação).
 */
export const INSIGHT_DEFAULTS = {
  overdueReceivableMinDays: 7,
  /** Um insight dispensado ou resolvido por uma pessoa só volta depois deste prazo. */
  reopenAfterDays: 30,
} as const;

/** Muda a situação de um insight. `NEW` só é gerado pela rotina. */
export const updateInsightSchema = z.object({
  status: z.enum(['SEEN', 'RESOLVED', 'DISMISSED']),
  helpful: z.boolean().optional(),
});
export type UpdateInsightInput = z.infer<typeof updateInsightSchema>;

// ---- Procurement assistido (12H) ----

/** Uma linha de preço como o modelo a devolve. Tudo texto/número simples; o servidor revalida. */
export const extractedPriceRowSchema = z.object({
  manufacturer: z.string().trim().max(120).default(''),
  model: z.string().trim().max(120).default(''),
  description: z.string().trim().max(200).default(''),
  supplier: z.string().trim().max(120).default(''),
  sku: z.string().trim().max(80).default(''),
  /** Preço em reais, como número. */
  priceReais: z.number().nonnegative().max(100_000_000),
  validFrom: z.string().trim().max(10).default(''),
  validTo: z.string().trim().max(10).default(''),
  /** Trecho do documento de onde a linha saiu (para a pessoa conferir). */
  excerpt: z.string().trim().max(300).default(''),
});
export type ExtractedPriceRow = z.infer<typeof extractedPriceRowSchema>;

export const extractedPricesSchema = z.object({
  rows: z.array(extractedPriceRowSchema).max(200),
});

/** Confirmação da prévia: quais linhas importar, com possíveis correções da pessoa. */
export const confirmPriceExtractionSchema = z.object({
  rows: z
    .array(
      extractedPriceRowSchema
        .pick({
          manufacturer: true,
          model: true,
          description: true,
          supplier: true,
          sku: true,
          priceReais: true,
          validFrom: true,
          validTo: true,
        })
        .extend({ index: z.number().int().min(0) }),
    )
    .min(1)
    .max(200),
});
export type ConfirmPriceExtractionInput = z.infer<typeof confirmPriceExtractionSchema>;
