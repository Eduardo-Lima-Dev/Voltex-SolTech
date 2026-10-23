import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Installation } from '@voltex/database';
import {
  DomainEvent,
  TimelineEventType,
  type ChangeInstallationStatusInput,
  type InstallationDetailDto,
  type InstallationStatus,
  type InstallationSummaryDto,
  type ListInstallationsQuery,
  type RegisterAcceptanceInput,
  type OperationsDashboardDto,
  type UpdateInstallationInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../../platform/audit/audit.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { TimelineService } from '../crm/support/timeline.service';
import { UserDirectory } from '../crm/support/user-directory.service';
import {
  INSTALLATION_STATUS_LABEL,
  INSTALLATION_TRANSITIONS,
  canTransition,
  requiresReason,
} from './installation-transitions';
import { siteLabelOf, toFieldIssueDto, toHistoryDto, toMaterialDto } from './operations.mapper';
import { WorkOrderPresenter } from './work-order-presenter.service';

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];

const DAY = 86_400_000;
const MATERIAL_READY_STATES = ['RECEIVED', 'SEPARATED'];
const ACTIVE_MATERIAL_STATES = ['PENDING', 'ORDERED', 'RECEIVED', 'SEPARATED'] as const;
/** Ordens que ainda contam como "em aberto" para a instalação. */
const OPEN_ORDER_STATES = ['PENDING', 'SCHEDULED', 'IN_PROGRESS'] as const;

/**
 * Instalação em campo depois da homologação (ADR-0020). Dona da máquina de estados: toda mudança de situação passa
 * por `transition`, que valida o passo, grava o histórico, a linha do tempo, a auditoria e o evento, na mesma transação.
 */
