import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ApprovalRequest, MarginPolicy, Opportunity, Quote } from '@voltex/database';
import {
  DomainEvent,
  MarginStatus,
  TimelineEventType,
  type ApprovalDto,
  type DecideApprovalInput,
  type ListApprovalsQuery,
  type QuoteDto,
  type RequestApprovalInput,
} from '@voltex/shared';
import {
  calculateMargin,
  marginStatus,
  minimumPriceForMargin,
  quoteCostsSchema,
  type MarginBreakdown,
  type QuoteCosts,
  type QuoteItem,
  type SaveQuoteData,
  type UpdateQuoteData,
} from '@voltex/solar-engine';
import { RequestContext } from '../../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../../common/pagination';
import { AuditService } from '../../../platform/audit/audit.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { OpportunitiesService } from '../opportunities.service';
import { TimelineService } from '../support/timeline.service';
import { UserDirectory } from '../support/user-directory.service';
import { MarginPoliciesService } from './margin-policies.service';

const pct = (rate: number) => `${(rate * 100).toFixed(1).replace('.', ',')}%`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly timeline: TimelineService,
    private readonly users: UserDirectory,
    private readonly opportunities: OpportunitiesService,
    private readonly policies: MarginPoliciesService,
  ) {}

  // ---- Consulta ----

  async list(opportunityId: string): Promise<QuoteDto[]> {
    const opportunity = await this.opportunities.findOrThrow(opportunityId);
    const rows = await this.prisma.db.quote.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { version: 'desc' },
    });
    const policy = await this.policies.resolveFor(opportunity);
    return rows.map((row) => this.toDto(row, policy));
  }

  async get(id: string): Promise<QuoteDto> {
    const { quote, opportunity } = await this.findWithOpportunity(id);
    return this.toDto(quote, await this.policies.resolveFor(opportunity));
  }

  /** Cotação liberada para entrar numa proposta (margem na política ou aprovada). */
  async assertReleased(quote: Quote, opportunity: Opportunity): Promise<QuoteDto> {
    const dto = this.toDto(quote, await this.policies.resolveFor(opportunity));
    if (!dto.releasedForProposal)
      throw new UnprocessableEntityException({
        message:
          dto.marginStatus === 'NO_POLICY'
            ? `A cotação v${dto.version} não pode seguir: a empresa ainda não definiu a margem mínima (Administração → Margens).`
            : `A cotação v${dto.version} está com margem abaixo do mínimo e sem aprovação.`,
        code: 'MARGIN_NOT_RELEASED',
        data: {
          quoteId: dto.id,
          marginStatus: dto.marginStatus,
          approvalStatus: dto.approvalStatus,
        },
      });
    return dto;
  }

  // ---- Criação e edição ----

  async create(opportunityId: string, data: SaveQuoteData): Promise<QuoteDto> {
    const opportunity = await this.opportunities.findOrThrow(opportunityId);
    if (opportunity.status !== 'OPEN')
      throw new ConflictException('Oportunidade encerrada não recebe cotações');
    const calculationSessionId = await this.resolveCalculation(
      opportunityId,
      data.calculationSessionId,
    );

    const policy = await this.policies.resolveFor(opportunity);
    const margin = calculateMargin({
      priceCents: data.priceCents,
      items: data.items,
      costs: data.costs,
    });
    const status = marginStatus(margin.marginRate, policy?.minMarginRate ?? null);

    const row = await this.prisma.db.$transaction(async (tx) => {
      const last = await tx.quote.findFirst({
        where: { opportunityId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.quote.create({
        data: {
          tenantId: this.context.requireTenantId(),
          opportunityId,
          version: (last?.version ?? 0) + 1,
          title: data.title ?? null,
          calculationSessionId,
          items: data.items as object,
          costs: data.costs as object,
          priceCents: data.priceCents,
          margin: margin as unknown as object,
          marginStatus: status,
          minMarginRate: policy?.minMarginRate ?? null,
          policyId: policy?.id ?? null,
          createdById: this.context.userId ?? null,
        },
      });
      await this.timeline.record(
        {
          opportunityId,
          type: TimelineEventType.QUOTE_CREATED,
          summary: `Cotação v${created.version} criada: margem ${pct(margin.marginRate)}${this.statusSuffix(status, policy)}`,
          data: { quoteId: created.id, version: created.version, marginRate: margin.marginRate },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'quote.created',
          entity: 'Quote',
          entityId: created.id,
          after: {
            opportunityId,
            version: created.version,
            priceCents: data.priceCents,
            marginRate: margin.marginRate,
            marginStatus: status,
          },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.QUOTE_CREATED,
          projectCode: opportunity.projectCode,
          payload: {
            opportunityId,
            quoteId: created.id,
            version: created.version,
            marginRate: margin.marginRate,
          },
        },
        tx,
      );
      if (status === MarginStatus.BELOW_POLICY)
        await this.publishViolation(tx, opportunity, created.id, margin, policy);
      return created;
    });
    return this.toDto(row, policy);
  }

  async update(id: string, data: UpdateQuoteData): Promise<QuoteDto> {
    const { quote, opportunity } = await this.findWithOpportunity(id);
    if (quote.lockedAt)
      throw new ConflictException({
        message:
          'Esta cotação já foi usada em uma proposta e não pode mais ser editada: crie uma nova versão.',
        code: 'QUOTE_LOCKED',
      });
    if (opportunity.status !== 'OPEN')
      throw new ConflictException('Oportunidade encerrada não pode ser alterada');

    const items = (data.items ?? quote.items) as unknown as QuoteItem[];
    const costs = quoteCostsSchema.parse({
      ...(quote.costs as object),
      ...(data.costs ?? {}),
    }) as QuoteCosts;
    const priceCents = data.priceCents ?? quote.priceCents;
    const calculationSessionId =
      data.calculationSessionId === undefined
        ? quote.calculationSessionId
        : data.calculationSessionId === null
          ? null
          : await this.resolveCalculation(opportunity.id, data.calculationSessionId);

    const numbersChanged =
      !sameJson(items, quote.items) ||
      !sameJson(costs, quote.costs) ||
      priceCents !== quote.priceCents;
    const policy = await this.policies.resolveFor(opportunity);
    const margin = calculateMargin({ priceCents, items, costs });
    const status = marginStatus(margin.marginRate, policy?.minMarginRate ?? null);

    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          calculationSessionId,
          items: items as object,
          costs: costs as object,
          priceCents,
          margin: margin as unknown as object,
          marginStatus: status,
          minMarginRate: policy?.minMarginRate ?? null,
          policyId: policy?.id ?? null,
          // Qualquer mudança de números derruba a aprovação: ela valia para o que foi pedido.
          ...(numbersChanged ? { approvalStatus: 'NONE' as const } : {}),
        },
      });
      if (numbersChanged) {
        await tx.approvalRequest.updateMany({
          where: { quoteId: id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            decidedAt: new Date(),
            decisionJustification: 'Cotação alterada: o pedido perdeu a validade.',
          },
        });
        await this.timeline.record(
          {
            opportunityId: opportunity.id,
            type: TimelineEventType.QUOTE_CREATED,
            summary: `Cotação v${updated.version} atualizada: margem ${pct(margin.marginRate)}${this.statusSuffix(status, policy)}`,
            data: { quoteId: id, version: updated.version, marginRate: margin.marginRate },
          },
          tx,
        );
        await this.events.publish(
          {
            type: DomainEvent.QUOTE_CHANGED,
            projectCode: opportunity.projectCode,
            payload: {
              opportunityId: opportunity.id,
              quoteId: id,
              version: updated.version,
              marginRate: margin.marginRate,
            },
          },
          tx,
        );
        if (status === MarginStatus.BELOW_POLICY)
          await this.publishViolation(tx, opportunity, id, margin, policy);
      }
      await this.audit.record(
        {
          action: 'quote.updated',
          entity: 'Quote',
          entityId: id,
          before: { priceCents: quote.priceCents, approvalStatus: quote.approvalStatus },
          after: {
            priceCents,
            marginRate: margin.marginRate,
            marginStatus: status,
            approvalReset: numbersChanged,
          },
        },
        tx,
      );
      return updated;
    });
    return this.toDto(row, policy);
  }

  async remove(id: string) {
    const { quote } = await this.findWithOpportunity(id);
    if (quote.lockedAt)
      throw new ConflictException({
        message: 'Cotação usada em proposta não pode ser excluída.',
        code: 'QUOTE_LOCKED',
      });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.quote.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.approvalRequest.updateMany({
        where: { quoteId: id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decisionJustification: 'Cotação excluída.',
        },
      });
      await this.audit.record(
        {
          action: 'quote.deleted',
          entity: 'Quote',
          entityId: id,
          before: { version: quote.version },
        },
        tx,
      );
    });
    return { id };
  }

  // ---- Aprovação de margem (RF-CRM-053) ----

  async requestApproval(id: string, input: RequestApprovalInput): Promise<QuoteDto> {
    const { quote, opportunity } = await this.findWithOpportunity(id);
    if (quote.lockedAt)
      throw new ConflictException({
        message: 'Cotação já usada em proposta.',
        code: 'QUOTE_LOCKED',
      });
    const policy = await this.policies.resolveFor(opportunity);
    const dto = this.toDto(quote, policy);
    if (dto.marginStatus === MarginStatus.NO_POLICY)
      throw new UnprocessableEntityException(
        'Defina a margem mínima da empresa antes de pedir aprovação (Administração → Margens).',
      );
    if (dto.marginStatus === MarginStatus.WITHIN_POLICY)
      throw new ConflictException('A margem já está dentro da política: não precisa de aprovação.');
    if (quote.approvalStatus === 'PENDING')
      throw new ConflictException('Já existe um pedido de aprovação pendente.');
    if (quote.approvalStatus === 'APPROVED')
      throw new ConflictException('Esta cotação já foi aprovada.');

    const row = await this.prisma.db.$transaction(async (tx) => {
      const request = await tx.approvalRequest.create({
        data: {
          tenantId: this.context.requireTenantId(),
          quoteId: id,
          opportunityId: opportunity.id,
          marginRate: dto.margin.marginRate,
          minMarginRate: dto.minMarginRate as number,
          priceCents: quote.priceCents,
          justification: input.justification,
          requestedById: this.context.userId ?? null,
        },
      });
      const updated = await tx.quote.update({ where: { id }, data: { approvalStatus: 'PENDING' } });
      await this.timeline.record(
        {
          opportunityId: opportunity.id,
          type: TimelineEventType.MARGIN_APPROVAL_REQUESTED,
          summary: `Aprovação de margem solicitada (v${quote.version}, ${pct(dto.margin.marginRate)} contra mínimo de ${pct(dto.minMarginRate as number)}): ${input.justification}`,
          data: { quoteId: id, approvalId: request.id },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'approval.requested',
          entity: 'ApprovalRequest',
          entityId: request.id,
          after: { quoteId: id, marginRate: dto.margin.marginRate },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.MARGIN_APPROVAL_REQUESTED,
          projectCode: opportunity.projectCode,
          payload: { opportunityId: opportunity.id, quoteId: id, approvalId: request.id },
        },
        tx,
      );
      return updated;
    });
    return this.toDto(row, policy);
  }

  async listApprovals(query: ListApprovalsQuery) {
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.db.approvalRequest.findMany({
        where,
        include: {
          quote: { select: { version: true } },
          opportunity: {
            select: { title: true, projectCode: true, account: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.approvalRequest.count({ where }),
    ]);
    const names = await this.users.names(rows.flatMap((r) => [r.requestedById, r.decidedById]));
    return toPaginated(
      rows.map((r) => this.toApprovalDto(r, names)),
      total,
      query,
    );
  }

  async decide(id: string, input: DecideApprovalInput): Promise<ApprovalDto> {
    const request = await this.prisma.db.approvalRequest.findFirst({
      where: { id },
      include: {
        quote: { select: { version: true } },
        opportunity: {
          select: { title: true, projectCode: true, account: { select: { name: true } } },
        },
      },
    });
    if (!request) throw new NotFoundException('Pedido de aprovação não encontrado');
    if (request.status !== 'PENDING') throw new ConflictException('Este pedido já foi decidido.');
    // Segregação de funções: quem pediu não aprova o próprio pedido (exceto o proprietário da empresa).
    if (
      request.requestedById &&
      request.requestedById === this.context.userId &&
      this.context.role !== 'OWNER'
    )
      throw new ForbiddenException('Quem pediu a aprovação não pode decidir o próprio pedido.');

    const row = await this.prisma.db.$transaction(async (tx) => {
      const decided = await tx.approvalRequest.update({
        where: { id },
        data: {
          status: input.approve ? 'APPROVED' : 'REJECTED',
          decidedById: this.context.userId ?? null,
          decidedAt: new Date(),
          decisionJustification: input.justification,
        },
        include: {
          quote: { select: { version: true } },
          opportunity: {
            select: { title: true, projectCode: true, account: { select: { name: true } } },
          },
        },
      });
      await tx.quote.update({
        where: { id: request.quoteId },
        data: { approvalStatus: input.approve ? 'APPROVED' : 'REJECTED' },
      });
      await this.timeline.record(
        {
          opportunityId: request.opportunityId,
          type: TimelineEventType.MARGIN_APPROVAL_DECIDED,
          summary: `Margem da cotação v${request.quote.version} ${input.approve ? 'aprovada' : 'recusada'}: ${input.justification}`,
          data: { quoteId: request.quoteId, approvalId: id, approved: input.approve },
        },
        tx,
      );
      await this.audit.record(
        {
          action: input.approve ? 'approval.approved' : 'approval.rejected',
          entity: 'ApprovalRequest',
          entityId: id,
          after: { quoteId: request.quoteId, justification: input.justification },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.MARGIN_APPROVAL_DECIDED,
          projectCode: request.opportunity.projectCode,
          payload: {
            opportunityId: request.opportunityId,
            quoteId: request.quoteId,
            approvalId: id,
            approved: input.approve,
          },
        },
        tx,
      );
      return decided;
    });
    const names = await this.users.names([row.requestedById, row.decidedById]);
    return this.toApprovalDto(row, names);
  }

  // ---- Internos ----

  private statusSuffix(status: MarginStatus, policy: MarginPolicy | null): string {
    if (status === MarginStatus.BELOW_POLICY)
      return ` (abaixo do mínimo de ${pct(policy?.minMarginRate ?? 0)})`;
    if (status === MarginStatus.NO_POLICY) return ' (sem política de margem definida)';
    return '';
  }

  private async publishViolation(
    tx: Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0],
    opportunity: Opportunity,
    quoteId: string,
    margin: MarginBreakdown,
    policy: MarginPolicy | null,
  ) {
    await this.events.publish(
      {
        type: DomainEvent.MARGIN_THRESHOLD_VIOLATED,
        projectCode: opportunity.projectCode,
        payload: {
          opportunityId: opportunity.id,
          quoteId,
          marginRate: margin.marginRate,
          minMarginRate: policy?.minMarginRate ?? null,
        },
      },
      tx,
    );
  }

  private async resolveCalculation(
    opportunityId: string,
    requested?: string,
  ): Promise<string | null> {
    if (requested) {
      const session = await this.prisma.db.calculationSession.findFirst({
        where: { id: requested, opportunityId, deletedAt: null },
        select: { id: true },
      });
      if (!session)
        throw new UnprocessableEntityException(
          'O cálculo informado não está vinculado a esta oportunidade',
        );
      return session.id;
    }
    const latest = await this.prisma.db.calculationSession.findFirst({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return latest?.id ?? null;
  }

  private async findWithOpportunity(id: string) {
    const quote = await this.prisma.db.quote.findFirst({ where: { id, deletedAt: null } });
    if (!quote) throw new NotFoundException('Cotação não encontrada');
    const opportunity = await this.opportunities.findOrThrow(quote.opportunityId);
    return { quote, opportunity };
  }

  /** A margem e a situação mostradas usam a política de HOJE; o valor gravado fica no registro. */
  toDto(row: Quote, policy: MarginPolicy | null): QuoteDto {
    const items = row.items as unknown as QuoteItem[];
    const costs = quoteCostsSchema.parse(row.costs) as QuoteCosts;
    const margin = calculateMargin({ priceCents: row.priceCents, items, costs });
    const minMarginRate = policy?.minMarginRate ?? null;
    const status = marginStatus(margin.marginRate, minMarginRate);
    const approvalStatus = row.approvalStatus;
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      version: row.version,
      title: row.title,
      calculationSessionId: row.calculationSessionId,
      items,
      costs,
      priceCents: row.priceCents,
      margin: {
        materialsCents: margin.materialsCents,
        directCostsCents: margin.directCostsCents,
        contingencyCents: margin.contingencyCents,
        commissionCents: margin.commissionCents,
        taxesCents: margin.taxesCents,
        financingCents: margin.financingCents,
        totalCostsCents: margin.totalCostsCents,
        contributionMarginCents: margin.contributionMarginCents,
        marginRate: margin.marginRate,
        markupRate: margin.markupRate,
      },
      marginStatus: status,
      minMarginRate,
      policyId: policy?.id ?? null,
      minPriceCents:
        minMarginRate === null ? null : minimumPriceForMargin(items, costs, minMarginRate),
      approvalStatus,
      releasedForProposal:
        status === MarginStatus.WITHIN_POLICY ||
        (status === MarginStatus.BELOW_POLICY && approvalStatus === 'APPROVED'),
      locked: row.lockedAt !== null,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toApprovalDto(
    row: ApprovalRequest & {
      quote: { version: number };
      opportunity: { title: string; projectCode: string; account: { name: string } };
    },
    names: Map<string, string>,
  ): ApprovalDto {
    return {
      id: row.id,
      type: 'MARGIN',
      status: row.status,
      quoteId: row.quoteId,
      quoteVersion: row.quote.version,
      opportunityId: row.opportunityId,
      opportunityTitle: row.opportunity.title,
      projectCode: row.opportunity.projectCode,
      accountName: row.opportunity.account.name,
      marginRate: row.marginRate,
      minMarginRate: row.minMarginRate,
      priceCents: row.priceCents,
      justification: row.justification,
      requestedById: row.requestedById,
      requestedByName: row.requestedById ? (names.get(row.requestedById) ?? null) : null,
      decisionJustification: row.decisionJustification,
      decidedById: row.decidedById,
      decidedByName: row.decidedById ? (names.get(row.decidedById) ?? null) : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
