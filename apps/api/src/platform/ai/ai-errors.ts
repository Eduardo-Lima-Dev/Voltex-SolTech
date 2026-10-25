import { HttpException } from '@nestjs/common';
import { AI_UNAVAILABLE_MESSAGES, type AiUnavailableCode } from '@voltex/shared';

const STATUS: Record<AiUnavailableCode, number> = {
  ENV_DISABLED: 503,
  TENANT_DISABLED: 403,
  LEGAL_REVIEW_PENDING: 403,
  PLAN_EXCLUDES_AI: 403,
  QUOTA_TENANT: 429,
  QUOTA_USER: 429,
  QUOTA_GLOBAL: 429,
  PROVIDER_QUOTA: 429,
  PROVIDER_AUTH: 503,
  PROVIDER_DOWN: 503,
  TIMEOUT: 504,
  CIRCUIT_OPEN: 503,
  EMPTY_RESPONSE: 502,
  PRIVACY_BLOCKED: 422,
};

/** A IA não pode responder agora. Já leva a mensagem pronta para o usuário (sem detalhe técnico). */
export class AiUnavailableError extends HttpException {
  constructor(readonly aiCode: AiUnavailableCode) {
    super(
      { code: `AI_${aiCode}`, message: AI_UNAVAILABLE_MESSAGES[aiCode], data: { aiCode } },
      STATUS[aiCode],
    );
  }
}
