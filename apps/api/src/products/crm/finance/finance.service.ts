import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Commission, CreditApplication, ProjectCostEntry, Receivable } from '@voltex/database';
import type {
  CreateCreditApplicationInput,
  CreateReceivableInput,
  ProjectFinancialSummaryDto,
  ReceivableDto,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];

const toReceivableDto = (r: Receivable): ReceivableDto => ({
  id: r.id,
  projectId: r.projectId,
  referenceId: r.referenceId,
  order: r.order,
  amountCents: r.amountCents,
  dueAt: r.dueAt.toISOString(),
  paidAt: r.paidAt?.toISOString() ?? null,
  paymentMethod: r.paymentMethod ?? null,
  status: r.status as 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED',
  notes: r.notes ?? null,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Financeiro por projeto (Fase 11G): recebíveis, custos, comissões, crédito.
 * Tudo manual — sem gateway de pagamento, tudo registrado pela empresa.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  // --- recebíveis ---------------------------------------------------------------

  async createReceivable(projectId: string, input: CreateReceivableInput): Promise<ReceivableDto> {
    const tenantId = this.context.requireTenantId();

    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, tenantId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const receivable = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.receivable.create({
        data: {
          tenantId,
          projectId,
          opportunityId: project.opportunityId,
          referenceId: input.referenceId,
          order: input.order,
          amountCents: input.amountCents,
          dueAt: new Date(input.dueAt),
        },
      });

      await this.audit.record(
        {
          action: 'receivable.created',
          entity: 'Receivable',
          entityId: created.id,
          after: {
            referenceId: created.referenceId,
            amountCents: created.amountCents,
            dueAt: created.dueAt.toISOString(),
          },
        },
        tx,
      );

      return created;
    });

    return toReceivableDto(receivable);
  }

  async listReceivables(projectId: string): Promise<ReceivableDto[]> {
    const tenantId = this.context.requireTenantId();

    const receivables = await this.prisma.db.receivable.findMany({
      where: { projectId, tenantId },
      orderBy: { order: 'asc' },
    });

    return receivables.map(toReceivableDto);
  }

  async markAsPaid(
    projectId: string,
    receivableId: string,
    paymentMethod: string,
  ): Promise<ReceivableDto> {
    const tenantId = this.context.requireTenantId();

    const receivable = await this.prisma.db.receivable.findFirst({
      where: { id: receivableId, projectId, tenantId },
    });
    if (!receivable) throw new NotFoundException('Recebível não encontrado');

    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.receivable.update({
        where: { id: receivableId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentMethod,
        },
      });

      await this.audit.record(
        {
          action: 'receivable.paid',
          entity: 'Receivable',
          entityId: receivableId,
          after: {
            status: 'PAID',
            paidAt: new Date().toISOString(),
          },
        },
        tx,
      );

      return result;
    });

    return toReceivableDto(updated);
  }

  // --- custos -------------------------------------------------------------------

  async recordCost(
    projectId: string,
    input: {
      category: string;
      description: string;
      actualCents: number;
      estimatedCents?: number;
      supplier?: string;
    },
  ): Promise<ProjectCostEntry> {
    const tenantId = this.context.requireTenantId();

    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, tenantId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    return await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.projectCostEntry.create({
        data: {
          tenantId,
          projectId,
          ...input,
        },
      });

      await this.audit.record(
        {
          action: 'cost_entry.created',
          entity: 'ProjectCostEntry',
          entityId: created.id,
          after: {
            category: created.category,
            actualCents: created.actualCents,
          },
        },
        tx,
      );

      return created;
    });
  }

  // --- resumo financeiro -------------------------------------------------------

  async getFinancialSummary(projectId: string): Promise<ProjectFinancialSummaryDto> {
    const tenantId = this.context.requireTenantId();

    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, tenantId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const receivables = await this.prisma.db.receivable.findMany({
      where: { projectId, tenantId },
      orderBy: { order: 'asc' },
    });

    const costEntries = await this.prisma.db.projectCostEntry.findMany({
      where: { projectId, tenantId },
      orderBy: { recordedAt: 'desc' },
    });

    const commissions = await this.prisma.db.commission.findMany({
      where: { projectId, tenantId },
    });

    const totalReceivedCents = receivables
      .filter((r) => r.status === 'PAID')
      .reduce((sum, r) => sum + r.amountCents, 0);

    const totalCostsCents = costEntries.reduce((sum, c) => sum + c.actualCents, 0);
    const totalCommissionsCents = commissions.reduce((sum, c) => sum + c.amountCents, 0);

    const marginCents = totalReceivedCents - totalCostsCents - totalCommissionsCents;
    const marginPct = project.valueCents > 0 ? (marginCents / project.valueCents) * 100 : 0;

    return {
      projectId,
      valueCents: project.valueCents,
      totalReceivedCents,
      totalCostsCents,
      totalCommissionsCents,
      marginCents,
      marginPct,
      receivablesCount: receivables.length,
      receivablesPaidCount: receivables.filter((r) => r.status === 'PAID').length,
      overdueCount: receivables.filter((r) => r.status === 'OVERDUE').length,
      receivables: receivables.map(toReceivableDto),
      costEntries: costEntries.map((c) => ({
        id: c.id,
        category: c.category,
        description: c.description,
        estimatedCents: c.estimatedCents,
        actualCents: c.actualCents,
        supplier: c.supplier ?? null,
        recordedAt: c.recordedAt.toISOString(),
      })),
    };
  }

  // --- crédito ------------------------------------------------------------------

  async createCreditApplication(
    projectId: string,
    input: CreateCreditApplicationInput,
  ): Promise<CreditApplication> {
    const tenantId = this.context.requireTenantId();

    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, tenantId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    return await this.prisma.db.$transaction(async (tx) => {
      const totalCents =
        input.termMonths && input.annualRatePct
          ? Math.round(
              input.amountCents * (1 + (input.annualRatePct / 100) * (input.termMonths / 12)),
            )
          : null;

      const created = await tx.creditApplication.create({
        data: {
          tenantId,
          projectId,
          institution: input.institution,
          amountCents: input.amountCents,
          annualRatePct: input.annualRatePct ?? null,
          termMonths: input.termMonths ?? null,
          totalCents,
        },
      });

      await this.audit.record(
        {
          action: 'credit_application.created',
          entity: 'CreditApplication',
          entityId: created.id,
          after: {
            institution: created.institution,
            amountCents: created.amountCents,
            status: 'SIMULATED',
          },
        },
        tx,
      );

      return created;
    });
  }

  async updateCreditApplicationStatus(
    projectId: string,
    creditId: string,
    status: 'SENT' | 'PENDING' | 'APPROVED' | 'REJECTED',
    pendencies?: string[],
  ): Promise<CreditApplication> {
    const tenantId = this.context.requireTenantId();

    const credit = await this.prisma.db.creditApplication.findFirst({
      where: { id: creditId, projectId, tenantId },
    });
    if (!credit) throw new NotFoundException('Aplicação de crédito não encontrada');

    return await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.creditApplication.update({
        where: { id: creditId },
        data: {
          status,
          pendencies: pendencies ? JSON.stringify(pendencies) : undefined,
          respondedAt: ['APPROVED', 'REJECTED'].includes(status) ? new Date() : undefined,
        },
      });

      await this.audit.record(
        {
          action: 'credit_application.status_updated',
          entity: 'CreditApplication',
          entityId: creditId,
          after: { status },
        },
        tx,
      );

      return updated;
    });
  }
}
