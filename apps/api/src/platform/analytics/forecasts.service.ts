import { Injectable, NotFoundException } from '@nestjs/common';
import {
  forecastFunnel,
  forecastGeneration,
  forecastInstallations,
  forecastReceivables,
  type ClosedOpportunity,
  type DurationsByStatus,
  type Forecast,
  type FunnelForecast,
  type GenerationForecast,
  type InstallationForecast,
  type ReceivablesForecast,
} from '@voltex/solar-engine';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

const DAY = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Dados históricos da empresa → funções puras de previsão (Fase 12I, `docs/06-calculos/previsoes.md`). */
@Injectable()
export class ForecastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly analytics: AnalyticsService,
  ) {}

  async receivables(now = new Date()): Promise<Forecast<ReceivablesForecast>> {
    const { minSamples } = await this.analytics.settings();
    const db = this.prisma.db;
    const [open, paid] = await Promise.all([
      db.receivable.findMany({
        where: { status: { in: ['OPEN', 'OVERDUE'] } },
        select: { amountCents: true, dueAt: true },
      }),
      db.receivable.findMany({
        where: { status: 'PAID', paidAt: { not: null } },
        select: { dueAt: true, paidAt: true },
      }),
    ]);
    return forecastReceivables({
      open: open.map((r) => ({ amountCents: r.amountCents, dueOn: iso(r.dueAt) })),
      paid: paid.flatMap((r) => (r.paidAt ? [{ dueOn: iso(r.dueAt), paidOn: iso(r.paidAt) }] : [])),
      today: iso(now),
      minPaid: minSamples.receivablesPaid,
    });
  }

  async funnel(now = new Date()): Promise<Forecast<FunnelForecast>> {
    const { minSamples } = await this.analytics.settings();
    const db = this.prisma.db;
    const [closedRows, openRows] = await Promise.all([
      db.opportunity.findMany({
        where: { deletedAt: null, status: { in: ['WON', 'LOST'] } },
        select: { id: true, status: true, createdAt: true, stageChangedAt: true },
      }),
      db.opportunity.findMany({
        where: { deletedAt: null, status: 'OPEN' },
        select: { id: true, stage: true, expectedCloseDate: true, createdAt: true },
      }),
    ]);
    const events = closedRows.length
      ? await db.timelineEvent.findMany({
          where: {
            opportunityId: { in: closedRows.map((o) => o.id) },
            type: { in: ['CREATED', 'STAGE_CHANGED'] },
          },
          orderBy: { createdAt: 'asc' },
          select: { opportunityId: true, type: true, data: true },
        })
      : [];
    const reached = new Map<string, string[]>();
    for (const e of events) {
      const data = (e.data ?? {}) as { stage?: string; to?: string };
      const stage = e.type === 'CREATED' ? (data.stage ?? 'NEW_LEAD') : data.to;
      if (!stage) continue;
      const list = reached.get(e.opportunityId) ?? [];
      if (!list.includes(stage)) list.push(stage);
      reached.set(e.opportunityId, list);
    }
    const closed: ClosedOpportunity[] = closedRows.map((o) => ({
      reached: reached.get(o.id) ?? [],
      won: o.status === 'WON',
      // O ganho não tem data própria na oportunidade: a última mudança de etapa é a melhor aproximação.
      cycleDays:
        o.status === 'WON'
          ? Math.max(0, Math.round((o.stageChangedAt.getTime() - o.createdAt.getTime()) / DAY))
          : null,
    }));
    const quotes = openRows.length
      ? await db.quote.findMany({
          where: { opportunityId: { in: openRows.map((o) => o.id) }, deletedAt: null },
          orderBy: { version: 'desc' },
          select: { opportunityId: true, priceCents: true },
        })
      : [];
    const value = new Map<string, number>();
    for (const q of quotes)
      if (!value.has(q.opportunityId)) value.set(q.opportunityId, q.priceCents);
    return forecastFunnel({
      open: openRows.map((o) => ({
        stage: o.stage,
        valueCents: value.get(o.id) ?? null,
        expectedCloseDate: o.expectedCloseDate ? iso(o.expectedCloseDate) : null,
        createdAt: iso(o.createdAt),
      })),
      closed,
      today: iso(now),
      minClosed: minSamples.funnelClosed,
      minStageClosed: minSamples.groupSize,
    });
  }

  async installations(now = new Date()): Promise<Forecast<InstallationForecast>> {
    const { minSamples } = await this.analytics.settings();
    const db = this.prisma.db;
    const rows = await db.installation.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      select: { id: true, status: true, createdAt: true },
    });
    const history = rows.length
      ? await db.installationHistory.findMany({
          where: { installationId: { in: rows.map((r) => r.id) } },
          orderBy: { createdAt: 'asc' },
          select: { installationId: true, toStatus: true, createdAt: true },
        })
      : [];
    const byInstallation = new Map<string, typeof history>();
    for (const h of history) {
      const list = byInstallation.get(h.installationId) ?? [];
      list.push(h);
      byInstallation.set(h.installationId, list);
    }
    const done: DurationsByStatus[] = [];
    const current: { id: string; status: string; enteredAt: string }[] = [];
    for (const r of rows) {
      const list = byInstallation.get(r.id) ?? [];
      if (r.status === 'DONE') {
        const durations: Record<string, number> = {};
        list.forEach((h, i) => {
          const next = list[i + 1];
          if (!next || h.toStatus === 'DONE') return;
          const days = (next.createdAt.getTime() - h.createdAt.getTime()) / DAY;
          durations[h.toStatus] = (durations[h.toStatus] ?? 0) + days;
        });
        done.push(durations);
      } else {
        const last = list[list.length - 1];
        current.push({
          id: r.id,
          status: r.status,
          enteredAt: iso(last?.createdAt ?? r.createdAt),
        });
      }
    }
    return forecastInstallations({
      done,
      current,
      today: iso(now),
      minDone: minSamples.installationsDone,
    });
  }

  async generation(
    projectCode: string,
    now = new Date(),
  ): Promise<Forecast<GenerationForecast> & { projectCode: string }> {
    const { minSamples } = await this.analytics.settings();
    const plant = await this.prisma.db.plant.findFirst({
      where: { projectCode: projectCode.toUpperCase() },
      select: { id: true, projectCode: true, expectedMonthlyKwh: true },
    });
    if (!plant) throw new NotFoundException('Planta não encontrada');
    const from = new Date(now.getTime() - 29 * DAY);
    const readings = await this.prisma.db.monitoringDaily.findMany({
      where: { plantId: plant.id, date: { gte: from } },
      select: { date: true, kwhGenerated: true },
    });
    // Mais de uma fonte no mesmo dia: vale a maior leitura, para não contar a geração em dobro.
    const perDay = new Map<string, number>();
    for (const r of readings) {
      const key = iso(r.date);
      perDay.set(key, Math.max(perDay.get(key) ?? 0, Number(r.kwhGenerated)));
    }
    const expected = (plant.expectedMonthlyKwh as unknown[]).map((v) => Number(v) || 0);
    const out = forecastGeneration({
      expectedMonthlyKwh: expected,
      readings: [...perDay.entries()].map(([date, kwh]) => ({ date, kwh })),
      today: iso(now),
      minDays: minSamples.generationDays,
    });
    return { ...out, projectCode: plant.projectCode };
  }
}
