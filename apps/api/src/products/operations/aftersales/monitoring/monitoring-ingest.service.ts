import { Injectable } from '@nestjs/common';
import { Prisma } from '@voltex/database';
import { evaluateDeviation, type DailyPoint } from '@voltex/solar-engine';
import {
  DomainEvent,
  MONITORING_RULESET_KEY,
  monitoringRulesDefinitionSchema,
  type MonitoringRulesDefinition,
} from '@voltex/shared';
import { RequestContext } from '../../../../common/context/request-context';
import { EventBus } from '../../../../platform/events/event-bus.service';
import { PrismaService } from '../../../../platform/prisma/prisma.service';
import { RulesService } from '../../../../platform/rules/rules.service';
import { TicketsService } from '../tickets.service';
import type { DailyReading, ExternalAlarm, NowReading } from './providers/types';

export const CSV_SOURCE = 'CSV';

/** Uma leitura por dia: a de um provedor vale mais que a da planilha. */
export function effectiveDaily<T extends { date: string; kwh: number; source: string }>(
  rows: T[],
): T[] {
  const byDate = new Map<string, T>();
  for (const row of rows) {
    const current = byDate.get(row.date);
    if (!current || (current.source === CSV_SOURCE && row.source !== CSV_SOURCE))
      byDate.set(row.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Grava o que os provedores (ou a planilha) trouxeram e, havendo regra `ops.monitoring` ativa e revisada, abre chamado
 * por desvio de geração ou alarme. Sem regra, nada abre sozinho: a empresa define o limiar (ADR-0023).
 */
@Injectable()
export class MonitoringIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly tickets: TicketsService,
    private readonly events: EventBus,
    private readonly rules: RulesService,
  ) {}

  async saveDaily(plantId: string, readings: DailyReading[], source: string): Promise<number> {
    if (readings.length === 0) return 0;
    const tenantId = this.context.requireTenantId();
    const receivedAt = new Date();
    await this.prisma.db.$transaction(
      readings.map((r) =>
        this.prisma.db.monitoringDaily.upsert({
          where: {
            plantId_date_source: { plantId, date: new Date(`${r.date}T00:00:00.000Z`), source },
          },
          create: {
            tenantId,
            plantId,
            date: new Date(`${r.date}T00:00:00.000Z`),
            kwhGenerated: new Prisma.Decimal(r.kwh.toFixed(2)),
            source,
            receivedAt,
          },
          update: { kwhGenerated: new Prisma.Decimal(r.kwh.toFixed(2)), receivedAt },
        }),
      ),
    );
    return readings.length;
  }

  async saveNow(plantId: string, now: NowReading): Promise<void> {
    const tenantId = this.context.requireTenantId();
    const data = {
      powerKw: new Prisma.Decimal((now.powerKw ?? 0).toFixed(2)),
      status: now.status,
      receivedAt: new Date(),
    };
    await this.prisma.db.monitoringSnapshot.upsert({
      where: { plantId },
      create: { tenantId, plantId, ...data },
      update: data,
    });
  }

  /** Abre os alarmes novos e fecha os que o provedor não informa mais como abertos. */
  async syncAlarms(
    plantId: string,
    alarms: ExternalAlarm[],
  ): Promise<{ opened: number; closed: number }> {
    const tenantId = this.context.requireTenantId();
    let opened = 0;
    for (const alarm of alarms) {
      const existing = await this.prisma.db.monitoringAlarm.findFirst({
        where: { plantId, code: alarm.code, openedAt: alarm.openedAt },
        select: { id: true, closedAt: true },
      });
      if (existing) {
        if (existing.closedAt)
          await this.prisma.db.monitoringAlarm.update({
            where: { id: existing.id },
            data: { closedAt: null },
          });
        continue;
      }
      await this.prisma.db.monitoringAlarm.create({
        data: {
          tenantId,
          plantId,
          code: alarm.code,
          text: alarm.text,
          severity: alarm.severity,
          openedAt: alarm.openedAt,
        },
      });
      opened += 1;
    }
    const keep = new Set(alarms.map((a) => `${a.code}|${a.openedAt.getTime()}`));
    const open = await this.prisma.db.monitoringAlarm.findMany({
      where: { plantId, closedAt: null },
    });
    const toClose = open.filter((a) => !keep.has(`${a.code}|${a.openedAt.getTime()}`));
    if (toClose.length)
      await this.prisma.db.monitoringAlarm.updateMany({
        where: { id: { in: toClose.map((a) => a.id) } },
        data: { closedAt: new Date() },
      });
    return { opened, closed: toClose.length };
  }

  /** Regra `ops.monitoring` em vigor, ou `null` (sem regra o sistema só compara). */
  async activeRule(): Promise<{ ref: string; definition: MonitoringRulesDefinition } | null> {
    const resolved = await this.rules.resolve(MONITORING_RULESET_KEY);
    if (!resolved) return null;
    return {
      ref: resolved.ref,
      definition: monitoringRulesDefinitionSchema.parse(resolved.definition),
    };
  }

  /** Avalia a planta pela regra e abre os chamados devidos. Idempotente (chave por ocorrência). */
  async evaluate(plantId: string): Promise<{ tickets: number }> {
    const rule = await this.activeRule();
    if (!rule) return { tickets: 0 };
    const plant = await this.prisma.db.plant.findFirst({ where: { id: plantId } });
    if (!plant || plant.status !== 'ACTIVE') return { tickets: 0 };
    let opened = 0;

    const expected = Array.isArray(plant.expectedMonthlyKwh)
      ? (plant.expectedMonthlyKwh as (number | null)[])
      : [];
    if (expected.length === 12) {
      const since = new Date(Date.now() - 45 * 86_400_000);
      const rows = await this.prisma.db.monitoringDaily.findMany({
        where: { plantId, date: { gte: since } },
      });
      const series: DailyPoint[] = effectiveDaily(
        rows.map((r) => ({
          date: isoDay(r.date),
          kwh: r.kwhGenerated.toNumber(),
          source: r.source,
        })),
      ).map(({ date, kwh }) => ({ date, kwh }));
      const result = evaluateDeviation(series, expected, rule.definition.deviation);
      const oldest = result.days.at(-1);
      // Um chamado de desvio aberto por vez: enquanto não for resolvido, a mesma sequência não abre outro.
      const alreadyOpen =
        result.alert &&
        (await this.prisma.db.ticket.findFirst({
          where: {
            plantId,
            automationKey: { startsWith: `monitoring-deviation:${plantId}:` },
            status: { notIn: ['RESOLVED', 'CLOSED'] },
          },
          select: { id: true },
        }));
      if (result.alert && oldest && !alreadyOpen) {
        const { created, ticket } = await this.tickets.createInternal(
          {
            plantId,
            type: 'CORRECTIVE',
            priority: 'NORMAL',
            title: `Geração abaixo do esperado há ${result.streak} dia(s) seguidos`,
            description: `Desde ${oldest.date}, a geração ficou mais de ${rule.definition.deviation.thresholdPct}% abaixo do esperado do projeto (regra ${rule.ref}).`,
          },
          {
            origin: 'SYSTEM',
            automationKey: `monitoring-deviation:${plantId}:${oldest.date}`,
            openedById: null,
          },
        );
        if (created) {
          opened += 1;
          await this.events.publish({
            type: DomainEvent.MONITORING_ALERT_RECEIVED,
            payload: { plantId, kind: 'DEVIATION', ticketId: ticket.id, streak: result.streak },
            actorId: null,
          });
        }
      }
    }

    if (rule.definition.alarmTicketSeverities.length) {
      const alarms = await this.prisma.db.monitoringAlarm.findMany({
        where: { plantId, closedAt: null, severity: { in: rule.definition.alarmTicketSeverities } },
      });
      for (const alarm of alarms) {
        const { created, ticket } = await this.tickets.createInternal(
          {
            plantId,
            type: 'CORRECTIVE',
            priority: alarm.severity === 'CRITICAL' ? 'HIGH' : 'NORMAL',
            title: `Alarme do inversor: ${alarm.text}`.slice(0, 200),
            description: `Código ${alarm.code}, aberto em ${alarm.openedAt.toISOString()} (regra ${rule.ref}).`,
          },
          { origin: 'SYSTEM', automationKey: `monitoring-alarm:${alarm.id}`, openedById: null },
        );
        if (created) {
          opened += 1;
          await this.events.publish({
            type: DomainEvent.MONITORING_ALERT_RECEIVED,
            payload: { plantId, kind: 'ALARM', alarmId: alarm.id, ticketId: ticket.id },
            actorId: null,
          });
        }
      }
    }
    return { tickets: opened };
  }
}
