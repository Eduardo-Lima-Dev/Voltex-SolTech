import { Injectable } from '@nestjs/common';
import type { TimelineEventType } from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import type { ScopedPrismaClient } from '../../../platform/prisma/prisma.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';

export type TimelineClient = Pick<ScopedPrismaClient, 'timelineEvent'>;

export interface TimelineEntry {
  opportunityId: string;
  type: TimelineEventType;
  summary: string;
  data?: Record<string, unknown>;
  actorId?: string | null;
}

/** Linha do tempo da oportunidade (imutável): todo fato relevante vira um registro, na mesma transação do fato. */
@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  async record(entry: TimelineEntry, client: TimelineClient = this.prisma.db): Promise<void> {
    await client.timelineEvent.create({
      data: {
        tenantId: this.context.requireTenantId(),
        opportunityId: entry.opportunityId,
        type: entry.type,
        summary: entry.summary,
        data: (entry.data ?? {}) as object,
        actorId: entry.actorId === undefined ? (this.context.userId ?? null) : entry.actorId,
      },
    });
  }
}
