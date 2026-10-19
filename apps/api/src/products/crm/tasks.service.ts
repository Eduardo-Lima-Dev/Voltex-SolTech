import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Task } from '@voltex/database';
import {
  TaskStatus,
  TimelineEventType,
  type CreateTaskData,
  type ListTasksQuery,
  type TaskDto,
  type UpdateTaskData,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { TimelineService } from './support/timeline.service';
import { UserDirectory } from './support/user-directory.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly users: UserDirectory,
  ) {}

  async list(query: ListTasksQuery) {
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.overdue ? { status: TaskStatus.OPEN, dueAt: { lt: new Date() } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.task.findMany({
        where,
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.db.task.count({ where }),
    ]);
    const names = await this.users.names(rows.map((r) => r.assigneeId));
    return toPaginated(
      rows.map((r) => this.toDto(r, names)),
      total,
      query,
    );
  }

  async get(id: string): Promise<TaskDto> {
    const row = await this.findOrThrow(id);
    return this.toDto(row, await this.users.names([row.assigneeId]));
  }

  async create(data: CreateTaskData, origin?: string): Promise<TaskDto> {
    await this.users.assertActive(data.assigneeId, 'responsável');
    await this.assertTarget(data);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          tenantId: this.context.requireTenantId(),
          title: data.title,
          description: data.description ?? null,
          dueAt: data.dueAt,
          assigneeId: data.assigneeId ?? this.context.userId ?? null,
          opportunityId: data.opportunityId ?? null,
          leadId: data.leadId ?? null,
          accountId: data.accountId ?? null,
          createdById: this.context.userId ?? null,
          origin: origin ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'task.created',
          entity: 'Task',
          entityId: created.id,
          after: { title: created.title, dueAt: created.dueAt, origin: created.origin },
        },
        tx,
      );
      if (created.opportunityId)
        await this.timeline.record(
          {
            opportunityId: created.opportunityId,
            type: TimelineEventType.TASK_CREATED,
            summary: `Tarefa criada: ${created.title}`,
            data: { taskId: created.id, dueAt: created.dueAt.toISOString() },
          },
          tx,
        );
      return created;
    });
    return this.toDto(row, await this.users.names([row.assigneeId]));
  }

  async update(id: string, data: UpdateTaskData): Promise<TaskDto> {
    const before = await this.findOrThrow(id);
    await this.users.assertActive(data.assigneeId, 'responsável');
    const finishing = data.status === TaskStatus.DONE && before.status !== TaskStatus.DONE;

    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          ...data,
          ...(finishing ? { completedAt: new Date() } : {}),
          ...(data.status && data.status !== TaskStatus.DONE ? { completedAt: null } : {}),
        },
      });
      await this.audit.record(
        {
          action: finishing ? 'task.completed' : 'task.updated',
          entity: 'Task',
          entityId: id,
          before: { status: before.status, dueAt: before.dueAt },
          after: { status: updated.status, dueAt: updated.dueAt },
        },
        tx,
      );
      if (finishing && updated.opportunityId)
        await this.timeline.record(
          {
            opportunityId: updated.opportunityId,
            type: TimelineEventType.TASK_COMPLETED,
            summary: `Tarefa concluída: ${updated.title}`,
            data: { taskId: id },
          },
          tx,
        );
      return updated;
    });
    return this.toDto(row, await this.users.names([row.assigneeId]));
  }

  complete(id: string): Promise<TaskDto> {
    return this.update(id, { status: TaskStatus.DONE });
  }

  async remove(id: string) {
    await this.findOrThrow(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record({ action: 'task.deleted', entity: 'Task', entityId: id }, tx);
    });
    return { id };
  }

  private async assertTarget(data: {
    opportunityId?: string;
    leadId?: string;
    accountId?: string;
  }) {
    if (!data.opportunityId && !data.leadId && !data.accountId) return;
    if (data.opportunityId) {
      const found = await this.prisma.db.opportunity.findFirst({
        where: { id: data.opportunityId, deletedAt: null },
      });
      if (!found) throw new UnprocessableEntityException('Oportunidade não encontrada');
    }
    if (data.leadId) {
      const found = await this.prisma.db.lead.findFirst({
        where: { id: data.leadId, deletedAt: null },
      });
      if (!found) throw new UnprocessableEntityException('Lead não encontrado');
    }
    if (data.accountId) {
      const found = await this.prisma.db.account.findFirst({
        where: { id: data.accountId, deletedAt: null },
      });
      if (!found) throw new UnprocessableEntityException('Conta não encontrada');
    }
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.db.task.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Tarefa não encontrada');
    return row;
  }

  private toDto(row: Task, names: Map<string, string>): TaskDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.dueAt.toISOString(),
      status: row.status,
      assigneeId: row.assigneeId,
      assigneeName: row.assigneeId ? (names.get(row.assigneeId) ?? null) : null,
      opportunityId: row.opportunityId,
      leadId: row.leadId,
      accountId: row.accountId,
      completedAt: row.completedAt?.toISOString() ?? null,
      overdue: row.status === TaskStatus.OPEN && row.dueAt.getTime() < Date.now(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
