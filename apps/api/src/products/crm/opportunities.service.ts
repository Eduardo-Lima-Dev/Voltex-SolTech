import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Opportunity } from '@voltex/database';
import {
  DomainEvent,
  OpportunityStage,
  OpportunityStatus,
  TimelineEventType,
  canTransition,
  OPPORTUNITY_TRANSITIONS,
  type ChangeStageInput,
  type CreateOpportunityData,
  type ListOpportunitiesQuery,
  type OpportunityBoardDto,
  type OpportunityCalculationContext,
  type OpportunityDto,
  type SiteIntake,
  type TimelineEventDto,
  type UpdateOpportunityData,
} from '@voltex/shared';
import type { CreateCalculationInput } from '@voltex/solar-engine';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../../platform/audit/audit.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CalculatorService } from '../calculator/calculator.service';
import { PipelineService } from './pipeline.service';
import { generateProjectCode } from './support/project-code';
import { TimelineService } from './support/timeline.service';
import { UserDirectory } from './support/user-directory.service';

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];
type OpportunityWithAccount = Opportunity & { account: { name: string } };

export interface CreateOpportunityWithin {
  accountId: string;
  siteId?: string | null;
  consumerUnitId?: string | null;
  leadId?: string | null;
  projectType: CreateOpportunityData['projectType'];
  title: string;
  ownerId: string | null;
  stage?: OpportunityStage;
  expectedCloseDate: Date | null;
}

const BOARD_CARDS_PER_STAGE = 50;
const BOARD_CLOSED_WINDOW_DAYS = 30;

/** Contrato das travas de etapa (Project Guard e Margin Guard entram aqui na Fase 7B). */
export interface StageGate {
  assertCanEnter(opportunity: Opportunity, to: OpportunityStage): Promise<void>;
}

@Injectable()
export class OpportunitiesService {
  private readonly gates: StageGate[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly users: UserDirectory,
    private readonly timeline: TimelineService,
    private readonly pipeline: PipelineService,
    private readonly calculator: CalculatorService,
  ) {}

  /** Registra uma trava: toda mudança de etapa passa por ela antes de acontecer. */
  registerGate(gate: StageGate): void {
    this.gates.push(gate);
  }

  // ---- Criação ----

  async create(data: CreateOpportunityData): Promise<OpportunityDto> {
    await this.users.assertActive(data.ownerId, 'responsável');
    const created = await this.prisma.db.$transaction((tx) =>
      this.createWithin(tx, {
        accountId: data.accountId,
        siteId: data.siteId,
        consumerUnitId: data.consumerUnitId,
        leadId: data.leadId,
        projectType: data.projectType,
        title: data.title ?? '',
        ownerId: data.ownerId ?? this.context.userId ?? null,
        expectedCloseDate: data.expectedCloseDate ?? null,
      }),
    );
    return this.get(created.id);
  }

