import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_UNAVAILABLE_MESSAGES,
  tenantAiSettingsSchema,
  type AiAdminSettingsDto,
  type AiStatusDto,
  type AiUnavailableCode,
  type TenantAiSettings,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../tenancy/plan.service';
import { AiProvider } from './ai-provider';
import { AiUsageService } from './ai-usage.service';

/**
 * Decide se a IA pode responder AGORA para esta pessoa e empresa, sem chamar o provedor. Cada "não" tem um código e
 * uma mensagem pronta (`AI_UNAVAILABLE_MESSAGES`): o usuário nunca fica esperando sem saber o motivo (ADR-0029).
 */
@Injectable()
export class AiGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly plan: PlanService,
    private readonly provider: AiProvider,
    private readonly usage: AiUsageService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private env<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  get legalReviewed(): boolean {
    return this.env('AI_LEGAL_REVIEWED_AT').trim() !== '';
  }

  async tenantSettings(): Promise<{ ai: TenantAiSettings; demo: boolean }> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    return {
      ai: tenantAiSettingsSchema.parse(settings.ai ?? {}),
      demo: settings.demo === true,
    };
  }

  /** `null` quando pode usar; senão, o código do motivo (sem olhar a cota, que depende da finalidade). */
  async blocker(): Promise<AiUnavailableCode | null> {
    if (
      !this.env('AI_ENABLED') ||
      this.env('AI_PROVIDER') === 'none' ||
      !this.provider.isConfigured()
    )
      return 'ENV_DISABLED';
    if (!(await this.plan.isFeatureEnabled('ai'))) return 'PLAN_EXCLUDES_AI';
    const { ai, demo } = await this.tenantSettings();
    if (!this.legalReviewed && !demo) return 'LEGAL_REVIEW_PENDING';
    if (!ai.enabled) return 'TENANT_DISABLED';
    return null;
  }

  /** Estado para a tela: sempre responde na hora, nunca chama o provedor. */
  async status(): Promise<AiStatusDto> {
    const code = await this.blocker();
    const model = this.env('AI_MODEL_DEFAULT');
    const provider = this.provider.key;
    if (code)
      return {
        available: false,
        code,
        message: AI_UNAVAILABLE_MESSAGES[code],
        provider: code === 'ENV_DISABLED' ? null : provider,
        model: null,
        quota: null,
      };
    const quota = await this.usage.quotaSnapshot();
    const exhausted: AiUnavailableCode | null =
      quota.tenant.remaining <= 0
        ? 'QUOTA_TENANT'
        : quota.user.remaining <= 0
          ? 'QUOTA_USER'
          : null;
    return {
      available: exhausted === null,
      code: exhausted,
      message: exhausted ? AI_UNAVAILABLE_MESSAGES[exhausted] : null,
      provider,
      model,
      quota,
    };
  }

  async adminSettings(): Promise<AiAdminSettingsDto> {
    const { ai, demo } = await this.tenantSettings();
    return { settings: ai, demo, legalReviewed: this.legalReviewed, status: await this.status() };
  }
}
