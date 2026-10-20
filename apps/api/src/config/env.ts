import { z } from 'zod';

const DEV_JWT_SECRET_MARKER = 'dev-only';
/** 32 bytes em base64, SÓ para desenvolvimento e testes: em produção a validação recusa. */
export const DEV_DATA_ENCRYPTION_KEY = Buffer.from('voltex-dev-only-encryption-key!!').toString(
  'base64',
);

/** Converte "15m", "7d", "3600s" ou um número de segundos em segundos. */
export function parseDurationToSeconds(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(value.trim());
  if (!match) throw new Error(`Duração inválida: "${value}" (use ex.: 15m, 7d, 3600)`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] as number;
  return amount * factor;
}

const durationSchema = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) => parseDurationToSeconds(v));

const booleanFromString = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Porta da API. Hospedagens como a Render informam a porta em `PORT`; `API_PORT` tem prioridade. */
    API_PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(Number(process.env.PORT) || 3000),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    WEB_URL: z.string().default('http://localhost:5173'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    REDIS_URL: z.string().default('redis://localhost:6379'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres'),
    JWT_ACCESS_TTL: durationSchema('15m'),
    JWT_REFRESH_TTL: durationSchema('7d'),
    INVITATION_TTL: durationSchema('7d'),
    /** Janela (ms) em que reapresentar um refresh token recém-rotacionado não é tratado como roubo. */
    REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),

    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('voltex-documents'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    /** `AES256` pede ao armazenamento que cifre os arquivos em repouso (o S3 da AWS faz; confira se o seu suporta). */
    S3_SERVER_SIDE_ENCRYPTION: z.enum(['none', 'AES256']).default('none'),
    S3_FORCE_PATH_STYLE: booleanFromString.default(true),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 1024 * 1024),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    MAIL_FROM: z.string().default('Voltex SolTech <no-reply@voltex.local>'),

    /** Quantos proxies confiáveis ficam na frente da API (nginx = 1): o IP do cliente vem de `X-Forwarded-For`. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /**
     * Chave-mestra (32 bytes em base64) dos campos pessoais cifrados (CPF/CNPJ). Obrigatória em produção; perdê-la
     * torna esses dados ilegíveis, então guarde cópia separada do backup do banco. Gere com `openssl rand -base64 32`.
     */
    DATA_ENCRYPTION_KEY: z.string().default(DEV_DATA_ENCRYPTION_KEY),
    /** Chaves ANTERIORES (base64, separadas por vírgula): só leitura/busca durante o rodízio. Veja `rotate-encryption-key`. */
    DATA_ENCRYPTION_KEY_PREVIOUS: z.string().default(''),
    /** Liga `GET /api/v1/metrics` (Prometheus) para quem enviar `Authorization: Bearer <token>`. Vazio = desligado. */
    METRICS_TOKEN: z.string().min(16).optional(),
    THROTTLE_DISABLED: booleanFromString.default(false),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
    /** 0 desliga o worker do outbox (usado nos testes, que o acionam manualmente). */
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
    /** Varredura das automações do CRM (SLA de lead, fatura não recebida). 0 desliga o agendamento. */
    AUTOMATION_SCAN_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
    /** Prefixo das chaves da fila no Redis (os testes usam um por processo). */
    AUTOMATION_QUEUE_PREFIX: z.string().default('voltex'),
    /** Rotina diária da política de retenção (LGPD). 0 desliga o agendamento. */
    AUTOMATION_RETENTION_INTERVAL_MS: z.coerce.number().int().min(0).default(86_400_000),
    /**
     * Fontes externas que a Central de Dados pode consultar na internet, separadas por vírgula (ex.:
     * `nasa-power,pvgis,aneel-tariffs`). Vazio = nenhuma. É a decisão explícita de ligar uma fonte, depois de
     * conferir os termos de uso (docs/referencias/fontes-externas.md). O que já está em cache continua disponível.
     */
    DATA_HUB_ENABLED_SOURCES: z.string().default(''),
    /** Intervalo da vigilância de páginas (ms). Padrão: semanal. 0 desliga o agendamento. */
    DATA_HUB_WATCH_INTERVAL_MS: z.coerce.number().int().min(0).default(604_800_000),
    /** Intervalo da busca de tarifas novas na ANEEL (ms). Padrão: mensal. 0 desliga o agendamento. */
    DATA_HUB_TARIFF_INTERVAL_MS: z.coerce.number().int().min(0).default(2_592_000_000),
  })
  .superRefine((env, ctx) => {
    const previous = env.DATA_ENCRYPTION_KEY_PREVIOUS.split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    for (const [i, key] of previous.entries())
      if (Buffer.from(key, 'base64').length !== 32)
        ctx.addIssue({
          code: 'custom',
          path: ['DATA_ENCRYPTION_KEY_PREVIOUS'],
          message: `a chave anterior nº ${i + 1} deve ter 32 bytes em base64`,
        });
    if (Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length !== 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY'],
        message: 'deve ter 32 bytes em base64 (gere com: openssl rand -base64 32)',
      });
    }
    if (env.NODE_ENV === 'production' && env.DATA_ENCRYPTION_KEY === DEV_DATA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY'],
        message: 'a chave de desenvolvimento não pode ser usada em produção: defina a sua',
      });
    }
    if (env.NODE_ENV === 'production' && env.JWT_SECRET.includes(DEV_JWT_SECRET_MARKER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET de desenvolvimento não pode ser usada em produção',
      });
    }
  });

export type Env = z.output<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return result.data;
}
