import { Injectable } from '@nestjs/common';
import type { DomainEventType } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import type { ScopedPrismaClient } from '../prisma/prisma.service';
import { PrismaService } from '../prisma/prisma.service';

export interface PublishEventInput {
  type: DomainEventType;
  payload: Record<string, unknown>;
  projectCode?: string | null;
  actorId?: string | null;
}

/** Qualquer cliente com o delegate de outbox, inclusive a transação do negócio. */
export type OutboxClient = Pick<ScopedPrismaClient, 'outboxEvent'>;

/**
 * Publica eventos de domínio pelo outbox transacional: o evento é gravado na MESMA transação do dado
 * de negócio (passe o `tx`) e entregue depois pelo `OutboxPublisher`, pelo menos uma vez.
 */
@Injectable()
export class EventBus {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  async publish(event: PublishEventInput, client: OutboxClient = this.prisma.db): Promise<void> {
    await client.outboxEvent.create({
      data: {
        tenantId: this.context.requireTenantId(),
        type: event.type,
        payload: event.payload as object,
        projectCode: event.projectCode ?? null,
        actorId: event.actorId ?? this.context.userId ?? null,
      },
    });
  }
}
