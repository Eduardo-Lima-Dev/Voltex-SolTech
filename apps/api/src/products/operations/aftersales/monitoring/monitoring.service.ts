import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { monthPerformance, evaluateDeviation, type DailyPoint } from '@voltex/solar-engine';
import type {
  ExternalPlantDto,
  ImportMonitoringCsvInput,
  LinkPlantMonitoringInput,
  MonitoringAlarmDto,
  MonitoringImportResultDto,
  MonitoringPlantStatus,
  PlantMonitoringLinkDto,
  PlantMonitoringPageDto,
} from '@voltex/shared';
import { RequestContext } from '../../../../common/context/request-context';
import { AuditService } from '../../../../platform/audit/audit.service';
import { IntegrationRegistry } from '../../../../platform/integrations/integration-registry';
import { IntegrationsService } from '../../../../platform/integrations/integrations.service';
import { PrismaService } from '../../../../platform/prisma/prisma.service';
import { CSV_SOURCE, MonitoringIngestService, effectiveDaily } from './monitoring-ingest.service';
import { parseGenerationCsv } from './monitoring-csv';

const DAY = 86_400_000;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Monitoramento de inversores (Fase 11F): vínculo planta ↔ conta no provedor, leitura, planilha e desempenho. */
@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly registry: IntegrationRegistry,
    private readonly integrations: IntegrationsService,
    private readonly ingest: MonitoringIngestService,
  ) {}

  private async plantOrFail(plantId: string) {
    const plant = await this.prisma.db.plant.findFirst({ where: { id: plantId } });
    if (!plant) throw new NotFoundException('Planta não encontrada');
    return plant;
  }

  private async linkDto(row: {
    id: string;
    plantId: string;
    connectionId: string;
    externalPlantId: string;
    addedAt: Date;
    connection: { provider: string };
  }): Promise<PlantMonitoringLinkDto> {
    return {
      id: row.id,
      plantId: row.plantId,
      connectionId: row.connectionId,
      provider: row.connection.provider,
      providerLabel: this.registry.get(row.connection.provider)?.label ?? row.connection.provider,
      externalPlantId: row.externalPlantId,
      addedAt: row.addedAt.toISOString(),
    };
  }

  /** Conexões de monitoramento da empresa, para escolher a que será vinculada à planta. */
  async connections() {
    const rows = await this.prisma.db.integrationConnection.findMany({
      where: { kind: 'MONITORING', deletedAt: null },
      orderBy: { label: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      provider: r.provider,
      providerLabel: this.registry.get(r.provider)?.label ?? r.provider,
      status: r.status,
      canListPlants: Boolean(this.registry.get(r.provider)?.listPlants),
    }));
  }

  async externalPlants(connectionId: string): Promise<ExternalPlantDto[]> {
    const connection = await this.prisma.db.integrationConnection.findFirst({
      where: { id: connectionId, kind: 'MONITORING', deletedAt: null },
    });
    if (!connection) throw new NotFoundException('Conexão não encontrada');
    return this.integrations.listExternalPlants(connectionId);
  }

  async link(plantId: string, input: LinkPlantMonitoringInput): Promise<PlantMonitoringLinkDto> {
    await this.plantOrFail(plantId);
    const connection = await this.prisma.db.integrationConnection.findFirst({
      where: { id: input.connectionId, kind: 'MONITORING', deletedAt: null },
    });
    if (!connection) throw new NotFoundException('Conexão de monitoramento não encontrada');
    const taken = await this.prisma.db.plantMonitoringLink.findFirst({
      where: {
        connectionId: input.connectionId,
        externalPlantId: input.externalPlantId,
        NOT: { plantId },
      },
    });
    if (taken)
      throw new ConflictException({
        message: 'Essa usina do provedor já está vinculada a outra planta',
        code: 'EXTERNAL_PLANT_ALREADY_LINKED',
      });
    const row = await this.prisma.db.$transaction(async (tx) => {
      const saved = await tx.plantMonitoringLink.upsert({
        where: { plantId_connectionId: { plantId, connectionId: input.connectionId } },
        create: {
          tenantId: this.context.requireTenantId(),
          plantId,
          connectionId: input.connectionId,
          externalPlantId: input.externalPlantId,
        },
        update: { externalPlantId: input.externalPlantId },
        include: { connection: { select: { provider: true } } },
      });
      await this.audit.record(
        {
          action: 'monitoring.link_saved',
          entity: 'PlantMonitoringLink',
          entityId: saved.id,
          after: { plantId, provider: connection.provider, externalPlantId: input.externalPlantId },
        },
        tx,
      );
      return saved;
    });
    return this.linkDto(row);
  }

  async unlink(plantId: string, linkId: string): Promise<void> {
    const link = await this.prisma.db.plantMonitoringLink.findFirst({
      where: { id: linkId, plantId },
    });
    if (!link) throw new NotFoundException('Vínculo não encontrado');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.plantMonitoringLink.delete({ where: { id: linkId } });
      await this.audit.record(
        { action: 'monitoring.link_removed', entity: 'PlantMonitoringLink', entityId: linkId },
        tx,
      );
    });
  }

  /** Importa a planilha de geração diária (qualquer marca). Linhas ruins voltam com o motivo. */
  async importCsv(
    plantId: string,
    input: ImportMonitoringCsvInput,
  ): Promise<MonitoringImportResultDto> {
    const plant = await this.plantOrFail(plantId);
    const parsed = parseGenerationCsv(input.csv);
    if (parsed.rows.length === 0)
      throw new UnprocessableEntityException({
        message: parsed.rejected[0]?.reason ?? 'A planilha não tem nenhuma linha válida',
        code: 'CSV_EMPTY',
        details: parsed.rejected.slice(0, 20),
      });
    const imported = await this.ingest.saveDaily(plant.id, parsed.rows, CSV_SOURCE);
    await this.audit.record({
      action: 'monitoring.csv_imported',
      entity: 'Plant',
      entityId: plant.id,
      after: { imported, rejected: parsed.rejected.length },
    });
    await this.ingest.evaluate(plant.id);
    return { imported, rejected: parsed.rejected.slice(0, 50) };
  }

  async page(plantId: string): Promise<PlantMonitoringPageDto> {
    const plant = await this.plantOrFail(plantId);
    const [links, rows, snapshot, alarms, rule] = await Promise.all([
      this.prisma.db.plantMonitoringLink.findMany({
        where: { plantId },
        include: { connection: { select: { provider: true } } },
        orderBy: { addedAt: 'asc' },
      }),
      this.prisma.db.monitoringDaily.findMany({
        where: { plantId, date: { gte: new Date(Date.now() - 200 * DAY) } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.db.monitoringSnapshot.findFirst({ where: { plantId } }),
      this.prisma.db.monitoringAlarm.findMany({
        where: { plantId, closedAt: null },
        orderBy: { openedAt: 'desc' },
        take: 20,
      }),
      this.ingest.activeRule(),
    ]);

    const effective = effectiveDaily(
      rows.map((r) => ({ date: isoDay(r.date), kwh: r.kwhGenerated.toNumber(), source: r.source })),
    );
    const expected = Array.isArray(plant.expectedMonthlyKwh)
      ? (plant.expectedMonthlyKwh as (number | null)[])
      : [];
    const hasExpected = expected.length === 12;

    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = isoDay(d).slice(0, 7);
      const exp = hasExpected ? (expected[d.getUTCMonth()] ?? null) : null;
      const series: DailyPoint[] = effective.map(({ date, kwh }) => ({ date, kwh }));
      return monthPerformance(key, exp, series);
    }).reverse();

    const deviation =
      rule && hasExpected
        ? evaluateDeviation(
            effective.map(({ date, kwh }) => ({ date, kwh })),
            expected,
            rule.definition.deviation,
          )
        : null;

    const alarmDtos: MonitoringAlarmDto[] = alarms.map((a) => ({
      id: a.id,
      code: a.code,
      text: a.text,
      severity: a.severity as MonitoringAlarmDto['severity'],
      openedAt: a.openedAt.toISOString(),
      closedAt: null,
    }));
    const cutoff = isoDay(new Date(Date.now() - 60 * DAY));
    return {
      links: await Promise.all(links.map((l) => this.linkDto(l))),
      daily: effective
        .filter((d) => d.date >= cutoff)
        .map((d) => ({ date: d.date, kwh: d.kwh, source: d.source })),
      snapshot: snapshot
        ? {
            powerKw: snapshot.powerKw.toNumber(),
            status: snapshot.status as MonitoringPlantStatus,
            receivedAt: snapshot.receivedAt.toISOString(),
          }
        : null,
      openAlarms: alarmDtos,
      months,
      deviationRule: rule ? { ...rule.definition.deviation, ref: rule.ref } : null,
      deviation: deviation
        ? { streak: deviation.streak, alert: deviation.alert, days: deviation.days }
        : null,
      hasExpected,
    };
  }
}
