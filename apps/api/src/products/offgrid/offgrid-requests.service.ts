import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DomainEvent,
  type ChangeOffgridRequestInput,
  type CreateOffgridRequestInput,
  type ListOffgridRequestsQuery,
  type OffgridDashboardDto,
  type OffgridRequestDetailDto,
  type OffgridRequestDto,
  type OffgridSystemType,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { PrismaService, type ScopedPrismaClient } from '../../platform/prisma/prisma.service';
import { OffgridEventsService } from './offgrid-events.service';

type RequestRow = Awaited<ReturnType<ScopedPrismaClient['offgridRequest']['findFirstOrThrow']>>;

/** Estados para os quais o pedido pode ir (aprovar a versão conclui o pedido). */
export const OFFGRID_REQUEST_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_VISIT', 'WAITING_INFO', 'IN_REVIEW', 'CANCELLED'],
  WAITING_VISIT: ['IN_PROGRESS', 'CANCELLED'],
  WAITING_INFO: ['IN_PROGRESS', 'CANCELLED'],
  IN_REVIEW: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

/** Fila de pedidos de projeto off-grid e híbrido (próprios, sem passar pelo semáforo do Calculator). */
@Injectable()
export class OffgridRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly timeline: OffgridEventsService,
    private readonly bus: EventBus,
  ) {}

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private toDto(row: RequestRow, assigneeName: string | null): OffgridRequestDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      systemType: row.systemType as OffgridSystemType,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt?.toISOString() ?? null,
      assigneeId: row.assigneeId,
      assigneeName,
      projectId: row.projectId,
      opportunityId: row.opportunityId,
      resolution: row.resolution,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(query: ListOffgridRequestsQuery): Promise<OffgridRequestDto[]> {
    const rows = await this.prisma.db.offgridRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.mine && this.context.userId ? { assigneeId: this.context.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await this.names(rows.map((r) => r.assigneeId));
    return rows.map((r) => this.toDto(r, r.assigneeId ? (names.get(r.assigneeId) ?? null) : null));
  }

  async require(id: string): Promise<RequestRow> {
    const row = await this.prisma.db.offgridRequest.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Pedido não encontrado');
    return row;
  }

  async detail(id: string): Promise<OffgridRequestDetailDto> {
    const row = await this.require(id);
    const names = await this.names([row.assigneeId]);
    const project = row.projectId
      ? await this.prisma.db.offgridProject.findFirst({
          where: { id: row.projectId },
          select: { id: true, code: true, name: true },
        })
      : null;
    return {
      ...this.toDto(row, row.assigneeId ? (names.get(row.assigneeId) ?? null) : null),
      events: await this.timeline.list({ requestId: id, projectId: row.projectId }),
      project,
    };
  }

  async create(input: CreateOffgridRequestInput): Promise<OffgridRequestDto> {
    if (input.opportunityId) {
      const opportunity = await this.prisma.db.opportunity.findFirst({
        where: { id: input.opportunityId, deletedAt: null },
        select: { id: true },
      });
      if (!opportunity) throw new NotFoundException('Oportunidade não encontrada');
    }
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.offgridRequest.create({
        data: {
          tenantId: this.context.requireTenantId(),
          title: input.title,
          description: input.description ?? null,
          systemType: input.systemType ?? 'OFFGRID',
          opportunityId: input.opportunityId ?? null,
          priority: input.priority ?? 'NORMAL',
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          createdById: this.context.userId ?? null,
        },
      });
      await this.timeline.record(
        { type: 'STATUS', requestId: created.id, text: 'Pedido criado' },
        tx,
      );
      await this.audit.record(
        { action: 'offgrid.request_created', entity: 'OffgridRequest', entityId: created.id },
        tx,
      );
      await this.bus.publish(
        {
          type: DomainEvent.OFFGRID_DESIGN_REQUESTED,
          payload: { requestId: created.id, systemType: created.systemType, schemaVersion: 1 },
        },
        tx,
      );
      return created;
    });
    return this.toDto(row, null);
  }

  async change(id: string, input: ChangeOffgridRequestInput): Promise<OffgridRequestDetailDto> {
    const row = await this.require(id);
    if (input.status && !OFFGRID_REQUEST_TRANSITIONS[row.status]?.includes(input.status))
      throw new ConflictException(`O pedido não pode ir de ${row.status} para ${input.status}.`);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.offgridRequest.update({
        where: { id },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.status === 'CANCELLED'
            ? { resolvedAt: new Date(), resolution: input.note ?? 'Cancelado' }
            : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
        },
      });
      if (input.status)
        await this.timeline.record(
          {
            type: 'STATUS',
            requestId: id,
            text: input.note ?? `Estado: ${input.status}`,
            data: { to: input.status },
          },
          tx,
        );
      if (input.priority)
        await this.timeline.record(
          { type: 'PRIORITY', requestId: id, text: `Prioridade: ${input.priority}` },
          tx,
        );
      if (input.assigneeId !== undefined)
        await this.timeline.record(
          {
            type: 'ASSIGNED',
            requestId: id,
            text: input.assigneeId ? 'Pedido atribuído' : 'Atribuição removida',
          },
          tx,
        );
      await this.audit.record(
        { action: 'offgrid.request_changed', entity: 'OffgridRequest', entityId: id, after: input },
        tx,
      );
    });
    return this.detail(id);
  }

  async comment(id: string, text: string): Promise<OffgridRequestDetailDto> {
    await this.require(id);
    await this.timeline.record({ type: 'COMMENT', requestId: id, text });
    return this.detail(id);
  }

  async dashboard(): Promise<OffgridDashboardDto> {
    const [requests, projects, awaiting, overdue] = await Promise.all([
      this.prisma.db.offgridRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.db.offgridProject.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.db.offgridVersion.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.db.offgridRequest.count({
        where: { dueAt: { lt: new Date() }, status: { notIn: ['DONE', 'CANCELLED'] } },
      }),
    ]);
    return {
      requests: Object.fromEntries(requests.map((r) => [r.status, r._count._all])),
      projects: Object.fromEntries(projects.map((r) => [r.status, r._count._all])),
      versionsAwaitingReview: awaiting,
      overdueRequests: overdue,
    };
  }
}
