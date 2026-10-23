import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@voltex/database';
import type { Ticket, TicketComment } from '@voltex/database';
import {
  DomainEvent,
  type AddTicketCommentInput,
  type ChangeTicketStatusInput,
  type CreateTicketInput,
  type CreateTicketWorkOrderInput,
  type ListTicketsQuery,
  type TicketDetailDto,
  type TicketOrigin,
  type TicketStatus,
  type TicketSummaryDto,
  type UpdateTicketInput,
} from '@voltex/shared';
import type { RequestUser } from '../../../common/context/request-user';
import { RequestContext } from '../../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../../common/pagination';
import { AuditService } from '../../../platform/audit/audit.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { UserDirectory } from '../../crm/support/user-directory.service';
import { WorkOrdersService } from '../work-orders.service';
import { OperationsSettingsService } from './settings.service';

export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'RESOLVED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

const OPEN_STATES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] as const;
const HOUR = 3_600_000;

export const ticketCode = (number: number): string => `TKT-${String(number).padStart(4, '0')}`;

/**
 * Chamados de pós-venda. O prazo (SLA) vem da política da empresa (horas por prioridade): sem prazo configurado o
 * chamado não tem SLA. O SLA **pausa** enquanto o chamado espera o cliente. A resolução é decisão de quem atende.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly settings: OperationsSettingsService,
    private readonly directory: UserDirectory,
    private readonly workOrders: WorkOrdersService,
  ) {}

  private breached(t: Pick<Ticket, 'slaDueAt' | 'status'>, now: Date): boolean {
    return (
      t.slaDueAt !== null &&
      t.slaDueAt.getTime() < now.getTime() &&
      (t.status === 'OPEN' || t.status === 'IN_PROGRESS')
    );
  }

  private async summarize(rows: Ticket[]): Promise<TicketSummaryDto[]> {
    if (rows.length === 0) return [];
    const db = this.prisma.db;
    const plants = await db.plant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.plantId))] } },
      select: { id: true, name: true, accountId: true },
    });
    const accounts = await db.account.findMany({
      where: { id: { in: [...new Set(plants.map((p) => p.accountId))] } },
      select: { id: true, name: true },
    });
    const now = new Date();
    return rows.map((t) => {
      const plant = plants.find((p) => p.id === t.plantId);
      return {
        id: t.id,
        number: t.number,
        code: ticketCode(t.number),
        plantId: t.plantId,
        plantName: plant?.name ?? '—',
        accountName: accounts.find((a) => a.id === plant?.accountId)?.name ?? '—',
        type: t.type,
        priority: t.priority,
        status: t.status,
        title: t.title,
        origin: t.origin,
        assigneeId: t.assigneeId,
        assetId: t.assetId,
        workOrderId: t.workOrderId,
        slaDueAt: t.slaDueAt?.toISOString() ?? null,
        slaBreached: this.breached(t, now),
        createdAt: t.createdAt.toISOString(),
        resolvedAt: t.resolvedAt?.toISOString() ?? null,
      };
    });
  }

  async list(query: ListTicketsQuery) {
    const db = this.prisma.db;
    const search = query.search?.trim();
    const asNumber = search ? Number(search.replace(/\D/g, '')) : NaN;
    const where: Prisma.TicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.open === 'true' ? { status: { in: [...OPEN_STATES] } } : {}),
      ...(query.open === 'false' ? { status: { in: ['RESOLVED', 'CLOSED'] } } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.plantId ? { plantId: query.plantId } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              ...(Number.isFinite(asNumber) && asNumber > 0 ? [{ number: asNumber }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.ticket.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        ...toSkipTake(query),
      }),
      db.ticket.count({ where }),
    ]);
    return toPaginated(await this.summarize(rows), total, query);
  }

  async listForPlant(plantId: string): Promise<TicketSummaryDto[]> {
    const rows = await this.prisma.db.ticket.findMany({
      where: { plantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return this.summarize(rows);
  }

  async require(id: string): Promise<Ticket> {
    const ticket = await this.prisma.db.ticket.findFirst({ where: { id } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado');
    return ticket;
  }

  private commentDto(c: TicketComment) {
    return {
      id: c.id,
      authorId: c.authorId,
      authorName: c.authorName,
      internal: c.internal,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async get(id: string): Promise<TicketDetailDto> {
    const ticket = await this.require(id);
    const [summary] = await this.summarize([ticket]);
    const comments = await this.prisma.db.ticketComment.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...summary!,
      description: ticket.description,
      resolution: ticket.resolution,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      comments: comments.map((c) => this.commentDto(c)),
      allowedTransitions: [...TICKET_TRANSITIONS[ticket.status]],
    };
  }

  // --- criação ----------------------------------------------------------------------------------------------

  /** Cria o chamado. `automationKey` torna a criação pelo sistema idempotente (devolve `created: false` se já existe). */
  async createInternal(
    input: CreateTicketInput,
    options: { origin?: TicketOrigin; automationKey?: string; openedById?: string | null } = {},
  ): Promise<{ ticket: Ticket; created: boolean }> {
    const data = {
      ...input,
      type: input.type ?? 'CORRECTIVE',
      priority: input.priority ?? 'NORMAL',
    };
    const plant = await this.prisma.db.plant.findFirst({ where: { id: data.plantId } });
    if (!plant) throw new NotFoundException('Planta não encontrada');
    if (data.assetId) {
      const asset = await this.prisma.db.plantAsset.findFirst({
        where: { id: data.assetId, plantId: plant.id },
      });
      if (!asset) throw new UnprocessableEntityException('O ativo não é desta planta.');
    }
    if (data.assigneeId) await this.directory.assertActive(data.assigneeId, 'responsável');
    if (options.automationKey) {
      const existing = await this.prisma.db.ticket.findFirst({
        where: { automationKey: options.automationKey },
      });
      if (existing) return { ticket: existing, created: false };
    }
    const sla = (await this.settings.get()).slaHours[data.priority];
    const tenantId = this.context.requireTenantId();
    // O número é sequencial por empresa: duas criações simultâneas disputam o mesmo número e a segunda tenta de novo.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const ticket = await this.prisma.db.$transaction(async (tx) => {
          const last = await tx.ticket.aggregate({ _max: { number: true } });
          const created = await tx.ticket.create({
            data: {
              tenantId,
              plantId: plant.id,
              number: (last._max.number ?? 0) + 1,
              type: data.type,
              priority: data.priority,
              title: data.title,
              description: data.description ?? null,
              origin: options.origin ?? 'USER',
              openedById:
                options.openedById === undefined
                  ? (this.context.userId ?? null)
                  : options.openedById,
              assigneeId: data.assigneeId ?? null,
              assetId: data.assetId ?? null,
              slaDueAt: sla ? new Date(Date.now() + sla * HOUR) : null,
              automationKey: options.automationKey ?? null,
            },
          });
          await tx.plantEvent.create({
            data: {
              tenantId,
              plantId: plant.id,
              type: 'TICKET',
              text: `Chamado ${ticketCode(created.number)} aberto: ${created.title}`,
              data: { ticketId: created.id },
              actorId: this.context.userId ?? null,
            },
          });
          await this.events.publish(
            {
              type: DomainEvent.MAINTENANCE_TICKET_CREATED,
              projectCode: plant.projectCode,
              payload: {
                ticketId: created.id,
                plantId: plant.id,
                number: created.number,
                type: created.type,
                origin: created.origin,
              },
            },
            tx,
          );
          await this.audit.record(
            {
              action: 'ticket.created',
              entity: 'Ticket',
              entityId: created.id,
              after: { number: created.number, type: created.type, priority: created.priority },
            },
            tx,
          );
          return created;
        });
        return { ticket, created: true };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          if (options.automationKey) {
            const existing = await this.prisma.db.ticket.findFirst({
              where: { automationKey: options.automationKey },
            });
            if (existing) return { ticket: existing, created: false };
          }
          continue;
        }
        throw error;
      }
    }
    throw new UnprocessableEntityException('Não foi possível numerar o chamado. Tente de novo.');
  }

  async create(input: CreateTicketInput): Promise<TicketDetailDto> {
    const { ticket } = await this.createInternal(input);
    return this.get(ticket.id);
  }

  // --- edição e estados -------------------------------------------------------------------------------------

  async update(id: string, input: UpdateTicketInput): Promise<TicketDetailDto> {
    const ticket = await this.require(id);
    if (ticket.status === 'CLOSED')
      throw new UnprocessableEntityException('Um chamado fechado não pode ser alterado.');
    if (input.assigneeId) await this.directory.assertActive(input.assigneeId, 'responsável');
    if (input.assetId) {
      const asset = await this.prisma.db.plantAsset.findFirst({
        where: { id: input.assetId, plantId: ticket.plantId },
      });
      if (!asset) throw new UnprocessableEntityException('O ativo não é desta planta.');
    }
    const sla =
      input.priority && input.priority !== ticket.priority
        ? (await this.settings.get()).slaHours[input.priority]
        : undefined;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.priority !== undefined && input.priority !== ticket.priority
            ? { slaDueAt: sla ? new Date(ticket.createdAt.getTime() + sla * HOUR) : null }
            : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'ticket.updated',
          entity: 'Ticket',
          entityId: id,
          before: { priority: ticket.priority, assigneeId: ticket.assigneeId },
          after: input,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async changeStatus(
    id: string,
    input: ChangeTicketStatusInput,
    actor: RequestUser | null,
  ): Promise<TicketDetailDto> {
    const ticket = await this.require(id);
    if (!TICKET_TRANSITIONS[ticket.status].includes(input.status))
      throw new UnprocessableEntityException({
        code: 'INVALID_TICKET_TRANSITION',
        message: `Não é possível passar o chamado de ${ticket.status} para ${input.status}.`,
      });
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === 'RESOLVED'
            ? { resolvedAt: now, resolution: input.resolution ?? null }
            : {}),
          ...(input.status === 'CLOSED' ? { closedAt: now } : {}),
          // Reabrir limpa a resolução e devolve o prazo.
          ...(ticket.status === 'RESOLVED' && input.status === 'IN_PROGRESS'
            ? { resolvedAt: null, resolution: null, closedAt: null }
            : {}),
        },
      });
      await tx.ticketComment.create({
        data: {
          tenantId: ticket.tenantId,
          ticketId: id,
          authorId: actor?.id ?? null,
          authorName: actor?.name ?? 'Sistema',
          internal: true,
          body: `Situação: ${ticket.status} → ${input.status}${input.resolution ? `. ${input.resolution}` : ''}`,
        },
      });
      await this.audit.record(
        {
          action: 'ticket.status_changed',
          entity: 'Ticket',
          entityId: id,
          before: { status: ticket.status },
          after: { status: input.status },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async addComment(
    id: string,
    input: AddTicketCommentInput,
    actor: RequestUser,
  ): Promise<TicketDetailDto> {
    const ticket = await this.require(id);
    if (ticket.status === 'CLOSED')
      throw new UnprocessableEntityException('Um chamado fechado não recebe comentários.');
    await this.prisma.db.ticketComment.create({
      data: {
        tenantId: ticket.tenantId,
        ticketId: id,
        authorId: actor.id,
        authorName: actor.name,
        internal: input.internal ?? true,
        body: input.body,
      },
    });
    return this.get(id);
  }

  /** Cria a ordem de serviço do atendimento (manutenção) e liga ao chamado, que passa a "em andamento". */
  async createWorkOrder(id: string, input: CreateTicketWorkOrderInput): Promise<TicketDetailDto> {
    const ticket = await this.require(id);
    if (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED')
      throw new UnprocessableEntityException('O chamado já foi resolvido.');
    if (ticket.workOrderId) {
      const open = await this.prisma.db.workOrder.findFirst({
        where: { id: ticket.workOrderId, status: { in: ['PENDING', 'SCHEDULED', 'IN_PROGRESS'] } },
        select: { id: true },
      });
      if (open)
        throw new UnprocessableEntityException({
          code: 'ORDER_ALREADY_OPEN',
          message: 'Já há uma ordem de serviço em aberto para este chamado.',
        });
    }
    const order = await this.workOrders.createForPlant({
      plantId: ticket.plantId,
      ticketId: id,
      type: 'MAINTENANCE',
      title: `${ticketCode(ticket.number)}: ${ticket.title}`,
      notes: ticket.description,
      crewId: input.crewId,
      assigneeId: input.assigneeId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
    });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: {
          workOrderId: order.id,
          ...(ticket.status === 'OPEN' ? { status: 'IN_PROGRESS' as const } : {}),
        },
      });
      await tx.ticketComment.create({
        data: {
          tenantId: ticket.tenantId,
          ticketId: id,
          authorId: this.context.userId ?? null,
          authorName: 'Sistema',
          internal: true,
          body: 'Ordem de serviço criada para o atendimento.',
        },
      });
    });
    return this.get(id);
  }
}
