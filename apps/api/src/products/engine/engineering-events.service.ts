import { Injectable } from '@nestjs/common';
import type { Prisma } from '@voltex/database';
import type { EngineeringEventDto } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService, type ScopedPrismaClient } from '../../platform/prisma/prisma.service';

type Tx = Pick<ScopedPrismaClient, 'engineeringEvent'>;

/** Linha do tempo do pedido e do projeto de engenharia. */
@Injectable()
export class EngineeringEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  async record(
    event: {
      type: EngineeringEventDto['type'];
      projectId?: string | null;
      requestId?: string | null;
      text?: string | null;
      data?: Record<string, unknown>;
    },
    tx: Tx = this.prisma.db,
  ): Promise<void> {
    await tx.engineeringEvent.create({
      data: {
        tenantId: this.context.requireTenantId(),
        type: event.type,
        projectId: event.projectId ?? null,
        requestId: event.requestId ?? null,
        text: event.text ?? null,
        data: (event.data ?? {}) as Prisma.InputJsonValue,
        actorId: this.context.userId ?? null,
      },
    });
  }

  /** Eventos do pedido e/ou do projeto (os do pedido que originou o projeto aparecem nos dois). */
  async list(where: {
    projectId?: string | null;
    requestId?: string | null;
  }): Promise<EngineeringEventDto[]> {
    const or: Prisma.EngineeringEventWhereInput[] = [];
    if (where.projectId) or.push({ projectId: where.projectId });
    if (where.requestId) or.push({ requestId: where.requestId });
    if (or.length === 0) return [];
    const rows = await this.prisma.db.engineeringEvent.findMany({
      where: { OR: or },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      type: r.type as EngineeringEventDto['type'],
      text: r.text,
      data: r.data as Record<string, unknown>,
      actorId: r.actorId,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
