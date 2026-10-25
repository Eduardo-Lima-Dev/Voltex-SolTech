import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiPurpose, AiQuotaDto, AiUsageDto } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import type { Env } from '../../config/env';
import { PlanService } from '../tenancy/plan.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  isInsightsPurpose,
  nextReset,
  utcDay,
  type QuotaLimits,
  type QuotaUsage,
} from './ai-quota';

/** Contagem diária do uso de IA (em *neurons*) e as cotas que decidem se ainda dá para chamar. */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly plan: PlanService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async limits(): Promise<QuotaLimits> {
    const plan = (await this.plan.getPlan())?.limits;
    const env = (k: keyof Env) => this.config.get(k, { infer: true }) as number;
    return {
      global: env('AI_DAILY_NEURONS_GLOBAL'),
      tenant: plan?.aiDailyNeurons ?? env('AI_DEFAULT_TENANT_DAILY_NEURONS'),
      user: plan?.aiDailyNeuronsPerUser ?? env('AI_DEFAULT_USER_DAILY_NEURONS'),
      insights: plan?.aiInsightsDailyNeurons ?? env('AI_DEFAULT_INSIGHTS_DAILY_NEURONS'),
    };
  }

  private userKey(): string {
    return this.context.userId ?? 'system';
  }

  /** Uso de hoje (dia UTC): plataforma, empresa, usuário e insights. */
  async usedToday(now = new Date()): Promise<QuotaUsage> {
    const day = utcDay(now);
    const userKey = this.userKey();
    const [global, rows] = await Promise.all([
      // Soma da plataforma inteira: precisa enxergar todas as empresas, e só devolve um total.
      this.prisma.system.aiUsage.aggregate({ where: { day }, _sum: { neurons: true } }),
      this.prisma.db.aiUsage.findMany({ where: { day } }),
    ]);
    const sum = (list: typeof rows) => list.reduce((acc, r) => acc + r.neurons, 0);
    const main = rows.filter((r) => !isInsightsPurpose(r.purpose as AiPurpose));
    return {
      global: global._sum.neurons ?? 0,
      tenant: sum(main),
      user: sum(main.filter((r) => r.userKey === userKey)),
      insights: sum(rows.filter((r) => isInsightsPurpose(r.purpose as AiPurpose))),
    };
  }

  async quotaSnapshot(now = new Date()): Promise<AiQuotaDto> {
    const [limits, used] = await Promise.all([this.limits(), this.usedToday(now)]);
    const remaining = (limit: number, u: number) => Math.max(0, Math.round((limit - u) * 10) / 10);
    return {
      tenant: {
        limit: limits.tenant,
        used: used.tenant,
        remaining: remaining(limits.tenant, used.tenant),
      },
      user: { limit: limits.user, used: used.user, remaining: remaining(limits.user, used.user) },
      resetsAt: nextReset(now).toISOString(),
    };
  }

  /** Registra uma chamada (com o custo informado pelo provedor, se houver). Falha também conta. */
  async record(
    purpose: AiPurpose,
    result: { neurons: number | null; failed: boolean },
  ): Promise<void> {
    const day = utcDay(new Date());
    const userKey = this.userKey();
    const tenantId = this.context.requireTenantId();
    const neurons = result.neurons ?? 0;
    await this.prisma.db.aiUsage.upsert({
      where: { tenantId_day_userKey_purpose: { tenantId, day, userKey, purpose } },
      create: {
        tenantId,
        day,
        userKey,
        purpose,
        neurons,
        calls: 1,
        failures: result.failed ? 1 : 0,
      },
      update: {
        neurons: { increment: neurons },
        calls: { increment: 1 },
        failures: { increment: result.failed ? 1 : 0 },
      },
    });
  }

  /** Últimos 30 dias de uso da empresa, para a tela de administração. */
  async history(now = new Date()): Promise<AiUsageDto> {
    const since = new Date(utcDay(now).getTime() - 29 * 86_400_000);
    const rows = await this.prisma.db.aiUsage.findMany({
      where: { day: { gte: since } },
      orderBy: { day: 'desc' },
    });
    const days = rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      purpose: r.purpose as AiPurpose,
      neurons: Math.round(r.neurons * 10) / 10,
      calls: r.calls,
      failures: r.failures,
    }));
    return {
      days,
      totals: {
        neurons: Math.round(days.reduce((a, d) => a + d.neurons, 0) * 10) / 10,
        calls: days.reduce((a, d) => a + d.calls, 0),
        failures: days.reduce((a, d) => a + d.failures, 0),
      },
    };
  }
}
