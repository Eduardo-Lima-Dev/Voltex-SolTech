import { Injectable, NotFoundException } from '@nestjs/common';
import type { MonitoringDaily, MonitoringSnapshot, PlantMonitoringLink } from '@voltex/database';
import type {
  LinkPlantMonitoringInput,
  MonitoringDailyDto,
  MonitoringPerformanceDto,
  PlantMonitoringLinkDto,
  PlantMonitoringPageDto,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { isoDay } from './dates';

const toMonitoringLinkDto = (link: PlantMonitoringLink): PlantMonitoringLinkDto => ({
  id: link.id,
  plantId: link.plantId,
  connectionId: link.connectionId,
  externalPlantId: link.externalPlantId,
  addedAt: link.addedAt.toISOString(),
});

const toMonitoringDailyDto = (daily: MonitoringDaily): MonitoringDailyDto => ({
  id: daily.id,
  date: isoDay(daily.date),
  kwhGenerated: Number(daily.kwhGenerated),
  source: daily.source,
  receivedAt: daily.receivedAt.toISOString(),
});

/**
 * Monitoramento de inversores (Fase 11F): ligação de plantas a conexões de integração,
 * dados de geração diária, potência instantânea e alarmes. Comparação real × esperado.
 */
@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  // --- ligação de plantas -------------------------------------------------------

  async linkPlant(
    plantId: string,
    input: LinkPlantMonitoringInput,
  ): Promise<PlantMonitoringLinkDto> {
    const tenantId = this.context.requireTenantId();

    const plant = await this.prisma.db.plant.findFirst({
      where: { id: plantId, tenantId },
    });
    if (!plant) throw new NotFoundException('Planta não encontrada');

    const connection = await this.prisma.db.integrationConnection.findFirst({
      where: { id: input.connectionId, tenantId },
    });
    if (!connection) throw new NotFoundException('Conexão não encontrada');

    const link = await this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.plantMonitoringLink.findFirst({
        where: {
          plantId,
          connectionId: input.connectionId,
        },
      });
      if (existing) return existing;

      const created = await tx.plantMonitoringLink.create({
        data: {
          tenantId,
          plantId,
          connectionId: input.connectionId,
          externalPlantId: input.externalPlantId,
        },
      });
      await this.audit.record(
        {
          action: 'monitoring.link_created',
          entity: 'PlantMonitoringLink',
          entityId: created.id,
          after: {
            plantId,
            connectionId: input.connectionId,
            externalPlantId: input.externalPlantId,
          },
        },
        tx,
      );
      return created;
    });

    return toMonitoringLinkDto(link);
  }

  async unlinkPlant(plantId: string, linkId: string): Promise<void> {
    const tenantId = this.context.requireTenantId();

    const link = await this.prisma.db.plantMonitoringLink.findFirst({
      where: { id: linkId, plantId, tenantId: tenantId },
    });
    if (!link) throw new NotFoundException('Link não encontrado');

    await this.prisma.db.$transaction(async (tx) => {
      await tx.plantMonitoringLink.delete({ where: { id: linkId } });
      await this.audit.record(
        {
          action: 'monitoring.link_deleted',
          entity: 'PlantMonitoringLink',
          entityId: linkId,
        },
        tx,
      );
    });
  }

  async listLinks(plantId: string): Promise<PlantMonitoringLinkDto[]> {
    const tenantId = this.context.requireTenantId();

    const links = await this.prisma.db.plantMonitoringLink.findMany({
      where: { plantId, tenantId },
      orderBy: { addedAt: 'desc' },
    });

    return links.map(toMonitoringLinkDto);
  }

  // --- dados de geração ---------------------------------------------------------

  async recordDaily(
    plantId: string,
    daily: Omit<MonitoringDaily, 'id' | 'tenantId'>,
  ): Promise<void> {
    const tenantId = this.context.requireTenantId();

    await this.prisma.db.monitoringDaily.upsert({
      where: {
        plantId_date_source: {
          plantId,
          date: daily.date,
          source: daily.source,
        },
      },
      create: {
        ...daily,
        tenantId,
      },
      update: {
        kwhGenerated: daily.kwhGenerated,
        receivedAt: daily.receivedAt,
      },
    });
  }

  async getDailyData(plantId: string, days = 30): Promise<MonitoringDailyDto[]> {
    const tenantId = this.context.requireTenantId();

    const from = new Date();
    from.setDate(from.getDate() - days);

    const data = await this.prisma.db.monitoringDaily.findMany({
      where: {
        plantId,
        tenantId,
        date: { gte: from },
      },
      orderBy: { date: 'asc' },
    });

    return data.map(toMonitoringDailyDto);
  }

  // --- potência instantânea -----------------------------------------------------

  async updateSnapshot(
    plantId: string,
    snapshot: Omit<MonitoringSnapshot, 'id' | 'tenantId'>,
  ): Promise<void> {
    const tenantId = this.context.requireTenantId();

    await this.prisma.db.monitoringSnapshot.upsert({
      where: { plantId },
      create: {
        ...snapshot,
        tenantId,
      },
      update: {
        kwhPower: snapshot.kwhPower,
        status: snapshot.status,
        receivedAt: snapshot.receivedAt,
      },
    });
  }

  // --- desempenho ---------------------------------------------------------------

  async getMonitoringPage(plantId: string): Promise<PlantMonitoringPageDto> {
    const tenantId = this.context.requireTenantId();

    const plant = await this.prisma.db.plant.findFirst({
      where: { id: plantId, tenantId },
    });
    if (!plant) throw new NotFoundException('Planta não encontrada');

    const links = await this.prisma.db.plantMonitoringLink.findMany({
      where: { plantId, tenantId },
    });

    const dailyData = await this.getDailyData(plantId, 30);
    const snapshot = await this.prisma.db.monitoringSnapshot.findUnique({ where: { plantId } });
    const alarms = await this.prisma.db.monitoringAlarm.findMany({
      where: { plantId, tenantId, closedAt: null },
      orderBy: { openedAt: 'desc' },
      take: 10,
    });

    // Comparação real × esperado (simplificada, será expandida com a regra ops.monitoring)
    const thisMonth = this.getThisMonth();
    const lastMonth = this.getLastMonth();

    const thisMonthData = dailyData.filter(
      (d) => new Date(d.date) >= thisMonth.start && new Date(d.date) <= thisMonth.end,
    );
    const lastMonthData = dailyData.filter(
      (d) => new Date(d.date) >= lastMonth.start && new Date(d.date) <= lastMonth.end,
    );

    const expectedMonthly = Array.isArray(plant.expectedMonthlyKwh)
      ? (plant.expectedMonthlyKwh as number[])
      : [];
    const monthIndex = new Date().getMonth();
    const expectedThisMonth = expectedMonthly[monthIndex] ?? 0;
    const expectedLastMonth = expectedMonthly[monthIndex - 1 >= 0 ? monthIndex - 1 : 11] ?? 0;

    const actualThisMonth = thisMonthData.reduce((sum, d) => sum + d.kwhGenerated, 0);

    return {
      links: links.map(toMonitoringLinkDto),
      dailyData: thisMonthData.slice(-7),
      snapshot: snapshot
        ? {
            kwhPower: Number(snapshot.kwhPower),
            status: (snapshot.status as 'ONLINE' | 'OFFLINE' | 'ALARM' | 'UNKNOWN') ?? 'UNKNOWN',
            receivedAt: snapshot.receivedAt.toISOString(),
          }
        : null,
      recentAlarms: alarms.map((a) => ({
        id: a.id,
        code: a.code,
        text: a.text,
        severity: a.severity as 'INFO' | 'WARNING' | 'CRITICAL',
        openedAt: a.openedAt.toISOString(),
        closedAt: a.closedAt?.toISOString() ?? null,
      })),
      performanceThisMonth: this.generatePerformanceData(thisMonthData, expectedThisMonth),
      performanceLastMonth: this.generatePerformanceData(lastMonthData, expectedLastMonth),
      comparisonThisMonth: {
        expectedKwh: expectedThisMonth,
        actualKwh: actualThisMonth,
        performanceIndex: expectedThisMonth > 0 ? (actualThisMonth / expectedThisMonth) * 100 : 0,
        deviationPct:
          expectedThisMonth > 0
            ? ((actualThisMonth - expectedThisMonth) / expectedThisMonth) * 100
            : 0,
      },
    };
  }

  // --- helpers ------------------------------------------------------------------

  private getThisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  }

  private getLastMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start, end };
  }

  private generatePerformanceData(
    dailyData: MonitoringDailyDto[],
    expectedTotal: number,
  ): MonitoringPerformanceDto[] {
    return dailyData.map((d) => {
      const days = dailyData.length || 1;
      const expectedDay = expectedTotal / days;
      const actual = d.kwhGenerated;
      const performanceIndex = (actual / expectedDay) * 100;
      return {
        date: d.date,
        expectedKwh: expectedDay,
        actualKwh: actual,
        performanceIndex,
        deviationPct: ((actual - expectedDay) / expectedDay) * 100,
        status: performanceIndex >= 95 ? 'GOOD' : performanceIndex >= 80 ? 'WARNING' : 'CRITICAL',
      };
    });
  }
}
