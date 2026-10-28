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

  /** Conta uma pergunta ao assistente (a chamada ao modelo é contada à parte, em `record`). */
  async recordQuestion(): Promise<void> {
    const day = utcDay(new Date());
    const userKey = this.userKey();
    const tenantId = this.context.requireTenantId();
    const purpose = 'CHAT' as const;
    await this.prisma.db.aiUsage.upsert({
      where: { tenantId_day_userKey_purpose: { tenantId, day, userKey, purpose } },
      create: { tenantId, day, userKey, purpose, questions: 1 },
      update: { questions: { increment: 1 } },
    });
  }

  /** Últimos 30 dias de uso da empresa, para a tela de administração. */
  async history(now = new Date()): Promise<AiUsageDto> {
    const since = new Date(utcDay(now).getTime() - 29 * 86_400_000);
    const rows = await this.prisma.db.aiUsage.findMany({
      where: { day: { gte: since } },
      orderBy: { day: 'desc' },
    });
    // Uma linha por dia e finalidade (o banco guarda uma por usuário também).
    const grouped = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = `${r.day.toISOString()}|${r.purpose}`;
      const cur = grouped.get(key);
      grouped.set(
        key,
        cur
          ? {
              ...cur,
              neurons: cur.neurons + r.neurons,
              calls: cur.calls + r.calls,
              failures: cur.failures + r.failures,
              questions: cur.questions + r.questions,
            }
          : r,
      );
    }
    const days = [...grouped.values()].map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      purpose: r.purpose as AiPurpose,
      neurons: Math.round(r.neurons * 10) / 10,
      calls: r.calls,
      failures: r.failures,
      questions: r.questions,
    }));
    const sum = (pick: (d: (typeof days)[number]) => number) =>
      days.reduce((a, d) => a + pick(d), 0);
    const questions = sum((d) => d.questions);
    const chatNeurons = sum((d) => (d.purpose === 'CHAT' ? d.neurons : 0));
    const average = questions > 0 ? Math.round((chatNeurons / questions) * 10) / 10 : null;
    const [limits, used] = await Promise.all([this.limits(), this.usedToday(now)]);
    const todayKey = utcDay(now).toISOString().slice(0, 10);
    const todayRows = days.filter((d) => d.day === todayKey);
    const room = Math.min(limits.tenant - used.tenant, limits.global - used.global);
    return {
      days,
      totals: {
        neurons: Math.round(sum((d) => d.neurons) * 10) / 10,
        calls: sum((d) => d.calls),
        failures: sum((d) => d.failures),
        questions,
      },
      today: {
        questions: todayRows.reduce((a, d) => a + d.questions, 0),
        neurons: Math.round(todayRows.reduce((a, d) => a + d.neurons, 0) * 10) / 10,
        averageNeuronsPerQuestion: average,
        estimatedQuestionsLeft: average ? Math.max(0, Math.floor(room / average)) : null,
        platform: { used: Math.round(used.global * 10) / 10, limit: limits.global },
        insights: { used: Math.round(used.insights * 10) / 10, limit: limits.insights },
      },
    };
  }
}