  /** Cria a oportunidade dentro de uma transação (também usada pela conversão de lead). */
  async createWithin(tx: Tx, input: CreateOpportunityWithin): Promise<Opportunity> {
    const tenantId = this.context.requireTenantId();
    const account = await tx.account.findFirst({
      where: { id: input.accountId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!account) throw new UnprocessableEntityException('Conta não encontrada');
    await this.assertLinks(tx, input.accountId, input.siteId, input.consumerUnitId);
    await this.pipeline.list(); // garante as etapas do tenant

    const projectCode = generateProjectCode();
    const opportunity = await tx.opportunity.create({
      data: {
        tenantId,
        projectCode,
        title: input.title.trim() || `Sistema solar — ${account.name}`,
        stage: input.stage ?? OpportunityStage.NEW_LEAD,
        projectType: input.projectType,
        accountId: input.accountId,
        siteId: input.siteId ?? null,
        consumerUnitId: input.consumerUnitId ?? null,
        leadId: input.leadId ?? null,
        ownerId: input.ownerId,
        expectedCloseDate: input.expectedCloseDate,
      },
    });
    await this.timeline.record(
      {
        opportunityId: opportunity.id,
        type: TimelineEventType.CREATED,
        summary: `Oportunidade criada (${projectCode})`,
        data: { projectCode, leadId: input.leadId ?? null },
      },
      tx,
    );
    await this.audit.record(
      {
        action: 'opportunity.created',
        entity: 'Opportunity',
        entityId: opportunity.id,
        after: { projectCode, accountId: input.accountId, stage: opportunity.stage },
      },
      tx,
    );
    await this.events.publish(
      {
        type: DomainEvent.OPPORTUNITY_CREATED,
        projectCode,
        payload: {
          opportunityId: opportunity.id,
          accountId: input.accountId,
          stage: opportunity.stage,
          leadId: input.leadId ?? null,
        },
      },
      tx,
    );
    return opportunity;
  }

  // ---- Consulta ----

  async list(query: ListOpportunitiesQuery) {
    const where = {
      deletedAt: null,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.withoutNextTask
        ? {
            status: OpportunityStatus.OPEN,
            tasks: { none: { status: 'OPEN' as const, deletedAt: null } },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { projectCode: { contains: query.search, mode: 'insensitive' as const } },
              { account: { name: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.opportunity.findMany({
        where,
        include: { account: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.opportunity.count({ where }),
    ]);
    return toPaginated(await this.toDtos(rows), total, query);
  }

  /** Quadro Kanban: uma coluna por etapa; fechadas (ganhas/perdidas) só dos últimos 30 dias. */
  async board(ownerId?: string): Promise<OpportunityBoardDto> {
    const stages = await this.pipeline.list();
    const since = new Date(Date.now() - BOARD_CLOSED_WINDOW_DAYS * 86_400_000);
    const base = {
      deletedAt: null,
      ...(ownerId ? { ownerId } : {}),
      OR: [{ status: OpportunityStatus.OPEN }, { stageChangedAt: { gte: since } }],
    };
    const counts = await this.prisma.db.opportunity.groupBy({
      by: ['stage'],
      where: base,
      _count: { _all: true },
    });
    const totals = new Map(counts.map((c) => [c.stage, c._count._all]));

    const columns = await Promise.all(
      stages.map(async (stage) => {
        const rows = await this.prisma.db.opportunity.findMany({
          where: { ...base, stage: stage.key },
          include: { account: { select: { name: true } } },
          orderBy: { stageChangedAt: 'desc' },
          take: BOARD_CARDS_PER_STAGE,
        });
        return { stage, total: totals.get(stage.key) ?? 0, items: await this.toDtos(rows) };
      }),
    );
    return { columns };
  }

  async get(id: string): Promise<OpportunityDto> {
    const row = await this.findWithAccount(id);
    return (await this.toDtos([row]))[0] as OpportunityDto;
  }

  async timelineOf(id: string): Promise<TimelineEventDto[]> {
    await this.findOrThrow(id);
    const rows = await this.prisma.db.timelineEvent.findMany({
      where: { opportunityId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
    });
    const names = await this.users.names(rows.map((r) => r.actorId));
    return rows.map((r) => ({
      id: r.id,
      opportunityId: r.opportunityId,
      type: r.type as TimelineEventType,
      summary: r.summary,
      data: r.data as Record<string, unknown>,
      actorId: r.actorId,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addNote(id: string, body: string) {
    await this.findOrThrow(id);
    await this.timeline.record({
      opportunityId: id,
      type: TimelineEventType.NOTE,
      summary: body,
    });
    return { ok: true };
  }

  // ---- Edição ----

  async update(id: string, input: UpdateOpportunityData): Promise<OpportunityDto> {
    const before = await this.findOrThrow(id);
    if (before.status !== OpportunityStatus.OPEN)
      throw new ConflictException('Oportunidade encerrada não pode ser editada');
    await this.users.assertActive(input.ownerId, 'responsável');
    const siteId = input.siteId === undefined ? before.siteId : input.siteId;
    const consumerUnitId =
      input.consumerUnitId === undefined ? before.consumerUnitId : input.consumerUnitId;

    const premisesChanged =
      siteId !== before.siteId ||
      consumerUnitId !== before.consumerUnitId ||
      (input.projectType !== undefined && input.projectType !== before.projectType);

    await this.prisma.db.$transaction(async (tx) => {
      await this.assertLinks(tx, before.accountId, siteId, consumerUnitId);
      const updated = await tx.opportunity.update({
        where: { id },
        data: {
          ...(input.title ? { title: input.title } : {}),
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          ...(input.projectType ? { projectType: input.projectType } : {}),
          ...(input.expectedCloseDate !== undefined
            ? { expectedCloseDate: input.expectedCloseDate }
            : {}),
          siteId,
          consumerUnitId,
        },
      });
      await this.audit.record(
        {
          action: 'opportunity.updated',
          entity: 'Opportunity',
          entityId: id,
          before: { title: before.title, ownerId: before.ownerId, siteId: before.siteId },
          after: { title: updated.title, ownerId: updated.ownerId, siteId: updated.siteId },
        },
        tx,
      );
      if (premisesChanged) {
        await this.events.publish(
          {
            type: DomainEvent.OPPORTUNITY_PREMISES_CHANGED,
            projectCode: before.projectCode,
            payload: {
              opportunityId: id,
              siteId,
              consumerUnitId,
              projectType: updated.projectType,
            },
          },
          tx,
        );
      }
    });
    return this.get(id);
  }

  async remove(id: string) {
    const before = await this.findOrThrow(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.opportunity.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        {
          action: 'opportunity.deleted',
          entity: 'Opportunity',
          entityId: id,
          before: { projectCode: before.projectCode, title: before.title },
        },
        tx,
      );
    });
    return { id };
  }

  // ---- Etapas (RF-CRM-022/023) ----

  async changeStage(id: string, input: ChangeStageInput): Promise<OpportunityDto> {
    const opportunity = await this.findOrThrow(id);
    const to = input.stage;
    if (opportunity.status === OpportunityStatus.WON)
      throw this.invalidTransition('Oportunidade ganha não muda de etapa', opportunity.stage);
    if (to === opportunity.stage)
      throw this.invalidTransition('A oportunidade já está nesta etapa', opportunity.stage);
    if (to === OpportunityStage.WON)
      throw this.invalidTransition(
        'O ganho é registrado quando o contrato é assinado',
        opportunity.stage,
      );
    if (!canTransition(opportunity.stage, to))
      throw this.invalidTransition(
        'Não é possível ir direto para esta etapa a partir da etapa atual',
        opportunity.stage,
      );
    for (const gate of this.gates) await gate.assertCanEnter(opportunity, to);

    await this.prisma.db.$transaction((tx) =>
      this.moveStageWithin(tx, opportunity, to, input.lostReason ?? null),
    );
    return this.get(id);
  }

  /** Muda a etapa dentro de uma transação, sem validar (quem chama já validou). */
  async moveStageWithin(
    tx: Tx,
    opportunity: Opportunity,
    to: OpportunityStage,
    lostReason: string | null = null,
    reason?: string,
  ): Promise<void> {
    const stages = await this.pipeline.list();
    const name = (key: OpportunityStage) => stages.find((s) => s.key === key)?.name ?? key;
    const lost = to === OpportunityStage.LOST;
    const won = to === OpportunityStage.WON;
    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: {
        stage: to,
        stageChangedAt: new Date(),
        status: lost
          ? OpportunityStatus.LOST
          : won
            ? OpportunityStatus.WON
            : OpportunityStatus.OPEN,
        lostReason: lost ? lostReason : null,
      },
    });
    await this.timeline.record(
      {
        opportunityId: opportunity.id,
        type: TimelineEventType.STAGE_CHANGED,
        summary: `Etapa: ${name(opportunity.stage)} → ${name(to)}${lost && lostReason ? ` (${lostReason})` : ''}${reason ? ` — ${reason}` : ''}`,
        data: { from: opportunity.stage, to, lostReason, reason: reason ?? null },
      },
      tx,
    );
    await this.audit.record(
      {
        action: 'opportunity.stage_changed',
        entity: 'Opportunity',
        entityId: opportunity.id,
        before: { stage: opportunity.stage },
        after: { stage: to, lostReason },
      },
      tx,
    );
    await this.events.publish(
      {
        type: DomainEvent.OPPORTUNITY_STAGE_CHANGED,
        projectCode: opportunity.projectCode,
        payload: { opportunityId: opportunity.id, from: opportunity.stage, to, lostReason },
      },
      tx,
    );
  }

  // ---- Integração com o Calculator (RF-CRM-040..042) ----

  /** Dados da oportunidade que pré-preenchem o cálculo: UC, local, fatura validada e tarifa vigente. */
  async calculationContext(id: string): Promise<OpportunityCalculationContext> {
    const opportunity = await this.findWithAccount(id);
    const [site, unit, snapshot] = await Promise.all([
      opportunity.siteId
        ? this.prisma.db.site.findFirst({ where: { id: opportunity.siteId, deletedAt: null } })
        : null,
      opportunity.consumerUnitId
        ? this.prisma.db.consumerUnit.findFirst({
            where: { id: opportunity.consumerUnitId, deletedAt: null },
            include: { distributor: true },
          })
        : null,
      this.prisma.db.energyBillSnapshot.findFirst({
        where: { bill: { opportunityId: id } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const fields = (snapshot?.fields ?? {}) as {
      consumptionHistory?: { month: string; kwh: number }[];
      customerGroup?: 'A' | 'B';
      phaseSystem?: OpportunityCalculationContext['phaseSystem'];
      tariffCentsPerKwh?: number;
    };
    const consumption = [...(fields.consumptionHistory ?? [])]
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12)
      .map((p) => p.kwh);
    const customerGroup = unit?.customerGroup ?? fields.customerGroup ?? null;

    let tariffCents: number | null = fields.tariffCentsPerKwh ?? null;
    let tariffId: string | null = null;
    if (unit?.distributorId && customerGroup) {
      const now = new Date();
      const tariff = await this.prisma.db.tariff.findFirst({
        where: {
          distributorId: unit.distributorId,
          customerGroup,
          deletedAt: null,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
        orderBy: { validFrom: 'desc' },
      });
      if (tariff) {
        tariffId = tariff.id;
        // A tarifa da fatura (com impostos) tem prioridade; a do cadastro é a alternativa.
        tariffCents ??= tariff.energyCentsPerKwh;
      }
    }

    const intake = ((site?.intake ?? {}) as SiteIntake) ?? {};
    return {
      opportunityId: id,
      title: opportunity.title,
      customerName: opportunity.account.name,
      consumptionMonthlyKwh: consumption,
      billSnapshotId: snapshot?.id ?? null,
      customerGroup,
      phaseSystem: unit?.phaseSystem ?? fields.phaseSystem ?? null,
      distributorId: unit?.distributorId ?? null,
      distributorName: unit?.distributor?.name ?? null,
      tariffCentsPerKwh: tariffCents,
      tariffId,
      latitude: site?.latitude ?? null,
      roofAzimuthDegrees: intake.roofAzimuthDegrees ?? null,
      tiltDegrees: intake.tiltDegrees ?? null,
      availableAreaM2: intake.availableAreaM2 ?? null,
      shadingRelevant: intake.shading === 'RELEVANT',
      projectType: opportunity.projectType,
    };
  }

  async createCalculation(id: string, body: CreateCalculationInput) {
    await this.findOrThrow(id);
    const session = await this.calculator.create(body);
    await this.linkCalculation(id, session.id);
    return this.calculator.get(session.id);
  }

  async listCalculations(id: string) {
    await this.findOrThrow(id);
    return this.calculator.listByOpportunity(id);
  }

  /**
   * Vincula um cálculo à oportunidade. Semáforo amarelo (ou "requer engenharia") abre um pedido de engenharia e,
   * quando a máquina de estados permite, move a oportunidade para "Engenharia necessária" (RF-CRM-042).
   */
  async linkCalculation(id: string, sessionId: string) {
    const opportunity = await this.findOrThrow(id);
    if (opportunity.status !== OpportunityStatus.OPEN)
      throw new ConflictException('Oportunidade encerrada não recebe novos cálculos');

    await this.prisma.db.$transaction(async (tx) => {
      const session = await this.calculator.attachToOpportunity(sessionId, id, tx);
      const result = session.result;
      const light = session.trafficLight;
      await this.timeline.record(
        {
          opportunityId: id,
          type: TimelineEventType.CALCULATION_LINKED,
          summary: `Cálculo vinculado: ${result.installedPowerKwp} kWp, semáforo ${light}`,
          data: { sessionId, trafficLight: light, installedPowerKwp: result.installedPowerKwp },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'opportunity.calculation_linked',
          entity: 'Opportunity',
          entityId: id,
          after: { sessionId, trafficLight: light },
        },
        tx,
      );

      if (light === 'YELLOW' || result.requiresEngineering) {
        const already = await tx.engineeringRequest.findFirst({
          where: { opportunityId: id, calculationSessionId: sessionId },
        });
        if (!already) {
          const reasons = result.alerts
            .filter((a) => a.severity !== 'INFO')
            .map((a) => a.message)
            .slice(0, 3)
            .join(' · ');
          const request = await tx.engineeringRequest.create({
            data: {
              tenantId: this.context.requireTenantId(),
              opportunityId: id,
              calculationSessionId: sessionId,
              reason: reasons || 'Cálculo com semáforo amarelo',
              createdById: this.context.userId ?? null,
            },
          });
          await this.timeline.record(
            {
              opportunityId: id,
              type: TimelineEventType.ENGINEERING_REQUESTED,
              summary: 'Pedido de engenharia aberto pelo semáforo amarelo',
              data: { requestId: request.id, reason: request.reason },
            },
            tx,
          );
          await this.events.publish(
            {
              type: DomainEvent.ENGINEERING_REQUESTED,
              projectCode: opportunity.projectCode,
              payload: {
                opportunityId: id,
                requestId: request.id,
                calculationSessionId: sessionId,
              },
            },
            tx,
          );
          if (canTransition(opportunity.stage, OpportunityStage.ENGINEERING_REQUIRED)) {
            await this.moveStageWithin(
              tx,
              opportunity,
              OpportunityStage.ENGINEERING_REQUIRED,
              null,
              'semáforo amarelo no cálculo',
            );
          }
        }
      }
    });
    return this.calculator.get(sessionId);
  }

  async listEngineeringRequests(id: string) {
    await this.findOrThrow(id);
    const rows = await this.prisma.db.engineeringRequest.findMany({
      where: { opportunityId: id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      opportunityId: r.opportunityId,
      calculationSessionId: r.calculationSessionId,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Transições possíveis a partir da etapa atual (para o front desabilitar o que não vale). */
  allowedStages(stage: OpportunityStage): readonly OpportunityStage[] {
    return OPPORTUNITY_TRANSITIONS[stage].filter((s) => s !== OpportunityStage.WON);
  }

  // ---- Internos ----

  async findOrThrow(id: string): Promise<Opportunity> {
    const row = await this.prisma.db.opportunity.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Oportunidade não encontrada');
    return row;
  }

  private async findWithAccount(id: string): Promise<OpportunityWithAccount> {
    const row = await this.prisma.db.opportunity.findFirst({
      where: { id, deletedAt: null },
      include: { account: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException('Oportunidade não encontrada');
    return row;
  }

  private async assertLinks(
    tx: Pick<Tx, 'site' | 'consumerUnit'>,
    accountId: string,
    siteId?: string | null,
    consumerUnitId?: string | null,
  ) {
    if (siteId) {
      const site = await tx.site.findFirst({ where: { id: siteId, accountId, deletedAt: null } });
      if (!site) throw new UnprocessableEntityException('O imóvel não pertence a esta conta');
    }
    if (consumerUnitId) {
      const unit = await tx.consumerUnit.findFirst({
        where: { id: consumerUnitId, accountId, deletedAt: null },
      });
      if (!unit)
        throw new UnprocessableEntityException('A unidade consumidora não pertence a esta conta');
    }
  }

  private invalidTransition(message: string, from: OpportunityStage) {
    return new UnprocessableEntityException({
      message,
      code: 'INVALID_STAGE_TRANSITION',
      data: { from, allowed: this.allowedStages(from) },
    });
  }

  private async toDtos(rows: OpportunityWithAccount[]): Promise<OpportunityDto[]> {
    const ids = rows.map((r) => r.id);
    const [names, openTasks] = await Promise.all([
      this.users.names(rows.map((r) => r.ownerId)),
      ids.length
        ? this.prisma.db.task.findMany({
            where: { opportunityId: { in: ids }, status: 'OPEN', deletedAt: null },
            select: { opportunityId: true, dueAt: true },
          })
        : [],
    ]);
    const tasks = new Map<string, { count: number; next: Date | null }>();
    for (const task of openTasks) {
      if (!task.opportunityId) continue;
      const entry = tasks.get(task.opportunityId) ?? { count: 0, next: null };
      entry.count += 1;
      if (!entry.next || task.dueAt < entry.next) entry.next = task.dueAt;
      tasks.set(task.opportunityId, entry);
    }
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      projectCode: r.projectCode,
      title: r.title,
      stage: r.stage,
      status: r.status,
      projectType: r.projectType,
      accountId: r.accountId,
      accountName: r.account.name,
      siteId: r.siteId,
      consumerUnitId: r.consumerUnitId,
      leadId: r.leadId,
      ownerId: r.ownerId,
      ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null,
      lostReason: r.lostReason,
      expectedCloseDate: r.expectedCloseDate?.toISOString() ?? null,
      valueCents: null,
      openTaskCount: tasks.get(r.id)?.count ?? 0,
      nextTaskDueAt: tasks.get(r.id)?.next?.toISOString() ?? null,
      stageChangedAt: r.stageChangedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
