import { z } from 'zod';

const DEV_JWT_SECRET_MARKER = 'dev-only';

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
    API_PORT: z.coerce.number().int().positive().default(3000),
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
    S3_FORCE_PATH_STYLE: booleanFromString.default(true),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 1024 * 1024),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    MAIL_FROM: z.string().default('Voltex SolTech <no-reply@voltex.local>'),

    THROTTLE_DISABLED: booleanFromString.default(false),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
    /** 0 desliga o worker do outbox (usado nos testes, que o acionam manualmente). */
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
    /** Varredura das automações do CRM (SLA de lead, fatura não recebida). 0 desliga o agendamento. */
    AUTOMATION_SCAN_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
    /** Prefixo das chaves da fila no Redis (os testes usam um por processo). */
    AUTOMATION_QUEUE_PREFIX: z.string().default('voltex'),
  })
  .superRefine((env, ctx) => {
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
