import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { WorkOrder } from '@voltex/database';
import type {
  AgendaDto,
  AgendaQuery,
  CancelWorkOrderInput,
  CompleteWorkOrderInput,
  CreateWorkOrderInput,
  ListWorkOrdersQuery,
  UpdateWorkOrderInput,
  WorkOrderDto,
} from '@voltex/shared';
import type { RequestUser } from '../../common/context/request-user';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { UserDirectory } from '../crm/support/user-directory.service';
import { InstallationsService } from './installations.service';
import { WorkOrderPresenter } from './work-order-presenter.service';

const OPEN_STATES = ['PENDING', 'SCHEDULED', 'IN_PROGRESS'] as const;

/** Ordens de serviço: criação, agenda e execução (iniciar e concluir) com reflexo na situação da instalação. */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly directory: UserDirectory,
    private readonly installations: InstallationsService,
    private readonly presenter: WorkOrderPresenter,
  ) {}

  private async requireRow(id: string): Promise<WorkOrder> {
    const row = await this.prisma.db.workOrder.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Ordem de serviço não encontrada');
    return row;
  }

  async get(id: string): Promise<WorkOrderDto> {
    const [dto] = await this.presenter.present([await this.requireRow(id)]);
    return dto!;
  }

  async list(query: ListWorkOrdersQuery): Promise<WorkOrderDto[]> {
    const rows = await this.prisma.db.workOrder.findMany({
      where: {
        ...(query.installationId ? { installationId: query.installationId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.crewId ? { crewId: query.crewId } : {}),
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      },
      orderBy: [{ scheduledStart: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: query.limit,
    });
    return this.presenter.present(rows);
  }

  /** Ordens em aberto de quem está escalado: direto ou pela equipe. */
  async mine(userId: string): Promise<WorkOrderDto[]> {
    const memberships = await this.prisma.db.crewMember.findMany({
      where: { userId },
      select: { crewId: true },
    });
    const rows = await this.prisma.db.workOrder.findMany({
      where: {
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        OR: [{ assigneeId: userId }, { crewId: { in: memberships.map((m) => m.crewId) } }],
      },
      orderBy: { scheduledStart: 'asc' },
      take: 100,
    });
    return this.presenter.present(rows);
  }

  async agenda(query: AgendaQuery): Promise<AgendaDto> {
    const rows = await this.prisma.db.workOrder.findMany({
      where: {
        status: { not: 'CANCELLED' },
        scheduledStart: { gte: new Date(query.from), lte: new Date(query.to) },
        ...(query.crewId ? { crewId: query.crewId } : {}),
      },
      orderBy: { scheduledStart: 'asc' },
      take: 500,
    });
    return { from: query.from, to: query.to, orders: await this.presenter.present(rows) };
  }

  // --- permissão de execução --------------------------------------------------------------------------------

  /** Quem gerencia ordens age em qualquer uma; o técnico de campo só nas ordens em que está escalado. */
  private async assertCanAct(order: WorkOrder, actor: RequestUser): Promise<void> {
    if (actor.permissions.includes('ops.workorder.write')) return;
    if (actor.permissions.includes('ops.field.execute')) {
      if (order.assigneeId === actor.id) return;
      if (order.crewId) {
        const member = await this.prisma.db.crewMember.findFirst({
          where: { crewId: order.crewId, userId: actor.id },
          select: { id: true },
        });
        if (member) return;
      }
    }
    throw new ForbiddenException('Você não está escalado para esta ordem de serviço.');
  }

  // --- criação e edição -------------------------------------------------------------------------------------

  private async validateTargets(input: {
    crewId?: string | null;
    assigneeId?: string | null;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
  }): Promise<void> {
    if (input.crewId) {
      const crew = await this.prisma.db.crew.findFirst({
        where: { id: input.crewId, active: true, deletedAt: null },
        select: { id: true },
      });
      if (!crew) throw new UnprocessableEntityException('A equipe não existe ou está inativa.');
    }
    if (input.assigneeId) await this.directory.assertActive(input.assigneeId, 'técnico');
    if (
      input.scheduledStart &&
      input.scheduledEnd &&
      new Date(input.scheduledEnd) <= new Date(input.scheduledStart)
    )
      throw new UnprocessableEntityException('O fim deve ser depois do início.');
    if (input.scheduledEnd && !input.scheduledStart)
      throw new UnprocessableEntityException('Informe o início junto com o fim.');
  }

  async create(input: CreateWorkOrderInput): Promise<WorkOrderDto> {
    await this.validateTargets(input);
    const needsInstallation = input.type === 'INSTALLATION' || input.type === 'COMMISSIONING';
    if (needsInstallation && !input.installationId)
      throw new UnprocessableEntityException('Informe a instalação desta ordem.');
    const inst = input.installationId
      ? await this.installations.require(input.installationId)
      : null;
    if (inst) {
      if (['DONE', 'CANCELLED'].includes(inst.status))
        throw new UnprocessableEntityException('A instalação já foi encerrada.');
      if (input.type === 'INSTALLATION') {
        if (!['MATERIAL_READY', 'SCHEDULING', 'CREW_ASSIGNED'].includes(inst.status))
          throw new UnprocessableEntityException({
            code: 'INSTALLATION_NOT_READY',
            message: 'A ordem de instalação só pode ser criada com o material separado.',
          });
      }
      if (input.type === 'COMMISSIONING') {
        if (!['INSTALLED', 'COMMISSIONING'].includes(inst.status))
          throw new UnprocessableEntityException({
            code: 'INSTALLATION_NOT_INSTALLED',
            message: 'O comissionamento só pode ser agendado depois da instalação concluída.',
          });
      }
      if (needsInstallation) {
        const open = await this.prisma.db.workOrder.findFirst({
          where: { installationId: inst.id, type: input.type, status: { in: [...OPEN_STATES] } },
          select: { id: true },
        });
        if (open)
          throw new ConflictException({
            code: 'DUPLICATE_ORDER',
            message: 'Já existe uma ordem deste tipo em aberto para a instalação.',
          });
      }
    }
    const created = await this.prisma.db.$transaction(async (tx) => {
      const row = await tx.workOrder.create({
        data: {
          tenantId: this.context.requireTenantId(),
          installationId: inst?.id ?? null,
          projectCode: inst?.projectCode ?? null,
          accountId: inst?.accountId ?? null,
          siteId: inst?.siteId ?? null,
          type: input.type,
          status: input.scheduledStart ? 'SCHEDULED' : 'PENDING',
          title: input.title,
          notes: input.notes ?? null,
          crewId: input.crewId ?? null,
          assigneeId: input.assigneeId ?? null,
          scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
          scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'work_order.created',
          entity: 'WorkOrder',
          entityId: row.id,
          after: { type: row.type, status: row.status, installationId: row.installationId },
        },
        tx,
      );
      return row;
    });
    if (inst && created.type === 'INSTALLATION') await this.installations.syncSchedule(inst.id);
    return this.get(created.id);
  }

  async update(id: string, input: UpdateWorkOrderInput): Promise<WorkOrderDto> {
    const order = await this.requireRow(id);
    if (['DONE', 'CANCELLED'].includes(order.status))
      throw new UnprocessableEntityException('Esta ordem já foi encerrada.');
    await this.validateTargets({
      crewId: input.crewId,
      assigneeId: input.assigneeId,
      // Valida o horário que vai ficar (o enviado, ou o que a ordem já tem).
      scheduledStart:
        input.scheduledStart !== undefined
          ? input.scheduledStart
          : (order.scheduledStart?.toISOString() ?? null),
      scheduledEnd:
        input.scheduledEnd !== undefined
          ? input.scheduledEnd
          : input.scheduledStart === null
            ? null
            : (order.scheduledEnd?.toISOString() ?? null),
    });
    const rescheduling =
      input.scheduledStart !== undefined ||
      input.scheduledEnd !== undefined ||
      input.crewId !== undefined ||
      input.assigneeId !== undefined;
    if (order.status === 'IN_PROGRESS' && rescheduling)
      throw new UnprocessableEntityException(
        'Uma ordem em execução não pode ser reagendada nem trocar de equipe.',
      );
    const start =
      input.scheduledStart !== undefined
        ? input.scheduledStart
          ? new Date(input.scheduledStart)
          : null
        : order.scheduledStart;
    if (input.scheduledStart === null && input.scheduledEnd === undefined && order.scheduledEnd) {
      // Sem início não há fim.
      input = { ...input, scheduledEnd: null };
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.crewId !== undefined ? { crewId: input.crewId } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.scheduledStart !== undefined ? { scheduledStart: start } : {}),
          ...(input.scheduledEnd !== undefined
            ? { scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null }
            : {}),
          ...(order.status !== 'IN_PROGRESS' ? { status: start ? 'SCHEDULED' : 'PENDING' } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'work_order.updated',
          entity: 'WorkOrder',
          entityId: id,
          before: {
            scheduledStart: order.scheduledStart?.toISOString() ?? null,
            crewId: order.crewId,
            assigneeId: order.assigneeId,
          },
          after: {
            scheduledStart: start?.toISOString() ?? null,
            crewId: input.crewId ?? order.crewId,
            assigneeId: input.assigneeId ?? order.assigneeId,
          },
        },
        tx,
      );
    });
    if (order.installationId && order.type === 'INSTALLATION')
      await this.installations.syncSchedule(order.installationId);
    return this.get(id);
  }

  async cancel(id: string, input: CancelWorkOrderInput): Promise<WorkOrderDto> {
    const order = await this.requireRow(id);
    if (['DONE', 'CANCELLED'].includes(order.status))
      throw new UnprocessableEntityException('Esta ordem já foi encerrada.');
    if (order.status === 'IN_PROGRESS' && order.type === 'INSTALLATION')
      throw new UnprocessableEntityException(
        'A instalação já começou: conclua a ordem ou registre uma pendência de campo.',
      );
    await this.prisma.db.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: { status: 'CANCELLED', cancelReason: input.reason },
      });
      await this.audit.record(
        {
          action: 'work_order.cancelled',
          entity: 'WorkOrder',
          entityId: id,
          after: { reason: input.reason },
        },
        tx,
      );
    });
    if (order.installationId && order.type === 'INSTALLATION')
      await this.installations.syncSchedule(order.installationId);
    return this.get(id);
  }

  // --- execução ---------------------------------------------------------------------------------------------

  async start(id: string, actor: RequestUser): Promise<WorkOrderDto> {
    const order = await this.requireRow(id);
    await this.assertCanAct(order, actor);
    if (!['PENDING', 'SCHEDULED'].includes(order.status))
      throw new UnprocessableEntityException(
        'Só uma ordem pendente ou agendada pode ser iniciada.',
      );
    const inst = order.installationId
      ? await this.installations.require(order.installationId)
      : null;
    if (inst && order.type === 'INSTALLATION' && inst.status !== 'CREW_ASSIGNED')
      throw new UnprocessableEntityException({
        code: 'INSTALLATION_NOT_SCHEDULED',
        message: 'A instalação ainda não tem data e equipe designadas.',
      });
    if (
      inst &&
      order.type === 'COMMISSIONING' &&
      !['INSTALLED', 'COMMISSIONING'].includes(inst.status)
    )
      throw new UnprocessableEntityException({
        code: 'INSTALLATION_NOT_INSTALLED',
        message: 'O comissionamento só começa depois da instalação concluída.',
      });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          assigneeId: order.assigneeId ?? actor.id,
        },
      });
      if (inst && order.type === 'INSTALLATION')
        await this.installations.transition(inst, 'IN_PROGRESS', { tx });
      if (inst && order.type === 'COMMISSIONING' && inst.status === 'INSTALLED')
        await this.installations.transition(inst, 'COMMISSIONING', { tx });
      await this.audit.record(
        { action: 'work_order.started', entity: 'WorkOrder', entityId: id },
        tx,
      );
    });
    return this.get(id);
  }

  async complete(
    id: string,
    input: CompleteWorkOrderInput,
    actor: RequestUser,
  ): Promise<WorkOrderDto> {
    const order = await this.requireRow(id);
    await this.assertCanAct(order, actor);
    if (order.status !== 'IN_PROGRESS')
      throw new UnprocessableEntityException('Só uma ordem em execução pode ser concluída.');
    const inst = order.installationId
      ? await this.installations.require(order.installationId)
      : null;
    if (inst && order.type === 'INSTALLATION' && inst.status !== 'IN_PROGRESS')
      throw new UnprocessableEntityException({
        code:
          inst.status === 'FIELD_ISSUE'
            ? 'BLOCKING_ISSUES_OPEN'
            : 'INVALID_INSTALLATION_TRANSITION',
        message:
          inst.status === 'FIELD_ISSUE'
            ? 'Resolva as pendências de campo que bloqueiam a instalação antes de concluir.'
            : 'A instalação não está em execução.',
      });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'DONE',
          completedAt: new Date(),
          ...(input.notes ? { notes: input.notes } : {}),
        },
      });
      if (inst && order.type === 'INSTALLATION')
        await this.installations.transition(inst, 'INSTALLED', { tx });
      await this.audit.record(
        { action: 'work_order.completed', entity: 'WorkOrder', entityId: id },
        tx,
      );
    });
    return this.get(id);
  }
}
