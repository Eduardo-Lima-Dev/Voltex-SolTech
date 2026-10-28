import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  AddPortalTicketCommentInput,
  CreatePortalTicketInput,
  PortalAcceptanceInput,
  PortalDocumentDto,
  PortalMeDto,
  PortalMilestoneDto,
  PortalProjectDto,
  PortalProjectSummaryDto,
  PortalTicketDetailDto,
  PortalTicketDto,
  PortalUploadDto,
  PortalVisitDto,
  PortalWarrantyDto,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { DocumentsService, type UploadedFile } from '../../platform/documents/documents.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { FinanceService } from '../crm/finance/finance.service';
import { InstallationsService } from '../operations/installations.service';
import { daysLeft, isoDay } from '../operations/aftersales/dates';
import { MonitoringService } from '../operations/aftersales/monitoring/monitoring.service';
import { TicketsService, ticketCode } from '../operations/aftersales/tickets.service';
import type { PortalPrincipal } from './portal-auth.service';

const MAX_PENDING_UPLOADS = 10;
const MAX_OPEN_CUSTOMER_TICKETS = 10;

const PROJECT_STATUS_LABEL: Record<string, string> = {
  DOCUMENTATION: 'Preparando a documentação do projeto',
  SUBMITTED: 'Projeto em análise na distribuidora',
  INSPECTION: 'Aguardando a vistoria da distribuidora',
  APPROVED: 'Projeto aprovado pela distribuidora',
  CANCELLED: 'Projeto cancelado',
};

/** Texto da situação da obra para o cliente (sem jargão interno). */
const INSTALLATION_LABEL: Record<string, string> = {
  AWAITING_ENGINEERING: 'Projeto técnico em preparação',
  AWAITING_MATERIAL: 'Aguardando a chegada dos materiais',
  MATERIAL_READY: 'Materiais prontos',
  SCHEDULING: 'Agendando a instalação',
  CREW_ASSIGNED: 'Equipe de instalação definida',
  IN_PROGRESS: 'Instalação em andamento',
  FIELD_ISSUE: 'Instalação em andamento',
  INSTALLED: 'Instalação concluída',
  COMMISSIONING: 'Testes finais do sistema',
  CUSTOMER_ACCEPTANCE: 'Aguardando o seu aceite',
  DONE: 'Sistema entregue',
  CANCELLED: 'Instalação cancelada',
};

const VISIT_LABEL: Record<string, string> = {
  VISIT: 'Visita técnica',
  SURVEY: 'Visita técnica',
  INSTALLATION: 'Instalação',
  COMMISSIONING: 'Testes finais',
  MAINTENANCE: 'Manutenção',
  CLEANING: 'Limpeza',
};

/** Estados da instalação em que o material já está separado (para o marco "Materiais prontos"). */
const AFTER_MATERIAL = new Set([
  'MATERIAL_READY',
  'SCHEDULING',
  'CREW_ASSIGNED',
  'IN_PROGRESS',
  'FIELD_ISSUE',
  'INSTALLED',
  'COMMISSIONING',
  'CUSTOMER_ACCEPTANCE',
  'DONE',
]);

const day = (date: Date | null | undefined): string | null => (date ? isoDay(date) : null);

