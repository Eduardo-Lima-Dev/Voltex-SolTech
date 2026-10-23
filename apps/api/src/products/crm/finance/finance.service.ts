import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  Commission,
  CommissionPolicy,
  CreditApplication,
  ProjectCostEntry,
  Receivable,
} from '@voltex/database';
import {
  TimelineEventType,
  type CancelReceivableInput,
  type CommissionBase,
  type CommissionDto,
  type CommissionPolicyDto,
  type CostCategory,
  type CreateCommissionPolicyInput,
  type CreateCostEntryInput,
  type CreateCreditApplicationInput,
  type CreateReceivableInput,
  type CreditApplicationDto,
  type CreditStatus,
  type FinanceOverviewDto,
  type MarkCommissionPaidInput,
  type MarkReceivablePaidInput,
  type ProjectCostEntryDto,
  type ProjectFinancialSummaryDto,
  type ReceivableDto,
  type UpdateCreditStatusInput,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { TimelineService } from '../support/timeline.service';

const DAY = 86_400_000;

const dayStart = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const todayStart = (now: Date = new Date()): Date => dayStart(now.toISOString().slice(0, 10));
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Transições aceitas do crédito (registro manual do que a instituição respondeu). */
const CREDIT_TRANSITIONS: Record<CreditStatus, readonly CreditStatus[]> = {
  SIMULATED: ['SENT'],
  SENT: ['PENDING', 'APPROVED', 'REJECTED'],
  PENDING: ['SENT', 'APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

const toReceivableDto = (r: Receivable, now: Date = new Date()): ReceivableDto => {
  const today = todayStart(now);
  const overdue = r.status === 'OPEN' && r.dueAt.getTime() < today.getTime();
  return {
    id: r.id,
    projectId: r.projectId,
    referenceId: r.referenceId,
    order: r.order,
    amountCents: r.amountCents,
    dueOn: isoDay(r.dueAt),
    paidOn: r.paidAt ? isoDay(r.paidAt) : null,
    paymentMethod: r.paymentMethod,
    status: overdue ? 'OVERDUE' : r.status,
    daysOverdue:
      r.status === 'PAID' || r.status === 'CANCELLED'
        ? 0
        : Math.max(0, Math.floor((today.getTime() - r.dueAt.getTime()) / DAY)),
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
};

const toCostDto = (c: ProjectCostEntry): ProjectCostEntryDto => ({
  id: c.id,
  category: c.category as CostCategory,
  description: c.description,
  estimatedCents: c.estimatedCents,
  actualCents: c.actualCents,
  supplier: c.supplier,
  recordedAt: c.recordedAt.toISOString(),
});

const toCreditDto = (c: CreditApplication): CreditApplicationDto => ({
  id: c.id,
  projectId: c.projectId,
  institution: c.institution,
  status: c.status,
  annualRatePct: c.annualRatePct,
  termMonths: c.termMonths,
  amountCents: c.amountCents,
  totalCents: c.totalCents,
  pendencies: Array.isArray(c.pendencies) ? (c.pendencies as string[]) : [],
  notes: c.notes,
  appliedAt: c.appliedAt?.toISOString() ?? null,
  respondedAt: c.respondedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
});

const toPolicyDto = (p: CommissionPolicy): CommissionPolicyDto => ({
  id: p.id,
  base: p.base as CommissionBase,
  weights: (p.weights ?? {}) as Record<string, number>,
  validFrom: isoDay(p.validFrom),
  validTo: p.validTo ? isoDay(p.validTo) : null,
  notes: p.notes,
  createdAt: p.createdAt.toISOString(),
});

const toCommissionDto = (c: Commission, userName: string | null): CommissionDto => ({
  id: c.id,
  policyId: c.policyId,
  userId: c.userId,
  userName,
  projectId: c.projectId,
  amountCents: c.amountCents,
  calculatedAt: c.calculatedAt.toISOString(),
  paidAt: c.paidAt?.toISOString() ?? null,
});

/**
 * Financeiro por projeto (Fase 11G): parcelas, custos, crédito e comissões. Tudo é registro manual da empresa:
 * não há gateway de pagamento nem conciliação bancária (ADR-0024). Valores em centavos.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  private async projectOrFail(projectId: string) {
    const project = await this.prisma.db.project.findFirst({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }

  // --- parcelas -------------------------------------------------------------------------------

  async listReceivables(projectId: string): Promise<ReceivableDto[]> {
    await this.projectOrFail(projectId);
    const rows = await this.prisma.db.receivable.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return rows.map((row) => toReceivableDto(row));
  }

  async createReceivable(projectId: string, input: CreateReceivableInput): Promise<ReceivableDto> {
    const project = await this.projectOrFail(projectId);
    const active = await this.prisma.db.receivable.findMany({
      where: { projectId, status: { not: 'CANCELLED' } },
      select: { order: true, amountCents: true },
    });
    if (active.some((r) => r.order === input.order))
      throw new UnprocessableEntityException({
        message: `Já existe a parcela ${input.order} neste projeto`,
        code: 'RECEIVABLE_ORDER_EXISTS',
      });
    const planned = active.reduce((sum, r) => sum + r.amountCents, 0) + input.amountCents;
    if (planned > project.valueCents)
      throw new UnprocessableEntityException({
        message: 'A soma das parcelas passa do valor do contrato',
        code: 'RECEIVABLES_EXCEED_CONTRACT',
      });

    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.receivable.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId,
          opportunityId: project.opportunityId,
          referenceId: input.referenceId,
          order: input.order,
          amountCents: input.amountCents,
          dueAt: dayStart(input.dueOn),
          notes: input.notes ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'finance.receivable_created',
          entity: 'Receivable',
          entityId: created.id,
          after: { order: created.order, amountCents: created.amountCents, dueOn: input.dueOn },
        },
        tx,
      );
      return created;
    });
    return toReceivableDto(row);
  }

  async markPaid(
    projectId: string,
    receivableId: string,
    input: MarkReceivablePaidInput,
  ): Promise<ReceivableDto> {
    const project = await this.projectOrFail(projectId);
    const receivable = await this.prisma.db.receivable.findFirst({
      where: { id: receivableId, projectId },
    });
    if (!receivable) throw new NotFoundException('Parcela não encontrada');
    if (receivable.status === 'PAID' || receivable.status === 'CANCELLED')
      throw new UnprocessableEntityException({
        message: 'Esta parcela já foi baixada ou cancelada',
        code: 'RECEIVABLE_CLOSED',
      });
    if (input.receiptDocumentId) {
      const doc = await this.prisma.db.document.findFirst({
        where: { id: input.receiptDocumentId, deletedAt: null },
        select: { id: true },
      });
      if (!doc) throw new NotFoundException('Comprovante não encontrado');
    }

    const paidAt = input.paidOn ? dayStart(input.paidOn) : new Date();
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.receivable.update({
        where: { id: receivableId },
        data: {
          status: 'PAID',
          paidAt,
          paymentMethod: input.paymentMethod,
          receiptDocumentId: input.receiptDocumentId ?? null,
        },
      });
      await this.timeline.record(
        {
          opportunityId: project.opportunityId,
          type: TimelineEventType.RECEIVABLE_PAID,
          summary: `Parcela ${updated.order} recebida (${updated.referenceId})`,
          data: {
            receivableId,
            amountCents: updated.amountCents,
            paymentMethod: input.paymentMethod,
          },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'finance.receivable_paid',
          entity: 'Receivable',
          entityId: receivableId,
          before: { status: receivable.status },
          after: { status: 'PAID', paidOn: isoDay(paidAt), paymentMethod: input.paymentMethod },
        },
        tx,
      );
      return updated;
    });
    await this.recalculateCommissions(projectId);
    return toReceivableDto(row);
  }

  async cancelReceivable(
    projectId: string,
    receivableId: string,
    input: CancelReceivableInput,
  ): Promise<ReceivableDto> {
    await this.projectOrFail(projectId);
    const receivable = await this.prisma.db.receivable.findFirst({
      where: { id: receivableId, projectId },
    });
    if (!receivable) throw new NotFoundException('Parcela não encontrada');
    if (receivable.status === 'PAID')
      throw new UnprocessableEntityException({
        message: 'Parcela já recebida não pode ser cancelada',
        code: 'RECEIVABLE_CLOSED',
      });
    if (receivable.status === 'CANCELLED') return toReceivableDto(receivable);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.receivable.update({
        where: { id: receivableId },
        data: {
          status: 'CANCELLED',
          notes: [receivable.notes, `Cancelada: ${input.reason}`].filter(Boolean).join(' | '),
        },
      });
      await this.audit.record(
        {
          action: 'finance.receivable_cancelled',
          entity: 'Receivable',
          entityId: receivableId,
          after: { reason: input.reason },
        },
        tx,
      );
      return updated;
    });
    return toReceivableDto(row);
  }

  // --- custos ---------------------------------------------------------------------------------

  async addCost(projectId: string, input: CreateCostEntryInput): Promise<ProjectCostEntryDto> {
    await this.projectOrFail(projectId);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.projectCostEntry.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId,
          category: input.category,
          description: input.description,
          actualCents: input.actualCents,
          estimatedCents: input.estimatedCents ?? null,
          supplier: input.supplier ?? null,
          documentId: input.documentId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'finance.cost_added',
          entity: 'ProjectCostEntry',
          entityId: created.id,
          after: { category: created.category, actualCents: created.actualCents },
        },
        tx,
      );
      return created;
    });
    await this.recalculateCommissions(projectId);
    return toCostDto(row);
  }

  async removeCost(projectId: string, costId: string): Promise<void> {
    await this.projectOrFail(projectId);
    const cost = await this.prisma.db.projectCostEntry.findFirst({
      where: { id: costId, projectId },
    });
    if (!cost) throw new NotFoundException('Custo não encontrado');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.projectCostEntry.delete({ where: { id: costId } });
      await this.audit.record(
        {
          action: 'finance.cost_removed',
          entity: 'ProjectCostEntry',
          entityId: costId,
          before: { description: cost.description, actualCents: cost.actualCents },
        },
        tx,
      );
    });
  }

  // --- crédito --------------------------------------------------------------------------------

  async createCredit(
    projectId: string,
    input: CreateCreditApplicationInput,
  ): Promise<CreditApplicationDto> {
    await this.projectOrFail(projectId);
    // Juros simples sobre o valor financiado, só como referência da simulação: a instituição é quem calcula.
    const totalCents =
      input.annualRatePct && input.termMonths
        ? Math.round(
            input.amountCents * (1 + (input.annualRatePct / 100) * (input.termMonths / 12)),
          )
        : null;
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.creditApplication.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId,
          institution: input.institution,
          amountCents: input.amountCents,
          annualRatePct: input.annualRatePct ?? null,
          termMonths: input.termMonths ?? null,
          totalCents,
          notes: input.notes ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'finance.credit_created',
          entity: 'CreditApplication',
          entityId: created.id,
          after: { institution: created.institution, amountCents: created.amountCents },
        },
        tx,
      );
      return created;
    });
    return toCreditDto(row);
  }

  async updateCreditStatus(
    projectId: string,
    creditId: string,
    input: UpdateCreditStatusInput,
  ): Promise<CreditApplicationDto> {
    const project = await this.projectOrFail(projectId);
    const credit = await this.prisma.db.creditApplication.findFirst({
      where: { id: creditId, projectId },
    });
    if (!credit) throw new NotFoundException('Pedido de crédito não encontrado');
    if (!CREDIT_TRANSITIONS[credit.status].includes(input.status))
      throw new UnprocessableEntityException({
        message: `Não é possível passar o crédito de ${credit.status} para ${input.status}`,
        code: 'INVALID_CREDIT_TRANSITION',
      });
    const answered = input.status === 'APPROVED' || input.status === 'REJECTED';
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.creditApplication.update({
        where: { id: creditId },
        data: {
          status: input.status,
          pendencies: input.pendencies ?? (credit.pendencies as string[]),
          notes: input.notes ?? credit.notes,
          appliedAt: input.status === 'SENT' ? (credit.appliedAt ?? new Date()) : credit.appliedAt,
          respondedAt: answered ? new Date() : credit.respondedAt,
        },
      });
      await this.timeline.record(
        {
          opportunityId: project.opportunityId,
          type: TimelineEventType.CREDIT_STATUS_CHANGED,
          summary: `Crédito (${credit.institution}): ${credit.status} → ${input.status}`,
          data: { creditId, from: credit.status, to: input.status },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'finance.credit_status_changed',
          entity: 'CreditApplication',
          entityId: creditId,
          before: { status: credit.status },
          after: { status: input.status },
        },
        tx,
      );
      return updated;
    });
    return toCreditDto(row);
  }

  // --- comissões ------------------------------------------------------------------------------

  async listPolicies(): Promise<CommissionPolicyDto[]> {
    const rows = await this.prisma.db.commissionPolicy.findMany({ orderBy: { validFrom: 'desc' } });
    return rows.map(toPolicyDto);
  }

  /** Nova política encerra a vigente na véspera. Sem política, nenhuma comissão é calculada. */
  async createPolicy(input: CreateCommissionPolicyInput): Promise<CommissionPolicyDto> {
    const from = dayStart(input.validFrom);
    const later = await this.prisma.db.commissionPolicy.findFirst({
      where: { validFrom: { gte: from } },
      select: { id: true },
    });
    if (later)
      throw new UnprocessableEntityException({
        message: 'A nova política precisa começar depois da vigente',
        code: 'POLICY_DATE_OVERLAP',
      });
    const current = await this.activePolicy(from);
    const row = await this.prisma.db.$transaction(async (tx) => {
      if (current)
        await tx.commissionPolicy.update({
          where: { id: current.id },
          data: { validTo: new Date(from.getTime() - DAY) },
        });
      const created = await tx.commissionPolicy.create({
        data: {
          tenantId: this.context.requireTenantId(),
          base: input.base,
          weights: input.weights,
          validFrom: from,
          notes: input.notes ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'finance.commission_policy_created',
          entity: 'CommissionPolicy',
          entityId: created.id,
          after: { base: input.base, validFrom: input.validFrom, weights: input.weights },
        },
        tx,
      );
      return created;
    });
    return toPolicyDto(row);
  }

  private async activePolicy(at: Date = new Date()): Promise<CommissionPolicy | null> {
    return this.prisma.db.commissionPolicy.findFirst({
      where: { validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gte: at } }] },
      orderBy: { validFrom: 'desc' },
    });
  }

  /**
   * Recalcula as comissões do projeto pela política vigente. O que já foi pago não é mexido: se o valor devido
   * cresceu, a diferença vira uma linha nova em aberto; se encolheu, só a parte em aberto diminui.
   */
  async recalculateCommissions(projectId: string): Promise<CommissionDto[]> {
    const project = await this.projectOrFail(projectId);
    const policy = await this.activePolicy();
    if (!policy) return this.listCommissions(projectId);

    const baseCents =
      policy.base === 'SIGNED'
        ? project.valueCents
        : ((
            await this.prisma.db.receivable.aggregate({
              where: { projectId, status: 'PAID' },
              _sum: { amountCents: true },
            })
          )._sum.amountCents ?? 0);
    const weights = (policy.weights ?? {}) as Record<string, number>;

    const opportunity = await this.prisma.db.opportunity.findFirst({
      where: { id: project.opportunityId },
      select: { ownerId: true },
    });
    const userIds = [
      ...new Set([opportunity?.ownerId, project.responsibleId].filter(Boolean)),
    ] as string[];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: userIds }, isActive: true, deletedAt: null },
      select: { id: true, role: true },
    });

    for (const user of users) {
      const pct = weights[user.id] ?? weights[user.role];
      if (pct === undefined) continue;
      const due = Math.round((baseCents * pct) / 100);
      const rows = await this.prisma.db.commission.findMany({
        where: { projectId, policyId: policy.id, userId: user.id },
      });
      const paid = rows.filter((r) => r.paidAt).reduce((sum, r) => sum + r.amountCents, 0);
      const open = rows.find((r) => !r.paidAt);
      const target = due - paid;
      if (target <= 0) {
        if (open) await this.prisma.db.commission.delete({ where: { id: open.id } });
      } else if (open) {
        if (open.amountCents !== target)
          await this.prisma.db.commission.update({
            where: { id: open.id },
            data: { amountCents: target, calculatedAt: new Date() },
          });
      } else {
        await this.prisma.db.commission.create({
          data: {
            tenantId: this.context.requireTenantId(),
            policyId: policy.id,
            userId: user.id,
            projectId,
            amountCents: target,
            calculatedAt: new Date(),
          },
        });
      }
    }
    return this.listCommissions(projectId);
  }

  async listCommissions(projectId: string): Promise<CommissionDto[]> {
    const rows = await this.prisma.db.commission.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((row) =>
      toCommissionDto(row, row.userId ? (names.get(row.userId) ?? null) : null),
    );
  }

  async markCommissionPaid(
    projectId: string,
    commissionId: string,
    input: MarkCommissionPaidInput,
  ): Promise<CommissionDto> {
    await this.projectOrFail(projectId);
    const commission = await this.prisma.db.commission.findFirst({
      where: { id: commissionId, projectId },
    });
    if (!commission) throw new NotFoundException('Comissão não encontrada');
    if (commission.paidAt)
      throw new UnprocessableEntityException({
        message: 'Esta comissão já foi paga',
        code: 'COMMISSION_PAID',
      });
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.commission.update({
        where: { id: commissionId },
        data: { paidAt: input.paidOn ? dayStart(input.paidOn) : new Date() },
      });
      await this.audit.record(
        {
          action: 'finance.commission_paid',
          entity: 'Commission',
          entityId: commissionId,
          after: { amountCents: updated.amountCents },
        },
        tx,
      );
      return updated;
    });
    const user = row.userId
      ? await this.prisma.db.user.findFirst({ where: { id: row.userId }, select: { name: true } })
      : null;
    return toCommissionDto(row, user?.name ?? null);
  }

  // --- resumo ---------------------------------------------------------------------------------

  async summary(projectId: string): Promise<ProjectFinancialSummaryDto> {
    const project = await this.projectOrFail(projectId);
    const [receivables, costs, credits, commissions] = await Promise.all([
      this.prisma.db.receivable.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
      this.prisma.db.projectCostEntry.findMany({
        where: { projectId },
        orderBy: { recordedAt: 'desc' },
      }),
      this.prisma.db.creditApplication.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      }),
      this.listCommissions(projectId),
    ]);

    const dtos = receivables.map((row) => toReceivableDto(row));
    const sum = (list: ReceivableDto[]) => list.reduce((acc, r) => acc + r.amountCents, 0);
    const paid = dtos.filter((r) => r.status === 'PAID');
    const overdue = dtos.filter((r) => r.status === 'OVERDUE');
    const open = dtos.filter((r) => r.status === 'OPEN' || r.status === 'OVERDUE');

    const totalReceivedCents = sum(paid);
    const totalCostsCents = costs.reduce((acc, c) => acc + c.actualCents, 0);
    const withEstimate = costs.filter((c) => c.estimatedCents !== null);
    const totalEstimatedCostsCents = withEstimate.reduce(
      (acc, c) => acc + (c.estimatedCents ?? 0),
      0,
    );
    const actualWithEstimate = withEstimate.reduce((acc, c) => acc + c.actualCents, 0);
    const totalCommissionsCents = commissions.reduce((acc, c) => acc + c.amountCents, 0);
    const marginCents = totalReceivedCents - totalCostsCents - totalCommissionsCents;

    return {
      projectId,
      valueCents: project.valueCents,
      totalReceivedCents,
      totalOpenCents: sum(open),
      totalOverdueCents: sum(overdue),
      totalCostsCents,
      totalEstimatedCostsCents,
      totalCommissionsCents,
      marginCents,
      marginPct: totalReceivedCents > 0 ? (marginCents / totalReceivedCents) * 100 : null,
      costDeviationPct:
        totalEstimatedCostsCents > 0
          ? ((actualWithEstimate - totalEstimatedCostsCents) / totalEstimatedCostsCents) * 100
          : null,
      receivablesCount: dtos.filter((r) => r.status !== 'CANCELLED').length,
      receivablesPaidCount: paid.length,
      overdueCount: overdue.length,
      receivables: dtos,
      costEntries: costs.map(toCostDto),
      creditApplications: credits.map(toCreditDto),
      commissions,
    };
  }

  /** Visão da empresa: a receber, vencido, recebido no mês e comissões pendentes. */
  async overview(): Promise<FinanceOverviewDto> {
    const now = new Date();
    const today = todayStart(now);
    const since = new Date(now.getTime() - 30 * DAY);
    const [open, received, pending, overdueRows] = await Promise.all([
      this.prisma.db.receivable.findMany({
        where: { status: { in: ['OPEN', 'OVERDUE'] } },
        select: { amountCents: true, dueAt: true },
      }),
      this.prisma.db.receivable.aggregate({
        where: { status: 'PAID', paidAt: { gte: since } },
        _sum: { amountCents: true },
      }),
      this.prisma.db.commission.aggregate({
        where: { paidAt: null },
        _sum: { amountCents: true },
      }),
      this.prisma.db.receivable.findMany({
        where: { status: { in: ['OPEN', 'OVERDUE'] }, dueAt: { lt: today } },
        orderBy: { dueAt: 'asc' },
        take: 50,
        include: { project: { select: { projectCode: true, accountId: true } } },
      }),
    ]);
    const accountIds = [...new Set(overdueRows.map((r) => r.project.accountId))];
    const accounts = await this.prisma.db.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, name: true },
    });
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const overdueTotal = open
      .filter((r) => r.dueAt.getTime() < today.getTime())
      .reduce((sum, r) => sum + r.amountCents, 0);
    return {
      totalOpenCents: open.reduce((sum, r) => sum + r.amountCents, 0),
      totalOverdueCents: overdueTotal,
      receivedLast30DaysCents: received._sum.amountCents ?? 0,
      commissionsPendingCents: pending._sum.amountCents ?? 0,
      overdue: overdueRows.map((row) => ({
        ...toReceivableDto(row, now),
        projectCode: row.project.projectCode,
        accountName: names.get(row.project.accountId) ?? null,
      })),
    };
  }
}
