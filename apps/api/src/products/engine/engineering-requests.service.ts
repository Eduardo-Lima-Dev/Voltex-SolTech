import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  REQUEST_TRANSITIONS,
  type ChangeRequestStatusInput,
  type EngineeringDashboardDto,
  type EngineeringRequestContextDto,
  type EngineeringRequestDetailDto,
  type EngineeringRequestListItemDto,
  type ListEngineeringRequestsQuery,
  type UpdateRequestPlanInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { EngineeringEventsService } from './engineering-events.service';
import { toRequestDto } from './engineering.mapper';

/** Fila de pedidos de engenharia abertos pelo CRM (semáforo amarelo). */
@Injectable()
export class EngineeringRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EngineeringEventsService,
  ) {}

  private include = {
    opportunity: {
      select: { title: true, projectCode: true, account: { select: { name: true } } },
    },
  } as const;

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  async list(query: ListEngineeringRequestsQuery): Promise<EngineeringRequestListItemDto[]> {
    const rows = await this.prisma.db.engineeringRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.mine && this.context.userId ? { assigneeId: this.context.userId } : {}),
      },
      include: this.include,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await this.names(rows.map((r) => r.assigneeId));
    return rows.map((r) =>
      toRequestDto(r, r.assigneeId ? (names.get(r.assigneeId) ?? null) : null),
    );
  }

  private async require(id: string) {
    const row = await this.prisma.db.engineeringRequest.findFirst({
      where: { id },
      include: this.include,
    });
    if (!row) throw new NotFoundException('Pedido de engenharia não encontrado');
    return row;
  }

  /** Pega o pedido para si. Quem já pegou mantém; só o responsável técnico reatribui (rota própria da fase 9J). */
  async assign(id: string): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    if (row.status === 'DONE' || row.status === 'CANCELLED')
      throw new ConflictException('Este pedido já foi encerrado');
    const userId = this.context.userId ?? null;
    if (row.assigneeId && row.assigneeId !== userId)
      throw new ConflictException('Este pedido já está com outro engenheiro');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.engineeringRequest.update({
        where: { id },
        data: { assigneeId: userId, status: 'IN_PROGRESS' },
        include: this.include,
      });
      await this.events.record(
        { type: 'ASSIGNED', requestId: id, text: 'Pedido assumido', data: { assigneeId: userId } },
        tx,
      );
      await this.audit.record(
        {
          action: 'engineering.request_assigned',
          entity: 'EngineeringRequest',
          entityId: id,
          after: { assigneeId: userId },
        },
        tx,
      );
      return result;
    });
    const names = await this.names([updated.assigneeId]);
    return toRequestDto(
      updated,
      updated.assigneeId ? (names.get(updated.assigneeId) ?? null) : null,
    );
  }

  async cancel(id: string, reason: string): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    if (row.status === 'DONE' || row.status === 'CANCELLED')
      throw new ConflictException('Este pedido já foi encerrado');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.engineeringRequest.update({
        where: { id },
        data: { status: 'CANCELLED', resolution: reason, resolvedAt: new Date() },
        include: this.include,
      });
      await this.events.record(
        { type: 'STATUS', requestId: id, text: reason, data: { to: 'CANCELLED' } },
        tx,
      );
      await this.audit.record(
        {
          action: 'engineering.request_cancelled',
          entity: 'EngineeringRequest',
          entityId: id,
          after: { reason },
        },
        tx,
      );
      return result;
    });
    const names = await this.names([updated.assigneeId]);
    return toRequestDto(
      updated,
      updated.assigneeId ? (names.get(updated.assigneeId) ?? null) : null,
    );
  }

  private async dto(id: string): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    const names = await this.names([row.assigneeId]);
    return toRequestDto(row, row.assigneeId ? (names.get(row.assigneeId) ?? null) : null);
  }

  /** Contexto da oportunidade para a engenharia trabalhar sem sair do pedido. */
  private async contextOf(opportunityId: string): Promise<EngineeringRequestContextDto> {
    const opportunity = await this.prisma.db.opportunity.findFirst({
      where: { id: opportunityId },
      include: { account: { select: { id: true, name: true } } },
    });
    const [site, unit, snapshot, session, owner] = await Promise.all([
      opportunity?.siteId
        ? this.prisma.db.site.findFirst({ where: { id: opportunity.siteId, deletedAt: null } })
        : null,
      opportunity?.consumerUnitId
        ? this.prisma.db.consumerUnit.findFirst({
            where: { id: opportunity.consumerUnitId, deletedAt: null },
          })
        : null,
      this.prisma.db.energyBillSnapshot.findFirst({
        where: { bill: { opportunityId } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.calculationSession.findFirst({
        where: { opportunityId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      opportunity?.ownerId
        ? this.prisma.db.user.findFirst({
            where: { id: opportunity.ownerId },
            select: { id: true, name: true },
          })
        : null,
    ]);
    const distributor = unit?.distributorId
      ? await this.prisma.db.distributor.findFirst({
          where: { id: unit.distributorId },
          select: { name: true },
        })
      : null;
    const result = (session?.result ?? null) as {
      annualGenerationKwh?: number;
      installedPowerKwp?: number;
      alerts?: { severity: string; message: string }[];
    } | null;
    const history =
      (snapshot?.fields as { consumptionHistory?: { month: string; kwh: number }[] } | undefined)
        ?.consumptionHistory ?? [];
    return {
      account: opportunity?.account ?? null,
      site: site
        ? {
            id: site.id,
            name: site.name,
            city: site.city,
            state: site.state,
            latitude: site.latitude,
            longitude: site.longitude,
            intake: site.intake as Record<string, unknown>,
          }
        : null,
      consumerUnit: unit
        ? {
            id: unit.id,
            number: unit.number,
            customerGroup: unit.customerGroup,
            phaseSystem: unit.phaseSystem,
            distributorName: distributor?.name ?? null,
          }
        : null,
      calculation: session
        ? {
            id: session.id,
            createdAt: session.createdAt.toISOString(),
            systemKwp: result?.installedPowerKwp ?? null,
            generationKwhYear: result?.annualGenerationKwh ?? null,
            alerts: result?.alerts ?? [],
          }
        : null,
      consumptionHistory: [...history].sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
      seller: owner,
    };
  }

  async detail(id: string): Promise<EngineeringRequestDetailDto> {
    const row = await this.require(id);
    const base = await this.dto(id);
    const [context, events] = await Promise.all([
      this.contextOf(row.opportunityId),
      this.events.list({ requestId: id, projectId: row.projectId }),
    ]);
    return {
      ...base,
      context,
      events,
      allowedTransitions: [...REQUEST_TRANSITIONS[row.status]],
    };
  }

  /** Muda o estado seguindo o fluxo permitido; esperar visita/informação, cancelar e concluir à mão exigem uma nota. */
  async changeStatus(
    id: string,
    input: ChangeRequestStatusInput,
  ): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    if (!REQUEST_TRANSITIONS[row.status].includes(input.status))
      throw new UnprocessableEntityException({
        message: `Não é possível ir de "${row.status}" para "${input.status}".`,
        code: 'INVALID_REQUEST_TRANSITION',
        data: { from: row.status, allowed: REQUEST_TRANSITIONS[row.status] },
      });
    const needsNote = ['WAITING_VISIT', 'WAITING_INFO', 'CANCELLED', 'DONE'].includes(input.status);
    if (needsNote && !input.note?.trim())
      throw new UnprocessableEntityException('Explique o motivo na observação.');
    const closing = input.status === 'DONE' || input.status === 'CANCELLED';
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringRequest.update({
        where: { id },
        data: {
          status: input.status,
          ...(closing ? { resolution: input.note ?? null, resolvedAt: new Date() } : {}),
          ...(input.status === 'IN_PROGRESS' && !row.assigneeId && this.context.userId
            ? { assigneeId: this.context.userId }
            : {}),
        },
      });
      await this.events.record(
        {
          type: 'STATUS',
          requestId: id,
          text: input.note ?? null,
          data: { from: row.status, to: input.status },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'engineering.request_status_changed',
          entity: 'EngineeringRequest',
          entityId: id,
          before: { status: row.status },
          after: { status: input.status },
        },
        tx,
      );
    });
    return this.dto(id);
  }

  async comment(id: string, text: string): Promise<EngineeringRequestDetailDto> {
    const row = await this.require(id);
    await this.events.record({ type: 'COMMENT', requestId: id, projectId: row.projectId, text });
    return this.detail(id);
  }

  /** Pergunta ao vendedor: vira tarefa no CRM para o responsável da oportunidade e deixa o pedido aguardando informação. */
  async requestInfo(id: string, question: string): Promise<EngineeringRequestDetailDto> {
    const row = await this.require(id);
    if (row.status === 'DONE' || row.status === 'CANCELLED')
      throw new ConflictException('Este pedido já foi encerrado');
    const opportunity = await this.prisma.db.opportunity.findFirst({
      where: { id: row.opportunityId },
      select: { ownerId: true, projectCode: true },
    });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.task.create({
        data: {
          tenantId: this.context.requireTenantId(),
          title: `Engenharia pede informação: ${opportunity?.projectCode ?? ''}`.trim(),
          description: question,
          dueAt: new Date(Date.now() + 2 * 86_400_000),
          assigneeId: opportunity?.ownerId ?? null,
          opportunityId: row.opportunityId,
          createdById: this.context.userId ?? null,
          origin: 'engineering',
        },
      });
      if (row.status === 'IN_PROGRESS')
        await tx.engineeringRequest.update({ where: { id }, data: { status: 'WAITING_INFO' } });
      await this.events.record(
        { type: 'INFO_REQUEST', requestId: id, projectId: row.projectId, text: question },
        tx,
      );
    });
    return this.detail(id);
  }

  /** Prioridade e prazo (quem coordena a engenharia). */
  async updatePlan(
    id: string,
    input: UpdateRequestPlanInput,
  ): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringRequest.update({
        where: { id },
        data: {
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
        },
      });
      await this.events.record(
        {
          type: 'PRIORITY',
          requestId: id,
          projectId: row.projectId,
          data: {
            priority: input.priority ?? row.priority,
            dueAt: input.dueAt ?? row.dueAt?.toISOString() ?? null,
          },
        },
        tx,
      );
    });
    return this.dto(id);
  }

  /** Reatribui a outro engenheiro (só quem coordena). */
  async reassign(id: string, userId: string): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    if (row.status === 'DONE' || row.status === 'CANCELLED')
      throw new ConflictException('Este pedido já foi encerrado');
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringRequest.update({
        where: { id },
        data: {
          assigneeId: userId,
          ...(row.status === 'PENDING' ? { status: 'IN_PROGRESS' as const } : {}),
        },
      });
      await this.events.record(
        {
          type: 'ASSIGNED',
          requestId: id,
          projectId: row.projectId,
          text: `Atribuído a ${user.name}`,
          data: { assigneeId: userId },
        },
        tx,
      );
    });
    return this.dto(id);
  }

  /** Números do painel da engenharia. */
  async dashboard(): Promise<EngineeringDashboardDto> {
    const [requests, projects] = await Promise.all([
      this.prisma.db.engineeringRequest.findMany({
        select: {
          id: true,
          status: true,
          assigneeId: true,
          priority: true,
          dueAt: true,
          createdAt: true,
          resolvedAt: true,
          opportunity: { select: { projectCode: true, account: { select: { name: true } } } },
        },
      }),
      this.prisma.db.engineeringProject.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const isOpen = (s: string) => s !== 'DONE' && s !== 'CANCELLED';
    const byStatus: Record<string, number> = {};
    for (const r of requests) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const open = requests.filter((r) => isOpen(r.status));
    const done = requests.filter((r) => r.status === 'DONE' && r.resolvedAt);
    const days = done.map(
      (r) => ((r.resolvedAt as Date).getTime() - r.createdAt.getTime()) / 86_400_000,
    );
    const assignees = [...new Set(open.map((r) => r.assigneeId).filter((v): v is string => !!v))];
    const users = assignees.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: assignees } },
          select: { id: true, name: true },
        })
      : [];
    const byAssignee = assignees.map((id) => ({
      id,
      name: users.find((u) => u.id === id)?.name ?? 'Sem nome',
      open: open.filter((r) => r.assigneeId === id).length,
    }));
    const projectCount = (status: string) =>
      projects.find((p) => p.status === status)?._count._all ?? 0;
    return {
      byStatus,
      open: open.length,
      overdue: open.filter((r) => r.dueAt && r.dueAt.getTime() < Date.now()).length,
      unassigned: open.filter((r) => !r.assigneeId).length,
      urgent: open.filter((r) => r.priority === 'URGENT').length,
      avgResolutionDays: days.length
        ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10
        : null,
      byAssignee: byAssignee.sort((a, b) => b.open - a.open),
      projects: {
        inProgress: projectCount('IN_PROGRESS'),
        approved: projectCount('APPROVED'),
        cancelled: projectCount('CANCELLED'),
      },
      upcoming: open
        .filter((r) => r.dueAt)
        .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime())
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          projectCode: r.opportunity.projectCode,
          customerName: r.opportunity.account?.name ?? null,
          dueAt: (r.dueAt as Date).toISOString(),
          priority: r.priority,
        })),
    };
  }
}