/**
 * O que o cliente vê no portal (§48 da modelagem). Tudo é filtrado pela conta do acesso: o identificador de projeto,
 * chamado ou documento vindo da URL só vale se pertencer a ela. Nunca sai custo, margem, regra interna ou
 * comentário interno.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly finance: FinanceService,
    private readonly monitoring: MonitoringService,
    private readonly installations: InstallationsService,
    private readonly tickets: TicketsService,
  ) {}

  async me(who: PortalPrincipal): Promise<PortalMeDto> {
    const [tenant, account] = await Promise.all([
      this.prisma.system.tenant.findUniqueOrThrow({ where: { id: who.tenantId } }),
      this.prisma.db.account.findFirst({ where: { id: who.accountId } }),
    ]);
    return { companyName: tenant.name, accountName: account?.name ?? '', email: who.email };
  }

  // --- projetos -----------------------------------------------------------------------------------------

  private async projectOrFail(who: PortalPrincipal, projectId: string) {
    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, accountId: who.accountId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }

  /** Dados-base de um projeto: contrato, proposta, instalação, comissionamento aprovado e planta. */
  private async bundle(project: { id: string; contractId: string }) {
    const [contract, installation, plant] = await Promise.all([
      this.prisma.db.contract.findFirst({ where: { id: project.contractId } }),
      this.prisma.db.installation.findFirst({
        where: { projectId: project.id },
        include: { history: { orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.db.plant.findFirst({ where: { projectId: project.id } }),
    ]);
    const [proposal, commissioning] = await Promise.all([
      contract
        ? this.prisma.db.proposal.findFirst({ where: { id: contract.proposalId } })
        : Promise.resolve(null),
      installation
        ? this.prisma.db.commissioningRecord.findFirst({
            where: { installationId: installation.id, status: 'APPROVED' },
            orderBy: { attempt: 'desc' },
          })
        : Promise.resolve(null),
    ]);
    return { contract, installation, plant, proposal, commissioning };
  }

  private milestones(
    project: { approvedAt: Date | null; status: string },
    b: Awaited<ReturnType<PortalService['bundle']>>,
  ): PortalMilestoneDto[] {
    const reached = (status: string): Date | null =>
      b.installation?.history.find((h) => h.toStatus === status)?.createdAt ?? null;
    const m = (
      key: string,
      label: string,
      date: Date | null,
      done = date !== null,
    ): PortalMilestoneDto => ({
      key,
      label,
      date: day(date),
      done,
    });
    const inst = b.installation;
    return [
      m('PROPOSAL', 'Proposta aceita', b.proposal?.acceptedAt ?? null),
      m('CONTRACT', 'Contrato assinado', b.contract?.signedAt ?? null),
      m('HOMOLOGATION', 'Projeto aprovado pela distribuidora', project.approvedAt),
      m(
        'MATERIAL',
        'Materiais prontos',
        inst?.materialsReadyAt ?? reached('MATERIAL_READY'),
        inst ? AFTER_MATERIAL.has(inst.status) : false,
      ),
      m('INSTALLATION', 'Instalação concluída', inst?.installedAt ?? null),
      m('COMMISSIONING', 'Testes finais aprovados', b.commissioning?.decidedAt ?? null),
      m('ACCEPTANCE', 'Aceite do cliente', inst?.acceptedAt ?? null),
      m('ACTIVE', 'Sistema em operação', b.plant?.activatedAt ?? null),
    ];
  }

  private async schedule(installationId: string | undefined): Promise<PortalVisitDto[]> {
    if (!installationId) return [];
    const orders = await this.prisma.db.workOrder.findMany({
      where: { installationId, scheduledStart: { not: null }, status: { not: 'CANCELLED' } },
      orderBy: { scheduledStart: 'asc' },
    });
    return orders.map((o) => ({
      title: VISIT_LABEL[o.type] ?? 'Atividade',
      type: o.type,
      status: o.status,
      start: o.scheduledStart?.toISOString() ?? null,
      end: o.scheduledEnd?.toISOString() ?? null,
    }));
  }

  private async summary(
    project: {
      id: string;
      projectCode: string;
      contractId: string;
      status: string;
      approvedAt: Date | null;
      opportunityId: string;
    },
    title: string,
  ): Promise<
    PortalProjectSummaryDto & {
      bundle: Awaited<ReturnType<PortalService['bundle']>>;
      schedule: PortalVisitDto[];
    }
  > {
    const b = await this.bundle(project);
    const schedule = await this.schedule(b.installation?.id);
    const now = Date.now();
    const next = schedule.find((v) => v.start && new Date(v.start).getTime() >= now) ?? null;
    return {
      id: project.id,
      projectCode: project.projectCode,
      title,
      statusLabel: b.installation
        ? (INSTALLATION_LABEL[b.installation.status] ?? 'Em andamento')
        : (PROJECT_STATUS_LABEL[project.status] ?? 'Em andamento'),
      milestones: this.milestones(project, b),
      nextVisit: next,
      bundle: b,
      schedule,
    };
  }

  private async titleOf(opportunityId: string): Promise<string> {
    const opportunity = await this.prisma.db.opportunity.findFirst({
      where: { id: opportunityId },
      select: { title: true },
    });
    return opportunity?.title ?? 'Projeto de energia solar';
  }

  async projects(who: PortalPrincipal): Promise<PortalProjectSummaryDto[]> {
    const rows = await this.prisma.db.project.findMany({
      where: { accountId: who.accountId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const out: PortalProjectSummaryDto[] = [];
    for (const row of rows) {
      const {
        bundle: _bundle,
        schedule: _schedule,
        ...summary
      } = await this.summary(row, await this.titleOf(row.opportunityId));
      void _bundle;
      void _schedule;
      out.push(summary);
    }
    return out;
  }

  // --- documentos e fotos que o cliente pode ver -------------------------------------------------------

  private async documentList(
    projectId: string,
    b: Awaited<ReturnType<PortalService['bundle']>>,
  ): Promise<PortalDocumentDto[]> {
    const out: PortalDocumentDto[] = [];
    const add = async (
      id: string | null | undefined,
      kind: PortalDocumentDto['kind'],
      label: string,
    ) => {
      if (!id) return;
      const doc = await this.prisma.db.document.findFirst({ where: { id, deletedAt: null } });
      if (doc)
        out.push({
          id: doc.id,
          kind,
          label,
          filename: doc.filename,
          createdAt: doc.createdAt.toISOString(),
        });
    };
    if (b.proposal?.acceptedAt) await add(b.proposal.pdfDocumentId, 'PROPOSAL', 'Proposta aceita');
    if (b.contract?.signedAt)
      await add(b.contract.signedDocumentId, 'CONTRACT', 'Contrato assinado');
    await add(
      b.commissioning?.reportDocumentId,
      'COMMISSIONING_REPORT',
      'Relatório de comissionamento',
    );
    if (b.installation) {
      const photos = await this.prisma.db.workOrderPhoto.findMany({
        where: { visibleToCustomer: true, workOrder: { installationId: b.installation.id } },
        orderBy: { takenAt: 'asc' },
        take: 60,
      });
      for (const photo of photos)
        await add(photo.documentId, 'PHOTO', photo.caption ?? 'Foto da instalação');
    }
    const accepted = await this.prisma.db.portalUpload.findMany({
      where: { projectId, status: 'ACCEPTED' },
    });
    for (const up of accepted) await add(up.documentId, 'SENT_BY_YOU', 'Enviado por você');
    return out;
  }

  /** Só entrega o arquivo se ele estiver na lista do projeto (ou seja, liberado ao cliente). */
  async downloadUrl(who: PortalPrincipal, projectId: string, documentId: string) {
    const project = await this.projectOrFail(who, projectId);
    const list = await this.documentList(project.id, await this.bundle(project));
    if (!list.some((d) => d.id === documentId))
      throw new NotFoundException('Documento não encontrado');
    return this.documents.downloadUrl(documentId);
  }

  // --- um projeto por inteiro ---------------------------------------------------------------------------

  async project(who: PortalPrincipal, projectId: string): Promise<PortalProjectDto> {
    const row = await this.projectOrFail(who, projectId);
    const base = await this.summary(row, await this.titleOf(row.opportunityId));
    const { bundle: b, schedule, ...summary } = base;
    const plant = b.plant;

    const [documents, receivables, uploads, warranties, tickets, monitoring] = await Promise.all([
      this.documentList(row.id, b),
      this.finance.listReceivables(row.id),
      this.prisma.db.portalUpload.findMany({
        where: { projectId: row.id, accountId: who.accountId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      plant ? this.warrantiesOf(plant.id) : Promise.resolve([] as PortalWarrantyDto[]),
      this.ticketsOf(who, plant?.id),
      plant ? this.monitoring.page(plant.id) : Promise.resolve(null),
    ]);
    const filenames = new Map(
      (
        await this.prisma.db.document.findMany({
          where: { id: { in: uploads.map((u) => u.documentId) } },
          select: { id: true, filename: true },
        })
      ).map((d) => [d.id, d.filename]),
    );

    const inst = b.installation;
    return {
      ...summary,
      schedule,
      documents,
      warranties,
      tickets,
      receivables: receivables
        .filter((r) => r.status !== 'CANCELLED')
        .map((r) => ({
          id: r.id,
          order: r.order,
          referenceId: r.referenceId,
          amountCents: r.amountCents,
          dueOn: r.dueOn,
          paidOn: r.paidOn,
          status: r.status,
        })),
      plant: plant
        ? {
            id: plant.id,
            name: plant.name,
            powerKwp: plant.powerKwp,
            activatedAt: plant.activatedAt.toISOString(),
          }
        : null,
      monitoring: monitoring
        ? {
            snapshot: monitoring.snapshot,
            months: monitoring.months,
            daily: monitoring.daily,
            hasExpected: monitoring.hasExpected,
          }
        : null,
      acceptance: {
        status: inst?.acceptedAt
          ? 'DONE'
          : inst?.status === 'CUSTOMER_ACCEPTANCE'
            ? 'PENDING'
            : 'NOT_YET',
        installationId: inst?.id ?? null,
        acceptedAt: inst?.acceptedAt?.toISOString() ?? null,
        acceptedByName: inst?.acceptedByName ?? null,
      },
      uploads: uploads.map((u): PortalUploadDto => ({
        id: u.id,
        filename: filenames.get(u.documentId) ?? 'arquivo',
        note: u.note,
        status: u.status,
        reviewNote: u.reviewNote,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  }

  private async warrantiesOf(plantId: string): Promise<PortalWarrantyDto[]> {
    const assets = await this.prisma.db.plantAsset.findMany({
      where: { plantId, status: 'ACTIVE' },
      include: { warranties: true },
    });
    return assets.flatMap((a) =>
      a.warranties.map((w) => ({
        id: w.id,
        assetLabel: `${a.manufacturer} ${a.model}`.trim(),
        kind: w.kind,
        endsOn: isoDay(w.endsOn),
        daysLeft: daysLeft(w.endsOn),
      })),
    );
  }

  // --- aceite ---------------------------------------------------------------------------------------------

  async accept(
    who: PortalPrincipal,
    projectId: string,
    input: PortalAcceptanceInput,
    meta: { ip?: string; userAgent?: string },
  ) {
    const project = await this.projectOrFail(who, projectId);
    const installation = await this.prisma.db.installation.findFirst({
      where: { projectId: project.id },
    });
    if (!installation) throw new NotFoundException('Instalação não encontrada');
    await this.installations.registerAcceptance(installation.id, {
      acceptedByName: input.acceptedByName,
      ...(input.note ? { note: input.note } : {}),
      channel: 'PORTAL',
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return this.project(who, projectId);
  }

  // --- chamados ---------------------------------------------------------------------------------------------

  private async ticketsOf(who: PortalPrincipal, plantId?: string): Promise<PortalTicketDto[]> {
    const rows = await this.prisma.db.ticket.findMany({
      where: { plant: { accountId: who.accountId }, ...(plantId ? { plantId } : {}) },
      include: { plant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((t) => ({
      id: t.id,
      code: ticketCode(t.number),
      plantId: t.plantId,
      plantName: t.plant.name,
      title: t.title,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt.toISOString(),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
    }));
  }

  listTickets(who: PortalPrincipal): Promise<PortalTicketDto[]> {
    return this.ticketsOf(who);
  }

  async createTicket(
    who: PortalPrincipal,
    input: CreatePortalTicketInput,
  ): Promise<PortalTicketDto> {
    const plant = await this.prisma.db.plant.findFirst({
      where: { id: input.plantId, accountId: who.accountId, status: 'ACTIVE' },
    });
    if (!plant) throw new NotFoundException('Usina não encontrada');
    const open = await this.prisma.db.ticket.count({
      where: {
        plant: { accountId: who.accountId },
        origin: 'CUSTOMER',
        status: { notIn: ['RESOLVED', 'CLOSED'] },
      },
    });
    if (open >= MAX_OPEN_CUSTOMER_TICKETS)
      throw new UnprocessableEntityException({
        code: 'TOO_MANY_OPEN_TICKETS',
        message: 'Você já tem muitos chamados em aberto. Aguarde o atendimento dos atuais.',
      });
    const { ticket } = await this.tickets.createInternal(
      {
        plantId: plant.id,
        type: 'CORRECTIVE',
        priority: 'NORMAL',
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
      },
      { origin: 'CUSTOMER', openedById: null },
    );
    await this.audit.record({
      action: 'portal.ticket_created',
      entity: 'Ticket',
      entityId: ticket.id,
      after: { portalAccessId: who.accessId, plantId: plant.id },
    });
    const created = (await this.ticketsOf(who, plant.id)).find((t) => t.id === ticket.id);
    if (!created) throw new NotFoundException('Chamado não encontrado');
    return created;
  }

  private async ticketOrFail(who: PortalPrincipal, ticketId: string) {
    const ticket = await this.prisma.db.ticket.findFirst({
      where: { id: ticketId, plant: { accountId: who.accountId } },
      include: { plant: { select: { name: true } } },
    });
    if (!ticket) throw new NotFoundException('Chamado não encontrado');
    return ticket;
  }

  async ticket(who: PortalPrincipal, ticketId: string): Promise<PortalTicketDetailDto> {
    const t = await this.ticketOrFail(who, ticketId);
    const comments = await this.prisma.db.ticketComment.findMany({
      where: { ticketId, internal: false },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: t.id,
      code: ticketCode(t.number),
      plantId: t.plantId,
      plantName: t.plant.name,
      title: t.title,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt.toISOString(),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      description: t.description,
      resolution: t.resolution,
      comments: comments.map((c) => ({
        id: c.id,
        authorName: c.authorName,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        fromYou: c.authorId === null,
      })),
    };
  }

  async commentTicket(
    who: PortalPrincipal,
    ticketId: string,
    input: AddPortalTicketCommentInput,
  ): Promise<PortalTicketDetailDto> {
    const t = await this.ticketOrFail(who, ticketId);
    if (t.status === 'CLOSED')
      throw new UnprocessableEntityException({
        code: 'TICKET_CLOSED',
        message: 'Este chamado está encerrado. Abra um novo se precisar.',
      });
    const account = await this.prisma.db.account.findFirst({ where: { id: who.accountId } });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.ticketComment.create({
        data: {
          tenantId: who.tenantId,
          ticketId,
          authorId: null,
          authorName: account?.name ?? 'Cliente',
          internal: false,
          body: input.body,
        },
      });
      await this.audit.record(
        {
          action: 'portal.ticket_commented',
          entity: 'Ticket',
          entityId: ticketId,
          after: { portalAccessId: who.accessId },
        },
        tx,
      );
    });
    return this.ticket(who, ticketId);
  }

  // --- envio de documento pelo cliente (quarentena) ---------------------------------------------------------

  async upload(
    who: PortalPrincipal,
    projectId: string,
    file: UploadedFile | undefined,
    note: string | undefined,
  ): Promise<PortalUploadDto> {
    const project = await this.projectOrFail(who, projectId);
    const pending = await this.prisma.db.portalUpload.count({
      where: { projectId: project.id, accountId: who.accountId, status: 'PENDING' },
    });
    if (pending >= MAX_PENDING_UPLOADS)
      throw new UnprocessableEntityException({
        code: 'TOO_MANY_PENDING_UPLOADS',
        message: 'Há muitos arquivos aguardando análise. Aguarde a revisão antes de enviar mais.',
      });
    // `assertAllowedFile` (tipo e assinatura do arquivo) e o limite de tamanho valem dentro de `documents.upload`.
    const doc = await this.documents.upload(file, {
      entityType: 'PortalUpload',
      entityId: project.id,
    });
    const row = await this.prisma.db.portalUpload.create({
      data: {
        tenantId: who.tenantId,
        accountId: who.accountId,
        projectId: project.id,
        accessId: who.accessId,
        documentId: doc.id,
        note: note ?? null,
      },
    });
    await this.audit.record({
      action: 'portal.document_sent',
      entity: 'PortalUpload',
      entityId: row.id,
      after: { portalAccessId: who.accessId, filename: doc.filename },
    });
    return {
      id: row.id,
      filename: doc.filename,
      note: row.note,
      status: row.status,
      reviewNote: null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
