import { Injectable } from '@nestjs/common';
import type { AftersalesDashboardDto } from '@voltex/shared';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { dateOnly } from './dates';
import { OperationsSettingsService } from './settings.service';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Indicadores do pós-venda (modelagem §53). */
@Injectable()
export class AftersalesDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OperationsSettingsService,
  ) {}

  async get(): Promise<AftersalesDashboardDto> {
    const db = this.prisma.db;
    const now = new Date();
    const today = dateOnly(now);
    const settings = await this.settings.get();
    const [plants, contracts, open, resolved, byPlant, missing, upsell] = await Promise.all([
      db.plant.findMany({ where: { status: 'ACTIVE' }, select: { powerKwp: true } }),
      db.omContract.findMany({
        where: { status: 'ACTIVE', endsOn: { gte: today } },
        select: { monthlyCents: true, endsOn: true },
      }),
      db.ticket.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] } },
        select: { plantId: true, status: true, slaDueAt: true },
      }),
      db.ticket.findMany({
        where: { resolvedAt: { gte: new Date(now.getTime() - 90 * DAY) } },
        select: { createdAt: true, resolvedAt: true },
      }),
      db.ticket.groupBy({
        by: ['plantId'],
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] } },
        _count: { _all: true },
      }),
      db.plantAsset.findMany({
        where: { status: 'ACTIVE', plant: { status: 'ACTIVE' } },
        select: { _count: { select: { warranties: true } } },
      }),
      db.task.count({ where: { automationKey: { startsWith: 'upsell:' }, status: 'OPEN' } }),
    ]);
    const plantNames = byPlant.length
      ? await db.plant.findMany({
          where: { id: { in: byPlant.map((b) => b.plantId) } },
          select: { id: true, name: true },
        })
      : [];
    const warrantiesExpiring =
      settings.warrantyAlertDays === null
        ? null
        : await db.assetWarranty.count({
            where: {
              endsOn: {
                gte: today,
                lte: new Date(today.getTime() + settings.warrantyAlertDays * DAY),
              },
              asset: { status: 'ACTIVE' },
            },
          });
    return {
      installedBase: {
        plants: plants.length,
        powerKwp: plants.reduce((sum, p) => sum + (p.powerKwp ?? 0), 0),
      },
      mrrCents: contracts.reduce((sum, c) => sum + c.monthlyCents, 0),
      openTickets: open.length,
      breachedTickets: open.filter(
        (t) =>
          t.slaDueAt !== null &&
          t.slaDueAt.getTime() < now.getTime() &&
          (t.status === 'OPEN' || t.status === 'IN_PROGRESS'),
      ).length,
      mttrHours:
        resolved.length === 0
          ? null
          : resolved.reduce(
              (sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()),
              0,
            ) /
            resolved.length /
            HOUR,
      ticketsByPlant: byPlant
        .map((b) => ({
          plantId: b.plantId,
          plantName: plantNames.find((p) => p.id === b.plantId)?.name ?? '—',
          open: b._count._all,
        }))
        .sort((a, b) => b.open - a.open)
        .slice(0, 10),
      warrantiesExpiring,
      warrantiesMissing: missing.filter((a) => a._count.warranties === 0).length,
      contractsExpiring:
        settings.renewalNoticeDays === null
          ? null
          : contracts.filter(
              (c) => c.endsOn.getTime() <= today.getTime() + settings.renewalNoticeDays! * DAY,
            ).length,
      upsellOpportunities: upsell,
    };
  }
}
