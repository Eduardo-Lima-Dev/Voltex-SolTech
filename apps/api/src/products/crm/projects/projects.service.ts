import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Contract, Opportunity, Project, ProjectChecklistItem } from '@voltex/database';
import {
  ChecklistItemStatus,
  DomainEvent,
  ProjectStatus,
  Role,
  TimelineEventType,
  applicableChecklistItems,
  type ChangeProjectStatusInput,
  type ChecklistDeadline,
  type GenerationClass,
  type HomologationRules,
  type ListProjectsQuery,
  type ProjectChecklistItemDto,
  type ProjectDeadlineSuggestionDto,
  type ProjectDto,
  type ProjectSummaryDto,
  type UpdateChecklistItemInput,
  type UpdateProjectInput,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../../common/pagination';
import { AuditService } from '../../../platform/audit/audit.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { TimelineService } from '../support/timeline.service';
import { UserDirectory } from '../support/user-directory.service';
import { HomologationRulesService } from './homologation-rules.service';

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];
type Row = Project & { checklist: ProjectChecklistItem[] };

const DAY = 86_400_000;
const TECHNICAL_ROLES: readonly string[] = [Role.TECHNICAL_LEAD, Role.ENGINEERING];

/** Avanços e retornos permitidos da homologação (EF-R03: acesso → parecer → vistoria → aprovação). */
const TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DOCUMENTATION: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['DOCUMENTATION', 'INSPECTION', 'CANCELLED'],
  INSPECTION: ['DOCUMENTATION', 'APPROVED', 'CANCELLED'],
  APPROVED: [],
  CANCELLED: [],
};

const STATUS_NAME: Record<ProjectStatus, string> = {
  DOCUMENTATION: 'Reunindo documentos',
  SUBMITTED: 'Solicitação protocolada',
  INSPECTION: 'Vistoria',
  APPROVED: 'Homologado',
  CANCELLED: 'Cancelado',
};

