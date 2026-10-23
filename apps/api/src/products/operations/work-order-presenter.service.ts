import { Injectable } from '@nestjs/common';
import type { WorkOrder } from '@voltex/database';
import type { WorkOrderDto } from '@voltex/shared';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { siteLabelOf, toWorkOrderDto } from './operations.mapper';

/** Duração presumida de uma ordem sem horário de fim, só para detectar choque de agenda. */
export const DEFAULT_ORDER_HOURS = 4;
const HOUR = 3_600_000;

interface Slot {
  id: string;
  crewId: string | null;
  assigneeId: string | null;
  start: number;
  end: number;
}

const slotOf = (w: WorkOrder): Slot | null =>
  w.scheduledStart
    ? {
        id: w.id,
        crewId: w.crewId,
        assigneeId: w.assigneeId,
        start: w.scheduledStart.getTime(),
        end: (
          w.scheduledEnd ?? new Date(w.scheduledStart.getTime() + DEFAULT_ORDER_HOURS * HOUR)
        ).getTime(),
      }
    : null;

/** Duas ordens colidem se dividem a equipe ou o técnico e os horários se sobrepõem. Só aviso, nunca bloqueio. */
export const collides = (a: Slot, b: Slot): boolean =>
  a.id !== b.id &&
  a.start < b.end &&
  b.start < a.end &&
  ((a.crewId !== null && a.crewId === b.crewId) ||
    (a.assigneeId !== null && a.assigneeId === b.assigneeId));

/** Monta os DTOs das ordens de serviço: nomes, local e choques de agenda, em poucas consultas. */
@Injectable()
export class WorkOrderPresenter {
  constructor(private readonly prisma: PrismaService) {}

  async present(rows: WorkOrder[]): Promise<WorkOrderDto[]> {
    if (rows.length === 0) return [];
    const db = this.prisma.db;
    const crewIds = [...new Set(rows.map((r) => r.crewId).filter((x): x is string => !!x))];
    const accountIds = [...new Set(rows.map((r) => r.accountId).filter((x): x is string => !!x))];
    const siteIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
    const slots = rows.map(slotOf).filter((s): s is Slot => s !== null);
    const from = slots.length ? new Date(Math.min(...slots.map((s) => s.start)) - 24 * HOUR) : null;
    const to = slots.length ? new Date(Math.max(...slots.map((s) => s.end)) + 24 * HOUR) : null;

    const [crews, accounts, sites, neighbours, photoCounts] = await Promise.all([
      crewIds.length ? db.crew.findMany({ where: { id: { in: crewIds } } }) : [],
      accountIds.length
        ? db.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, name: true },
          })
        : [],
      siteIds.length
        ? db.site.findMany({
            where: { id: { in: siteIds } },
            select: { id: true, name: true, city: true, state: true },
          })
        : [],
      from && to
        ? db.workOrder.findMany({
            where: {
              status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
              scheduledStart: { gte: from, lte: to },
            },
          })
        : [],
      db.workOrderPhoto.groupBy({
        by: ['workOrderId'],
        where: { workOrderId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      }),
    ]);
    const photosOf = new Map(photoCounts.map((p) => [p.workOrderId, p._count._all]));
    const crewName = new Map(crews.map((c) => [c.id, c.name]));
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const siteById = new Map(sites.map((s) => [s.id, s]));
    const neighbourSlots = neighbours.map(slotOf).filter((s): s is Slot => s !== null);

    return rows.map((row) => {
      const mine = slotOf(row);
      const conflicts =
        mine && ['SCHEDULED', 'IN_PROGRESS'].includes(row.status)
          ? neighbourSlots.filter((other) => collides(mine, other)).map((o) => o.id)
          : [];
      return toWorkOrderDto(row, {
        photoCount: photosOf.get(row.id) ?? 0,
        crewName: row.crewId ? (crewName.get(row.crewId) ?? null) : null,
        accountName: row.accountId ? (accountName.get(row.accountId) ?? null) : null,
        siteLabel: siteLabelOf(row.siteId ? siteById.get(row.siteId) : null),
        conflictsWith: conflicts,
      });
    });
  }
}