@Injectable()
export class InstallationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly timeline: TimelineService,
    private readonly directory: UserDirectory,
    private readonly presenter: WorkOrderPresenter,
  ) {}

  // --- leitura ----------------------------------------------------------------------------------------------

  private async summarize(rows: Installation[]): Promise<InstallationSummaryDto[]> {
    if (rows.length === 0) return [];
    const db = this.prisma.db;
    const ids = rows.map((r) => r.id);
    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const siteIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
    const [accounts, sites, materials, issues, orders] = await Promise.all([
      db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }),
      siteIds.length
        ? db.site.findMany({
            where: { id: { in: siteIds } },
            select: { id: true, name: true, city: true, state: true },
          })
        : [],
      db.materialItem.groupBy({
        by: ['installationId', 'status'],
        where: { installationId: { in: ids }, status: { not: 'CANCELLED' } },
        _count: { _all: true },
      }),
      db.fieldIssue.groupBy({
        by: ['installationId'],
        where: { installationId: { in: ids }, status: 'OPEN' },
        _count: { _all: true },
      }),
      db.workOrder.findMany({
        where: {
          installationId: { in: ids },
          status: 'SCHEDULED',
          scheduledStart: { not: null },
        },
        select: { installationId: true, scheduledStart: true },
        orderBy: { scheduledStart: 'asc' },
      }),
    ]);
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const siteById = new Map(sites.map((s) => [s.id, s]));
    return rows.map((row) => {
      const mine = materials.filter((m) => m.installationId === row.id);
      const next = orders.find((o) => o.installationId === row.id);
      return {
        id: row.id,
        projectId: row.projectId,
        projectCode: row.projectCode,
        opportunityId: row.opportunityId,
        accountId: row.accountId,
        accountName: accountName.get(row.accountId) ?? '—',
        siteLabel: siteLabelOf(row.siteId ? siteById.get(row.siteId) : null),
        status: row.status,
        responsibleId: row.responsibleId,
        materialsTotal: mine.reduce((sum, m) => sum + m._count._all, 0),
        materialsReady: mine
          .filter((m) => MATERIAL_READY_STATES.includes(m.status))
          .reduce((sum, m) => sum + m._count._all, 0),
        openIssues: issues.find((i) => i.installationId === row.id)?._count._all ?? 0,
        nextScheduledStart: next?.scheduledStart?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async list(query: ListInstallationsQuery) {
    const db = this.prisma.db;
    let accountIds: string[] | undefined;
    if (query.search) {
      const accounts = await db.account.findMany({
        where: { name: { contains: query.search, mode: 'insensitive' } },
        select: { id: true },
        take: 200,
      });
      accountIds = accounts.map((a) => a.id);
    }
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { projectCode: { contains: query.search, mode: 'insensitive' as const } },
              { accountId: { in: accountIds ?? [] } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.installation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      db.installation.count({ where }),
    ]);
    return toPaginated(await this.summarize(rows), total, query);
  }

  async require(id: string): Promise<Installation> {
    const row = await this.prisma.db.installation.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Instalação não encontrada');
    return row;
  }

  async getDetail(id: string): Promise<InstallationDetailDto> {
    const row = await this.require(id);
    const db = this.prisma.db;
    const [summary] = await this.summarize([row]);
    const [project, materials, orders, issues, history] = await Promise.all([
      db.project.findFirstOrThrow({ where: { id: row.projectId }, select: { status: true } }),
      db.materialItem.findMany({ where: { installationId: id }, orderBy: { createdAt: 'asc' } }),
      db.workOrder.findMany({
        where: { installationId: id },
        orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'asc' }],
      }),
      db.fieldIssue.findMany({ where: { installationId: id }, orderBy: { createdAt: 'desc' } }),
      db.installationHistory.findMany({
        where: { installationId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      ...summary!,
      engineeringSnapshotId: row.engineeringSnapshotId,
      projectStatus: project.status,
      materialsGeneratedAt: row.materialsGeneratedAt?.toISOString() ?? null,
      materialsReadyAt: row.materialsReadyAt?.toISOString() ?? null,
      installedAt: row.installedAt?.toISOString() ?? null,
      doneAt: row.doneAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      acceptance: row.acceptedAt
        ? {
            acceptedAt: row.acceptedAt.toISOString(),
            acceptedByName: row.acceptedByName ?? '',
            channel: row.acceptedChannel ?? 'OFFICE',
            note: row.acceptanceNote,
            hasSignature: row.acceptanceSignatureDocumentId !== null,
          }
        : null,
      allowedTransitions: [...INSTALLATION_TRANSITIONS[row.status]],
      materials: materials.map(toMaterialDto),
      workOrders: await this.presenter.present(orders),
      issues: issues.map(toFieldIssueDto),
      history: history.map(toHistoryDto),
    };
  }

  // --- criação a partir do projeto --------------------------------------------------------------------------

  /** Cria a instalação do projeto, se ainda não existe (idempotente). */
  async ensureForProject(projectId: string, tx?: Tx): Promise<Installation> {
    const db = tx ?? this.prisma.db;
    const existing = await db.installation.findFirst({ where: { projectId } });
    if (existing) return existing;
    const project = await db.project.findFirstOrThrow({ where: { id: projectId } });
    const contract = await db.contract.findFirst({
      where: { id: project.contractId },
      select: { quoteId: true },
    });
    const quote = contract
      ? await db.quote.findFirst({
          where: { id: contract.quoteId },
          select: { engineeringSnapshotId: true },
        })
      : null;
    // Projeto já aprovado na homologação nasce esperando material, não engenharia.
    const status: InstallationStatus =
      project.status === 'APPROVED' ? 'AWAITING_MATERIAL' : 'AWAITING_ENGINEERING';
    const run = async (client: Tx) => {
      const created = await client.installation.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId: project.id,
          opportunityId: project.opportunityId,
          projectCode: project.projectCode,
          accountId: project.accountId,
          siteId: project.siteId,
          engineeringSnapshotId: quote?.engineeringSnapshotId ?? null,
          responsibleId: project.responsibleId,
          status,
        },
      });
      await client.installationHistory.create({
        data: {
          tenantId: created.tenantId,
          installationId: created.id,
          fromStatus: null,
          toStatus: status,
          reason: 'Instalação criada a partir do projeto',
          actorId: this.context.userId ?? null,
        },
      });
      return created;
    };
    return tx ? run(tx) : this.prisma.db.$transaction(run);
  }

  /** Cria as instalações dos projetos que ainda não têm (projetos anteriores à Fase 11B). */
  async reconcile(): Promise<{ created: number }> {
    const projects = await this.prisma.db.project.findMany({
      where: { status: { not: 'CANCELLED' }, installation: null },
      select: { id: true },
    });
    for (const p of projects) await this.ensureForProject(p.id);
    return { created: projects.length };
  }

  // --- máquina de estados -----------------------------------------------------------------------------------

  /** Passa a instalação para `to`. Já valida o passo; as pré-condições de negócio ficam em `changeStatus`. */
  async transition(
    installation: Installation,
    to: InstallationStatus,
    options: { reason?: string; tx?: Tx; automatic?: boolean } = {},
  ): Promise<Installation> {
    const from = installation.status;
    if (!canTransition(from, to))
      throw new UnprocessableEntityException({
        code: 'INVALID_INSTALLATION_TRANSITION',
        message: `Não é possível passar de "${INSTALLATION_STATUS_LABEL[from]}" para "${INSTALLATION_STATUS_LABEL[to]}".`,
      });
    const run = async (tx: Tx): Promise<Installation> => {
      const now = new Date();
      const updated = await tx.installation.update({
        where: { id: installation.id },
        data: {
          status: to,
          ...(to === 'MATERIAL_READY' ? { materialsReadyAt: now } : {}),
          ...(to === 'INSTALLED' ? { installedAt: now } : {}),
          ...(to === 'DONE' ? { doneAt: now } : {}),
          ...(to === 'CANCELLED' ? { cancelledAt: now, cancelReason: options.reason ?? null } : {}),
        },
      });
      await tx.installationHistory.create({
        data: {
          tenantId: updated.tenantId,
          installationId: updated.id,
          fromStatus: from,
          toStatus: to,
          reason: options.reason ?? null,
          actorId: options.automatic ? null : (this.context.userId ?? null),
        },
      });
      await this.timeline.record(
        {
          opportunityId: updated.opportunityId,
          type: TimelineEventType.INSTALLATION_STATUS_CHANGED,
          summary: `Instalação: ${INSTALLATION_STATUS_LABEL[from]} → ${INSTALLATION_STATUS_LABEL[to]}${options.reason ? ` (${options.reason})` : ''}`,
          data: { installationId: updated.id, from, to },
          actorId: options.automatic ? null : undefined,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'installation.status_changed',
          entity: 'Installation',
          entityId: updated.id,
          before: { status: from },
          after: { status: to, reason: options.reason ?? null },
        },
        tx,
      );
      await this.onEnter(tx, updated, to);
      return updated;
    };
    return options.tx ? run(options.tx) : this.prisma.db.$transaction(run);
  }

  /** Efeitos de entrar num estado: eventos de domínio, tarefas e a ordem de comissionamento. */
  private async onEnter(tx: Tx, inst: Installation, to: InstallationStatus): Promise<void> {
    const payload = {
      installationId: inst.id,
      projectId: inst.projectId,
      opportunityId: inst.opportunityId,
    };
    const owner = await this.taskAssignee(tx, inst);
    if (to === 'MATERIAL_READY') {
      await this.events.publish(
        { type: DomainEvent.MATERIALS_READY, projectCode: inst.projectCode, payload },
        tx,
      );
      await this.upsertTask(tx, inst, {
        key: `install-schedule:${inst.id}`,
        title: 'Agendar a instalação: o material está separado',
        dueAt: new Date(Date.now() + 2 * DAY),
        assigneeId: owner,
      });
    }
    if (to === 'INSTALLED') {
      await this.events.publish(
        { type: DomainEvent.INSTALLATION_COMPLETED, projectCode: inst.projectCode, payload },
        tx,
      );
      // Abre o comissionamento (automação de execução): uma ordem pendente, se ainda não há uma em aberto.
      const open = await tx.workOrder.findFirst({
        where: {
          installationId: inst.id,
          type: 'COMMISSIONING',
          status: { in: [...OPEN_ORDER_STATES] },
        },
        select: { id: true },
      });
      if (!open)
        await tx.workOrder.create({
          data: {
            tenantId: inst.tenantId,
            installationId: inst.id,
            projectCode: inst.projectCode,
            accountId: inst.accountId,
            siteId: inst.siteId,
            type: 'COMMISSIONING',
            title: `Comissionamento – ${inst.projectCode}`,
            createdById: this.context.userId ?? null,
          },
        });
      await this.upsertTask(tx, inst, {
        key: `commissioning-open:${inst.id}`,
        title: 'Agendar o comissionamento: a instalação foi concluída',
        dueAt: new Date(Date.now() + 2 * DAY),
        assigneeId: owner,
      });
    }
  }

  private async taskAssignee(tx: Tx, inst: Installation): Promise<string | null> {
    if (inst.responsibleId) return inst.responsibleId;
    const opportunity = await tx.opportunity.findFirst({
      where: { id: inst.opportunityId },
      select: { ownerId: true },
    });
    return opportunity?.ownerId ?? null;
  }

  /** Tarefa de automação, idempotente pela chave: repetir o evento não duplica. */
  async upsertTask(
    tx: Tx,
    inst: Installation,
    task: {
      key: string;
      title: string;
      dueAt: Date;
      assigneeId: string | null;
      description?: string;
    },
  ): Promise<void> {
    await tx.task.upsert({
      where: { tenantId_automationKey: { tenantId: inst.tenantId, automationKey: task.key } },
      update: {},
      create: {
        tenantId: inst.tenantId,
        title: task.title,
        description: task.description ?? null,
        dueAt: task.dueAt,
        assigneeId: task.assigneeId,
        opportunityId: inst.opportunityId,
        accountId: inst.accountId,
        origin: 'automation:installation',
        automationKey: task.key,
      },
    });
  }

  /** Mudança manual de situação, com as pré-condições de negócio de cada passo. */
  async changeStatus(
    id: string,
    input: ChangeInstallationStatusInput,
  ): Promise<InstallationDetailDto> {
    const inst = await this.require(id);
    const to = input.status;
    if (!canTransition(inst.status, to))
      throw new UnprocessableEntityException({
        code: 'INVALID_INSTALLATION_TRANSITION',
        message: `Não é possível passar de "${INSTALLATION_STATUS_LABEL[inst.status]}" para "${INSTALLATION_STATUS_LABEL[to]}".`,
      });
    if (requiresReason(inst.status, to) && !input.reason)
      throw new UnprocessableEntityException({
        code: 'REASON_REQUIRED',
        message: 'Informe o motivo para voltar uma etapa ou cancelar.',
      });
    await this.assertPreconditions(inst, to);
    await this.prisma.db.$transaction(async (tx) => {
      const updated = await this.transition(inst, to, { reason: input.reason, tx });
      if (to === 'CANCELLED') {
        // Ordens em aberto deixam de valer; a que está em execução pede para ser concluída ou resolvida antes.
        await tx.workOrder.updateMany({
          where: { installationId: id, status: { in: ['PENDING', 'SCHEDULED'] } },
          data: {
            status: 'CANCELLED',
            cancelReason: `Instalação cancelada: ${input.reason ?? ''}`,
          },
        });
      }
      return updated;
    });
    return this.getDetail(id);
  }

  private async assertPreconditions(inst: Installation, to: InstallationStatus): Promise<void> {
    const db = this.prisma.db;
    if (to === 'AWAITING_MATERIAL' && inst.status === 'AWAITING_ENGINEERING') {
      const project = await db.project.findFirstOrThrow({
        where: { id: inst.projectId },
        select: { status: true },
      });
      if (project.status !== 'APPROVED')
        throw new UnprocessableEntityException({
          code: 'HOMOLOGATION_PENDING',
          message: 'A homologação do projeto ainda não foi aprovada.',
        });
    }
    if (to === 'MATERIAL_READY') {
      const items = await db.materialItem.findMany({
        where: { installationId: inst.id, status: { in: [...ACTIVE_MATERIAL_STATES] } },
        select: { status: true },
      });
      if (items.length === 0)
        throw new UnprocessableEntityException({
          code: 'NO_MATERIAL_ITEMS',
          message: 'Cadastre ao menos um item na lista de materiais.',
        });
      if (items.some((i) => !MATERIAL_READY_STATES.includes(i.status)))
        throw new UnprocessableEntityException({
          code: 'MATERIALS_NOT_READY',
          message: 'Ainda há itens da lista de materiais sem recebimento.',
        });
    }
    if (to === 'CUSTOMER_ACCEPTANCE') {
      const approved = await db.commissioningRecord.findFirst({
        where: { installationId: inst.id, status: 'APPROVED' },
        select: { id: true },
      });
      if (!approved)
        throw new UnprocessableEntityException({
          code: 'COMMISSIONING_NOT_APPROVED',
          message: 'O comissionamento ainda não foi aprovado pelo responsável técnico.',
        });
    }
    if (to === 'DONE' && !inst.acceptedAt)
      throw new UnprocessableEntityException({
        code: 'ACCEPTANCE_REQUIRED',
        message: 'Registre o aceite do cliente para finalizar a instalação.',
      });
    if (to === 'FIELD_ISSUE') {
      const open = await db.fieldIssue.count({
        where: { installationId: inst.id, status: 'OPEN', blocking: true },
      });
      if (open === 0)
        throw new UnprocessableEntityException({
          code: 'NO_BLOCKING_ISSUE',
          message: 'Registre uma pendência de campo que bloqueia a instalação.',
        });
    }
    if (to === 'IN_PROGRESS' && inst.status === 'FIELD_ISSUE') {
      const open = await db.fieldIssue.count({
        where: { installationId: inst.id, status: 'OPEN', blocking: true },
      });
      if (open > 0)
        throw new UnprocessableEntityException({
          code: 'BLOCKING_ISSUES_OPEN',
          message: 'Ainda há pendências de campo que bloqueiam a instalação.',
        });
    }
  }

  async update(id: string, input: UpdateInstallationInput): Promise<InstallationDetailDto> {
    const inst = await this.require(id);
    if (input.responsibleId) await this.directory.assertActive(input.responsibleId, 'responsável');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.installation.update({
        where: { id },
        data: input.responsibleId !== undefined ? { responsibleId: input.responsibleId } : {},
      });
      await this.audit.record(
        {
          action: 'installation.updated',
          entity: 'Installation',
          entityId: id,
          before: { responsibleId: inst.responsibleId },
          after: { responsibleId: input.responsibleId ?? inst.responsibleId },
        },
        tx,
      );
    });
    return this.getDetail(id);
  }

  /**
   * Registra o aceite do cliente e finaliza a instalação. É um **registro** (nome, data, canal e, se houver, a
   * assinatura de campo), não uma assinatura eletrônica. Só vale com o comissionamento aprovado.
   */
  async registerAcceptance(
    id: string,
    input: Pick<RegisterAcceptanceInput, 'acceptedByName' | 'note' | 'workOrderId'> & {
      channel: 'FIELD' | 'OFFICE' | 'PORTAL';
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<InstallationDetailDto> {
    const inst = await this.require(id);
    if (inst.status !== 'CUSTOMER_ACCEPTANCE')
      throw new UnprocessableEntityException({
        code: 'ACCEPTANCE_NOT_PENDING',
        message: 'A instalação não está aguardando o aceite do cliente.',
      });
    const approved = await this.prisma.db.commissioningRecord.findFirst({
      where: { installationId: id, status: 'APPROVED' },
      select: { id: true },
    });
    if (!approved)
      throw new UnprocessableEntityException({
        code: 'COMMISSIONING_NOT_APPROVED',
        message: 'O comissionamento ainda não foi aprovado pelo responsável técnico.',
      });
    let signatureDocumentId: string | null = null;
    if (input.channel === 'FIELD' || input.workOrderId) {
      const order = input.workOrderId
        ? await this.prisma.db.workOrder.findFirst({
            where: { id: input.workOrderId, installationId: id },
            select: { signatureDocumentId: true },
          })
        : null;
      if (!order?.signatureDocumentId)
        throw new UnprocessableEntityException({
          code: 'NO_FIELD_SIGNATURE',
          message: 'A ordem informada não tem a assinatura do cliente colhida em campo.',
        });
      signatureDocumentId = order.signatureDocumentId;
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.installation.update({
        where: { id },
        data: {
          acceptedAt: new Date(),
          acceptedByName: input.acceptedByName,
          acceptedChannel: input.channel,
          acceptanceNote: input.note ?? null,
          acceptanceIp: input.ip ?? null,
          acceptanceUserAgent: input.userAgent ?? null,
          acceptanceSignatureDocumentId: signatureDocumentId,
        },
      });
      const accepted = await this.transition({ ...inst, acceptedAt: new Date() }, 'DONE', {
        tx,
        reason: `Aceite do cliente (${input.channel === 'PORTAL' ? 'portal' : input.channel === 'FIELD' ? 'em campo' : 'registrado pelo escritório'})`,
      });
      await this.events.publish(
        {
          type: DomainEvent.CUSTOMER_ACCEPTED,
          projectCode: accepted.projectCode,
          payload: {
            installationId: accepted.id,
            projectId: accepted.projectId,
            opportunityId: accepted.opportunityId,
            channel: input.channel,
          },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'installation.accepted',
          entity: 'Installation',
          entityId: id,
          after: { acceptedByName: input.acceptedByName, channel: input.channel },
        },
        tx,
      );
    });
    return this.getDetail(id);
  }

  // --- ganchos chamados pelos outros serviços ----------------------------------------------------------------

  /** Todos os itens ativos recebidos → material separado (automático). Também desfaz se entrou item novo. */
  async syncMaterials(installationId: string): Promise<void> {
    const inst = await this.require(installationId);
    const items = await this.prisma.db.materialItem.findMany({
      where: { installationId, status: { in: [...ACTIVE_MATERIAL_STATES] } },
      select: { status: true },
    });
    const allReady =
      items.length > 0 && items.every((i) => MATERIAL_READY_STATES.includes(i.status));
    if (inst.status === 'AWAITING_MATERIAL' && allReady)
      await this.transition(inst, 'MATERIAL_READY', {
        automatic: true,
        reason: 'Todos os itens foram recebidos',
      });
    else if (inst.status === 'MATERIAL_READY' && !allReady)
      await this.transition(inst, 'AWAITING_MATERIAL', {
        automatic: true,
        reason: 'A lista de materiais mudou e há itens sem recebimento',
      });
  }

  /**
   * Ajusta a situação ao que a ordem de instalação diz: com data e equipe (ou técnico) a instalação fica "equipe
   * designada"; sem isso, "agendamento". Passa pelos estados intermediários para o histórico ficar completo.
   */
  async syncSchedule(installationId: string): Promise<void> {
    let inst = await this.require(installationId);
    if (!['MATERIAL_READY', 'SCHEDULING', 'CREW_ASSIGNED'].includes(inst.status)) return;
    const order = await this.prisma.db.workOrder.findFirst({
      where: {
        installationId,
        type: 'INSTALLATION',
        status: { in: [...OPEN_ORDER_STATES] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const complete = Boolean(order?.scheduledStart && (order.crewId || order.assigneeId));
    await this.prisma.db.$transaction(async (tx) => {
      if (!order) {
        if (inst.status === 'CREW_ASSIGNED')
          inst = await this.transition(inst, 'SCHEDULING', {
            tx,
            automatic: true,
            reason: 'A ordem de instalação foi cancelada',
          });
        return;
      }
      if (inst.status === 'MATERIAL_READY')
        inst = await this.transition(inst, 'SCHEDULING', { tx, automatic: true });
      if (complete && inst.status === 'SCHEDULING') {
        inst = await this.transition(inst, 'CREW_ASSIGNED', { tx, automatic: true });
        await this.events.publish(
          {
            type: DomainEvent.INSTALLATION_SCHEDULED,
            projectCode: inst.projectCode,
            payload: {
              installationId: inst.id,
              projectId: inst.projectId,
              opportunityId: inst.opportunityId,
              workOrderId: order.id,
              scheduledStart: order.scheduledStart!.toISOString(),
            },
          },
          tx,
        );
        // O aviso ao cliente é manual (e-mail ou link do WhatsApp): a tarefa lembra quem deve enviar.
        await this.upsertTask(tx, inst, {
          key: `install-notice:${order.id}:${order.scheduledStart!.toISOString()}`,
          title: `Avisar o cliente da instalação em ${order.scheduledStart!.toLocaleDateString('pt-BR')}`,
          dueAt: new Date(Math.max(Date.now() + DAY / 2, order.scheduledStart!.getTime() - DAY)),
          assigneeId: await this.taskAssignee(tx, inst),
        });
      } else if (!complete && inst.status === 'CREW_ASSIGNED') {
        await this.transition(inst, 'SCHEDULING', {
          tx,
          automatic: true,
          reason: 'A ordem de instalação ficou sem data ou sem equipe',
        });
      }
    });
  }

  // --- indicadores (§51) ------------------------------------------------------------------------------------

  async dashboard(): Promise<OperationsDashboardDto> {
    const db = this.prisma.db;
    const since = new Date(Date.now() - 30 * DAY);
    const [byStatus, overdue, issues, done, withIssues, installOrders] = await Promise.all([
      db.installation.groupBy({ by: ['status'], _count: { _all: true } }),
      db.workOrder.count({ where: { status: 'SCHEDULED', scheduledStart: { lt: new Date() } } }),
      db.fieldIssue.count({ where: { status: 'OPEN' } }),
      db.workOrder.groupBy({
        by: ['crewId'],
        where: { status: 'DONE', completedAt: { gte: since }, crewId: { not: null } },
        _count: { _all: true },
      }),
      db.fieldIssue.findMany({ distinct: ['installationId'], select: { installationId: true } }),
      db.workOrder.groupBy({
        by: ['installationId'],
        where: { type: 'INSTALLATION', status: { in: ['DONE', 'IN_PROGRESS'] } },
        _count: { _all: true },
      }),
    ]);
    const counts: OperationsDashboardDto['byStatus'] = {};
    for (const row of byStatus) counts[row.status] = row._count._all;
    const crewIds = done.map((d) => d.crewId).filter((x): x is string => !!x);
    const crews = crewIds.length
      ? await db.crew.findMany({ where: { id: { in: crewIds } }, select: { id: true, name: true } })
      : [];
    const rework = new Set(withIssues.map((i) => i.installationId));
    for (const o of installOrders)
      if (o.installationId && o._count._all > 1) rework.add(o.installationId);
    return {
      byStatus: counts,
      scheduledCount: counts.CREW_ASSIGNED ?? 0,
      overdueCount: overdue,
      awaitingMaterialCount: counts.AWAITING_MATERIAL ?? 0,
      openIssuesCount: issues,
      crews: done.map((d) => ({
        crewId: d.crewId!,
        crewName: crews.find((c) => c.id === d.crewId)?.name ?? '—',
        doneLast30Days: d._count._all,
      })),
      reworkCount: rework.size,
    };
  }
}