const requiredPending = (items: readonly ProjectChecklistItem[]) =>
  items.filter((i) => i.required && i.status === 'PENDING');

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly timeline: TimelineService,
    private readonly users: UserDirectory,
    private readonly rules: HomologationRulesService,
  ) {}

  // ---- Criação (chamada pela assinatura do contrato, na mesma transação) ----

  async createFromContract(
    tx: Tx,
    contract: Contract,
    opportunity: Opportunity,
    generationClass: GenerationClass | null,
  ): Promise<Project> {
    const unit = opportunity.consumerUnitId
      ? await tx.consumerUnit.findFirst({
          where: { id: opportunity.consumerUnitId },
          select: { distributorId: true },
        })
      : null;
    const distributorId = unit?.distributorId ?? null;
    const rules = await this.rules.resolve(distributorId);
    const tenantId = this.context.requireTenantId();

    const project = await tx.project.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        projectCode: opportunity.projectCode,
        accountId: opportunity.accountId,
        siteId: opportunity.siteId,
        consumerUnitId: opportunity.consumerUnitId,
        distributorId,
        contractId: contract.id,
        valueCents: contract.valueCents,
        generationClass,
        rulesRef: rules.ref,
        rulesScope: rules.scope,
        rulesSource: rules.source,
        rulesReviewedBy: rules.reviewedBy,
        rulesNotes: rules.notes,
        rulesDeadlines: rules.deadlines as object,
        checklist: { create: this.materialize(tenantId, rules, generationClass) },
      },
    });
    await this.timeline.record(
      {
        opportunityId: opportunity.id,
        type: TimelineEventType.PROJECT_CREATED,
        summary: `Projeto criado (${opportunity.projectCode}) com o checklist de homologação ${rules.ref}`,
        data: { projectId: project.id, rules: rules.ref },
      },
      tx,
    );
    await this.audit.record(
      {
        action: 'project.created',
        entity: 'Project',
        entityId: project.id,
        after: { projectCode: project.projectCode, contractId: contract.id, rules: rules.ref },
      },
      tx,
    );
    await this.events.publish(
      {
        type: DomainEvent.PROJECT_CREATED,
        projectCode: opportunity.projectCode,
        payload: { opportunityId: opportunity.id, projectId: project.id, contractId: contract.id },
      },
      tx,
    );
    // Primeira tarefa do projeto (EF-R05: reunir a documentação). Idempotente pela chave de automação.
    await tx.task.create({
      data: {
        tenantId,
        title: 'Iniciar a homologação: reunir os documentos do checklist',
        dueAt: new Date(Date.now() + 3 * DAY),
        assigneeId: opportunity.ownerId,
        opportunityId: opportunity.id,
        origin: 'automation:contract-signed',
        automationKey: `project-start:${project.id}`,
      },
    });
    return project;
  }

  // ---- Consulta ----

  async list(query: ListProjectsQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.responsibleId ? { responsibleId: query.responsibleId } : {}),
      ...(query.search
        ? {
            OR: [
              { projectCode: { contains: query.search, mode: 'insensitive' as const } },
              { opportunity: { title: { contains: query.search, mode: 'insensitive' as const } } },
              {
                opportunity: {
                  account: { name: { contains: query.search, mode: 'insensitive' as const } },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.project.findMany({
        where,
        include: {
          checklist: true,
          opportunity: { select: { title: true, account: { select: { name: true } } } },
          distributor: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.project.count({ where }),
    ]);
    const names = await this.users.names(rows.map((r) => r.responsibleId));
    const data: ProjectSummaryDto[] = rows.map((r) => ({
      id: r.id,
      opportunityId: r.opportunityId,
      projectCode: r.projectCode,
      title: r.opportunity.title,
      accountName: r.opportunity.account.name,
      distributorName: r.distributor?.name ?? null,
      status: r.status,
      responsibleName: r.responsibleId ? (names.get(r.responsibleId) ?? null) : null,
      valueCents: r.valueCents,
      pendingRequired: requiredPending(r.checklist).length,
      overdue: this.isOverdue(r),
      createdAt: r.createdAt.toISOString(),
    }));
    return toPaginated(data, total, query);
  }

  async get(id: string): Promise<ProjectDto> {
    return this.toDto(await this.findOrThrow(id));
  }

  async getByOpportunity(opportunityId: string): Promise<ProjectDto | null> {
    const row = await this.prisma.db.project.findFirst({
      where: { opportunityId },
      include: { checklist: { orderBy: { position: 'asc' } } },
    });
    return row ? this.toDto(row) : null;
  }

  // ---- Alterações ----

  async update(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const project = await this.findOrThrow(id);
    this.assertEditable(project);
    const data: Record<string, unknown> = {};

    if (input.responsibleId !== undefined) {
      if (input.responsibleId) {
        const user = await this.prisma.db.user.findFirst({
          where: { id: input.responsibleId, isActive: true, deletedAt: null },
          select: { role: true },
        });
        if (!user)
          throw new UnprocessableEntityException(
            'O responsável informado não existe ou está inativo',
          );
        if (!TECHNICAL_ROLES.includes(user.role))
          throw new UnprocessableEntityException(
            'O responsável técnico precisa ser da engenharia ou responsável técnico',
          );
      }
      data.responsibleId = input.responsibleId;
    }

    let reapply: HomologationRules | null = null;
    if (input.distributorId !== undefined && input.distributorId !== project.distributorId) {
      if (project.status !== 'DOCUMENTATION')
        throw new ConflictException(
          'A concessionária só muda enquanto o projeto está reunindo documentos',
        );
      if (input.distributorId) {
        const distributor = await this.prisma.db.distributor.findFirst({
          where: { id: input.distributorId, deletedAt: null },
          select: { id: true },
        });
        if (!distributor) throw new NotFoundException('Concessionária não encontrada');
      }
      data.distributorId = input.distributorId;
      reapply = await this.rules.resolve(input.distributorId);
    }

    await this.prisma.db.$transaction(async (tx) => {
      if (reapply) await this.reapplyRules(tx, project, reapply, data);
      await tx.project.update({ where: { id }, data });
      await this.audit.record(
        {
          action: 'project.updated',
          entity: 'Project',
          entityId: id,
          before: { responsibleId: project.responsibleId, distributorId: project.distributorId },
          after: {
            responsibleId: data.responsibleId ?? project.responsibleId,
            distributorId: data.distributorId ?? project.distributorId,
          },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async updateChecklistItem(
    id: string,
    itemId: string,
    input: UpdateChecklistItemInput,
  ): Promise<ProjectDto> {
    const project = await this.findOrThrow(id);
    this.assertEditable(project);
    const item = project.checklist.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Item do checklist não encontrado');

    const status = input.status ?? item.status;
    const note = input.note === undefined ? item.note : input.note;
    if ((status === 'WAIVED' || status === 'NOT_APPLICABLE') && !note?.trim())
      throw new UnprocessableEntityException(
        'Explique no campo de observação por que o item é dispensado ou não se aplica',
      );
    if (input.documentId) {
      const document = await this.prisma.db.document.findFirst({
        where: { id: input.documentId, deletedAt: null },
        select: { id: true },
      });
      if (!document)
        throw new UnprocessableEntityException('O documento informado não foi encontrado');
    }

    await this.prisma.db.$transaction(async (tx) => {
      const concluding = status === 'DONE' || status === 'WAIVED' || status === 'NOT_APPLICABLE';
      await tx.projectChecklistItem.update({
        where: { id: itemId },
        data: {
          status,
          note,
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
          ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
          completedAt: concluding ? (item.completedAt ?? new Date()) : null,
          completedById: concluding ? (item.completedById ?? this.context.userId ?? null) : null,
        },
      });
      await this.audit.record(
        {
          action: 'project.checklist_item_updated',
          entity: 'Project',
          entityId: id,
          before: { code: item.code, status: item.status },
          after: { code: item.code, status, note },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async changeStatus(id: string, input: ChangeProjectStatusInput): Promise<ProjectDto> {
    const project = await this.findOrThrow(id);
    const to = input.status;
    if (to === project.status) throw new ConflictException('O projeto já está nesta situação');
    if (!TRANSITIONS[project.status].includes(to))
      throw new UnprocessableEntityException({
        message: `Não é possível ir de "${STATUS_NAME[project.status]}" para "${STATUS_NAME[to]}".`,
        code: 'INVALID_PROJECT_TRANSITION',
        data: { from: project.status, allowed: TRANSITIONS[project.status] },
      });
    if ((to === 'CANCELLED' || to === 'DOCUMENTATION') && !input.reason?.trim())
      throw new UnprocessableEntityException(
        to === 'CANCELLED'
          ? 'Informe o motivo do cancelamento'
          : 'Informe o que a distribuidora pediu (pendências)',
      );
    if (to === 'SUBMITTED' && project.status === 'DOCUMENTATION') {
      const pending = requiredPending(project.checklist);
      if (pending.length)
        throw new UnprocessableEntityException({
          message: `Faltam ${pending.length} documento(s) obrigatório(s) do checklist: ${pending.map((p) => p.title).join('; ')}.`,
          code: 'CHECKLIST_INCOMPLETE',
          data: { pending: pending.map((p) => p.code) },
        });
      if (!input.protocolNumber)
        throw new UnprocessableEntityException('Informe o número do protocolo da distribuidora');
    }

    const now = new Date();
    const deadlines = project.rulesDeadlines as unknown as ChecklistDeadline[];
    const suggest = (code: ChecklistDeadline['code'], base: Date) => {
      const rule = deadlines.find((d) => d.code === code);
      return rule
        ? { at: new Date(base.getTime() + rule.days * DAY), source: `Sugerido: ${rule.source}` }
        : null;
    };
    const data: Record<string, unknown> = { status: to };
    if (to === 'SUBMITTED') {
      const first = project.submittedAt === null;
      data.protocolNumber = input.protocolNumber ?? project.protocolNumber;
      data.submittedAt = project.submittedAt ?? now;
      const suggestion = suggest('ACCESS_OPINION', now);
      if (input.dueAt) {
        data.accessOpinionDueAt = new Date(input.dueAt);
        data.accessOpinionDueSource = 'Informado pelo usuário';
      } else if (suggestion && (first || project.status === 'DOCUMENTATION')) {
        data.accessOpinionDueAt = suggestion.at;
        data.accessOpinionDueSource = suggestion.source;
      }
    }
    if (to === 'INSPECTION') {
      data.inspectionRequestedAt = now;
      const suggestion = suggest('INSPECTION', now);
      data.inspectionDueAt = input.dueAt ? new Date(input.dueAt) : (suggestion?.at ?? null);
    }
    if (to === 'APPROVED') data.approvedAt = now;
    if (to === 'CANCELLED') data.cancelledAt = now;

    await this.prisma.db.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data });
      await this.timeline.record(
        {
          opportunityId: project.opportunityId,
          type: TimelineEventType.PROJECT_STATUS_CHANGED,
          summary: `Homologação: ${STATUS_NAME[project.status]} → ${STATUS_NAME[to]}${input.reason ? ` (${input.reason})` : ''}${to === 'SUBMITTED' && input.protocolNumber ? ` — protocolo ${input.protocolNumber}` : ''}`,
          data: { projectId: id, from: project.status, to },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'project.status_changed',
          entity: 'Project',
          entityId: id,
          before: { status: project.status },
          after: {
            status: to,
            reason: input.reason ?? null,
            protocolNumber: input.protocolNumber ?? null,
          },
        },
        tx,
      );
      const payload = {
        opportunityId: project.opportunityId,
        projectId: id,
        from: project.status,
        to,
      };
      if (to === 'SUBMITTED' && project.status === 'DOCUMENTATION' && project.submittedAt === null)
        await this.events.publish(
          { type: DomainEvent.HOMOLOGATION_STARTED, projectCode: project.projectCode, payload },
          tx,
        );
      if (to === 'DOCUMENTATION')
        await this.events.publish(
          {
            type: DomainEvent.HOMOLOGATION_PENDING,
            projectCode: project.projectCode,
            payload: { ...payload, reason: input.reason },
          },
          tx,
        );
      if (to === 'APPROVED')
        await this.events.publish(
          { type: DomainEvent.HOMOLOGATION_APPROVED, projectCode: project.projectCode, payload },
          tx,
        );
    });
    return this.get(id);
  }

  // ---- Internos ----

  private assertEditable(project: Row) {
    if (project.status === 'CANCELLED')
      throw new ConflictException('Projeto cancelado não pode ser alterado');
  }

  private materialize(
    tenantId: string,
    rules: HomologationRules,
    generationClass: GenerationClass | null,
  ) {
    return applicableChecklistItems(rules, generationClass).map(
      ({ item, applicable }, position) => ({
        tenantId,
        code: item.code,
        title: item.title,
        description: item.description ?? null,
        required: item.required,
        position,
        source: item.source,
        status: applicable ? ChecklistItemStatus.PENDING : ChecklistItemStatus.NOT_APPLICABLE,
        note: applicable ? null : 'Não se aplica à classe de geração deste projeto.',
      }),
    );
  }

  /** Mudou a concessionária: itens novos entram, os não iniciados que saíram são removidos, o resto fica como está. */
  private async reapplyRules(
    tx: Tx,
    project: Row,
    rules: HomologationRules,
    data: Record<string, unknown>,
  ) {
    const generationClass = project.generationClass as GenerationClass | null;
    const wanted = this.materialize(project.tenantId, rules, generationClass);
    const existing = new Map(project.checklist.map((i) => [i.code, i]));
    const wantedCodes = new Set(wanted.map((w) => w.code));
    for (const item of wanted) {
      const current = existing.get(item.code);
      if (!current)
        await tx.projectChecklistItem.create({ data: { ...item, projectId: project.id } });
      else
        await tx.projectChecklistItem.update({
          where: { id: current.id },
          data: {
            title: item.title,
            description: item.description,
            required: item.required,
            source: item.source,
            position: item.position,
          },
        });
    }
    for (const current of project.checklist)
      if (
        !wantedCodes.has(current.code) &&
        (current.status === 'PENDING' || current.status === 'NOT_APPLICABLE')
      )
        await tx.projectChecklistItem.delete({ where: { id: current.id } });
    Object.assign(data, {
      rulesRef: rules.ref,
      rulesScope: rules.scope,
      rulesSource: rules.source,
      rulesReviewedBy: rules.reviewedBy,
      rulesNotes: rules.notes,
      rulesDeadlines: rules.deadlines as object,
    });
  }

  private isOverdue(
    p: Pick<Project, 'status' | 'accessOpinionDueAt' | 'inspectionDueAt'>,
  ): boolean {
    const now = Date.now();
    if (p.status === 'SUBMITTED')
      return !!p.accessOpinionDueAt && p.accessOpinionDueAt.getTime() < now;
    if (p.status === 'INSPECTION') return !!p.inspectionDueAt && p.inspectionDueAt.getTime() < now;
    return false;
  }

  private async findOrThrow(id: string): Promise<Row> {
    const row = await this.prisma.db.project.findFirst({
      where: { id },
      include: { checklist: { orderBy: { position: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Projeto não encontrado');
    return row;
  }

  private async toDto(row: Row): Promise<ProjectDto> {
    const [opportunity, distributor, names] = await Promise.all([
      this.prisma.db.opportunity.findFirst({
        where: { id: row.opportunityId },
        select: { title: true, account: { select: { name: true } } },
      }),
      row.distributorId
        ? this.prisma.db.distributor.findFirst({
            where: { id: row.distributorId },
            select: { name: true },
          })
        : null,
      this.users.names([row.responsibleId, ...row.checklist.map((i) => i.completedById)]),
    ]);
    const deadlines = row.rulesDeadlines as unknown as ChecklistDeadline[];
    const now = Date.now();
    const baseFor = (code: ChecklistDeadline['code']): number | null =>
      code === 'ACCESS_OPINION'
        ? now
        : code === 'INSPECTION'
          ? now
          : row.approvedAt
            ? row.approvedAt.getTime()
            : null;
    const wanted: Record<ProjectStatus, ChecklistDeadline['code'][]> = {
      DOCUMENTATION: ['ACCESS_OPINION'],
      SUBMITTED: ['INSPECTION'],
      INSPECTION: [],
      APPROVED: ['POST_APPROVAL_EXECUTION'],
      CANCELLED: [],
    };
    const suggestions: ProjectDeadlineSuggestionDto[] = deadlines
      .filter((d) => wanted[row.status].includes(d.code) && baseFor(d.code) !== null)
      .map((d) => ({
        code: d.code,
        label: d.label,
        days: d.days,
        source: d.source,
        suggestedDueAt: new Date((baseFor(d.code) as number) + d.days * DAY).toISOString(),
      }));
    const checklist: ProjectChecklistItemDto[] = row.checklist.map((i) => ({
      id: i.id,
      code: i.code,
      title: i.title,
      description: i.description,
      required: i.required,
      status: i.status,
      note: i.note,
      dueAt: i.dueAt?.toISOString() ?? null,
      completedAt: i.completedAt?.toISOString() ?? null,
      completedByName: i.completedById ? (names.get(i.completedById) ?? null) : null,
      documentId: i.documentId,
      source: i.source,
    }));
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      projectCode: row.projectCode,
      title: opportunity?.title ?? row.projectCode,
      accountId: row.accountId,
      accountName: opportunity?.account.name ?? '',
      contractId: row.contractId,
      distributorId: row.distributorId,
      distributorName: distributor?.name ?? null,
      status: row.status,
      valueCents: row.valueCents,
      generationClass: row.generationClass as GenerationClass | null,
      responsibleId: row.responsibleId,
      responsibleName: row.responsibleId ? (names.get(row.responsibleId) ?? null) : null,
      rules: {
        ref: row.rulesRef,
        scope: row.rulesScope as HomologationRules['scope'],
        source: row.rulesSource,
        reviewedBy: row.rulesReviewedBy,
        notes: row.rulesNotes,
      },
      checklist,
      pendingRequired: requiredPending(row.checklist).length,
      protocolNumber: row.protocolNumber,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      accessOpinionDueAt: row.accessOpinionDueAt?.toISOString() ?? null,
      accessOpinionDueSource: row.accessOpinionDueSource,
      inspectionRequestedAt: row.inspectionRequestedAt?.toISOString() ?? null,
      inspectionDueAt: row.inspectionDueAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      deadlineSuggestions: suggestions,
      overdue: this.isOverdue(row),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
