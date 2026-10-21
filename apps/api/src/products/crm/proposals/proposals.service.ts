import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Opportunity, Proposal, ProposalSnapshot, Quote } from '@voltex/database';
import {
  DomainEvent,
  OpportunityStage,
  ProposalStatus,
  TimelineEventType,
  canTransition,
  type AcceptProposalInput,
  type Branding,
  type CreateProposalData,
  type ProposalDto,
  type ProposalScenarioDto,
  type PublicProposalDto,
  type EngineeringResults,
} from '@voltex/shared';
import { repriceCashFlow, type QuickCalculationResult } from '@voltex/solar-engine';
import { RequestContext } from '../../../common/context/request-context';
import type { Env } from '../../../config/env';
import { AuditService } from '../../../platform/audit/audit.service';
import { DocumentsService } from '../../../platform/documents/documents.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { GuardService } from '../guard/guard.service';
import { OpportunitiesService } from '../opportunities.service';
import { QuotesService } from '../quotes/quotes.service';
import { TimelineService } from '../support/timeline.service';
import { BrandingService } from './branding.service';
import {
  PROPOSAL_DISCLAIMER,
  toPublicProposal,
  type ProposalContent,
  type ProposalScenarioContent,
} from './proposal-content';
import { buildProposalPdf } from './proposal-pdf';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const DAY = 86_400_000;
const STAGES_THAT_ACCEPT_PROPOSALS: readonly OpportunityStage[] = [
  OpportunityStage.QUOTING,
  OpportunityStage.PROPOSAL_READY,
  OpportunityStage.PROPOSAL_SENT,
  OpportunityStage.NEGOTIATION,
];

type Row = Proposal & { snapshot: ProposalSnapshot | null };

@Injectable()
export class ProposalsService implements OnModuleInit {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly timeline: TimelineService,
    private readonly opportunities: OpportunitiesService,
    private readonly quotes: QuotesService,
    private readonly guard: GuardService,
    private readonly branding: BrandingService,
    private readonly documents: DocumentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    // Travas manuais: a proposta pronta e a enviada só nascem pelas ações próprias (que checam triagem e margem).
    this.opportunities.registerGate({
      assertCanEnter: async (opportunity, to) => {
        if (to !== OpportunityStage.PROPOSAL_READY && to !== OpportunityStage.PROPOSAL_SENT) return;
        const proposals = await this.prisma.db.proposal.findMany({
          where: { opportunityId: opportunity.id, status: { in: ['GENERATED', 'SENT', 'VIEWED'] } },
          select: { status: true },
        });
        const usable =
          to === OpportunityStage.PROPOSAL_READY
            ? proposals.length > 0
            : proposals.some((p) => p.status === 'SENT' || p.status === 'VIEWED');
        if (!usable)
          throw new UnprocessableEntityException({
            message:
              to === OpportunityStage.PROPOSAL_READY
                ? 'Gere a proposta na aba Proposta: ela só é liberada com a triagem verde (ou liberada) e a margem dentro da política (ou aprovada).'
                : 'Envie a proposta pela aba Proposta (ação "Enviar"): a etapa muda sozinha.',
            code: 'PROPOSAL_REQUIRED',
          });
      },
    });
  }

  // ---- Consulta ----

  async list(opportunityId: string): Promise<ProposalDto[]> {
    await this.opportunities.findOrThrow(opportunityId);
    const rows = await this.prisma.db.proposal.findMany({
      where: { opportunityId },
      include: { snapshot: true },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async get(id: string): Promise<ProposalDto> {
    return this.toDto(await this.findOrThrow(id));
  }

  async pdfUrl(id: string) {
    const row = await this.findOrThrow(id);
    if (!row.pdfDocumentId)
      throw new NotFoundException('O PDF desta proposta ainda não foi gerado');
    return this.documents.downloadUrl(row.pdfDocumentId);
  }

  // ---- Geração ----

  async create(opportunityId: string, data: CreateProposalData): Promise<ProposalDto> {
    const opportunity = await this.opportunities.findOrThrow(opportunityId);
    if (opportunity.status !== 'OPEN')
      throw new ConflictException('Oportunidade encerrada não recebe propostas');
    if (!STAGES_THAT_ACCEPT_PROPOSALS.includes(opportunity.stage))
      throw new UnprocessableEntityException({
        message: 'A proposta é gerada com a oportunidade em Cotação (depois da triagem liberada).',
        code: 'WRONG_STAGE',
      });
    if (!(await this.guard.isReleased(opportunityId)))
      throw new UnprocessableEntityException({
        message:
          'A triagem precisa estar verde (ou liberada formalmente) e atualizada antes da proposta.',
        code: 'GUARD_REQUIRED',
      });

    const uniqueIds = [...new Set(data.quoteIds)];
    const quotes = await this.prisma.db.quote.findMany({
      where: { id: { in: uniqueIds }, opportunityId, deletedAt: null },
    });
    if (quotes.length !== uniqueIds.length)
      throw new UnprocessableEntityException('Há cotações que não pertencem a esta oportunidade');
    const ordered = uniqueIds.map((id) => quotes.find((q) => q.id === id) as Quote);
    for (const quote of ordered) await this.quotes.assertReleased(quote, opportunity); // Margin Guard

    const content = await this.buildContent(opportunity, ordered, data);
    const contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const validUntil = new Date(content.validUntil);

    const row = await this.prisma.db.$transaction(async (tx) => {
      const last = await tx.proposal.findFirst({
        where: { opportunityId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (last?.version ?? 0) + 1;
      content.version = version;
      const created = await tx.proposal.create({
        data: {
          tenantId: this.context.requireTenantId(),
          opportunityId,
          version,
          scenarios: content.scenarios.map((s) => ({
            label: s.label,
            quoteId: s.quoteId,
            quoteVersion: s.quoteVersion,
            installedPowerKwp: s.installedPowerKwp,
            priceCents: s.priceCents,
          })) as object,
          conditions: content.conditions as object,
          validUntil,
          createdById: this.context.userId ?? null,
          snapshot: {
            create: {
              tenantId: this.context.requireTenantId(),
              content: content as unknown as object,
              contentHash,
              createdById: this.context.userId ?? null,
            },
          },
        },
        include: { snapshot: true },
      });
      // A versão anterior (ainda não aceita) deixa de valer; a aceita permanece como histórico.
      await tx.proposal.updateMany({
        where: {
          opportunityId,
          id: { not: created.id },
          status: { in: ['GENERATED', 'SENT', 'VIEWED'] },
        },
        data: { status: 'SUPERSEDED' },
      });
      await tx.quote.updateMany({
        where: { id: { in: uniqueIds } },
        data: { lockedAt: new Date() },
      });
      await this.timeline.record(
        {
          opportunityId,
          type: TimelineEventType.PROPOSAL_GENERATED,
          summary: `Proposta v${version} gerada com ${content.scenarios.length} cenário(s)`,
          data: { proposalId: created.id, version },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'proposal.generated',
          entity: 'Proposal',
          entityId: created.id,
          after: { opportunityId, version, quotes: uniqueIds, contentHash },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.PROPOSAL_GENERATED,
          projectCode: opportunity.projectCode,
          payload: {
            opportunityId,
            proposalId: created.id,
            version,
            scenarios: content.scenarios.length,
          },
        },
        tx,
      );
      if (opportunity.stage === OpportunityStage.QUOTING)
        await this.opportunities.moveStageWithin(
          tx,
          opportunity,
          OpportunityStage.PROPOSAL_READY,
          null,
          'proposta gerada',
        );
      return created;
    });

    await this.attachPdf(row);
    return this.get(row.id);
  }

  /** (Re)gera o PDF a partir do snapshot, sem mexer em mais nada. */
  async regeneratePdf(id: string): Promise<ProposalDto> {
    await this.attachPdf(await this.findOrThrow(id));
    return this.get(id);
  }

  // ---- Envio ----

  /** Cria um novo link público (o anterior deixa de funcionar) e marca como enviada. */
  async send(id: string): Promise<ProposalDto> {
    const row = await this.findOrThrow(id);
    if (row.status === 'SUPERSEDED')
      throw new ConflictException('Esta versão foi substituída por outra mais nova.');
    if (row.status === 'ACCEPTED')
      throw new ConflictException('Esta proposta já foi aceita pelo cliente.');
    if (row.validUntil.getTime() < Date.now())
      throw new ConflictException('A validade desta proposta acabou: gere uma nova versão.');
    const opportunity = await this.opportunities.findOrThrow(row.opportunityId);
    if (!(await this.guard.isReleased(row.opportunityId)))
      throw new UnprocessableEntityException({
        message:
          'As premissas mudaram desde a triagem: avalie de novo na aba Triagem antes de enviar.',
        code: 'GUARD_REQUIRED',
      });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.proposal.update({
        where: { id },
        data: {
          tokenHash: hashToken(token),
          sentAt: row.sentAt ?? new Date(),
          status: row.status === 'VIEWED' ? 'VIEWED' : 'SENT',
        },
      });
      await this.timeline.record(
        {
          opportunityId: row.opportunityId,
          type: TimelineEventType.PROPOSAL_SENT,
          summary: `Proposta v${row.version} enviada ao cliente`,
          data: { proposalId: id, version: row.version },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'proposal.sent',
          entity: 'Proposal',
          entityId: id,
          after: { version: row.version },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.PROPOSAL_SENT,
          projectCode: opportunity.projectCode,
          payload: { opportunityId: row.opportunityId, proposalId: id, version: row.version },
        },
        tx,
      );
      if (canTransition(opportunity.stage, OpportunityStage.PROPOSAL_SENT))
        await this.opportunities.moveStageWithin(
          tx,
          opportunity,
          OpportunityStage.PROPOSAL_SENT,
          null,
          'proposta enviada',
        );
    });
    const dto = await this.get(id);
    return { ...dto, publicUrl: `${this.config.get('WEB_URL', { infer: true })}/p/${token}` };
  }

  // ---- Página pública ----

  /** Abre a proposta pelo link (sem login): registra a visualização. Nunca expõe custos nem margem. */
  async openPublic(token: string): Promise<PublicProposalDto> {
    const { row, content } = await this.findByToken(token);
    const expired = row.validUntil.getTime() < Date.now();
    const view = await this.context.run({ tenantId: row.tenantId }, async () => {
      const first =
        row.firstViewedAt === null && (row.status === 'SENT' || row.status === 'VIEWED');
      if (row.status === 'SUPERSEDED' || row.status === 'GENERATED') return { status: row.status };
      await this.prisma.db.$transaction(async (tx) => {
        await tx.proposal.update({
          where: { id: row.id },
          data: {
            viewCount: { increment: 1 },
            lastViewedAt: new Date(),
            ...(first ? { firstViewedAt: new Date() } : {}),
            ...(row.status === 'SENT' ? { status: 'VIEWED' as const } : {}),
          },
        });
        if (first) {
          const opportunity = await tx.opportunity.findUniqueOrThrow({
            where: { id: row.opportunityId },
          });
          await this.timeline.record(
            {
              opportunityId: row.opportunityId,
              type: TimelineEventType.PROPOSAL_VIEWED,
              summary: `O cliente abriu a proposta v${row.version}`,
              data: { proposalId: row.id },
              actorId: null,
            },
            tx,
          );
          await this.events.publish(
            {
              type: DomainEvent.PROPOSAL_VIEWED,
              actorId: null,
              projectCode: opportunity.projectCode,
              payload: {
                opportunityId: row.opportunityId,
                proposalId: row.id,
                version: row.version,
              },
            },
            tx,
          );
        }
      });
      return { status: row.status === 'SENT' ? ('VIEWED' as const) : row.status };
    });
    return toPublicProposal(content, {
      status: view.status,
      expired,
      acceptedAt: row.acceptedAt,
      acceptedByName: row.acceptedByName,
    });
  }

  async acceptPublic(
    token: string,
    input: AcceptProposalInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<PublicProposalDto> {
    const { row, content } = await this.findByToken(token);
    if (row.status === 'ACCEPTED') throw new ConflictException('Esta proposta já foi aceita.');
    if (row.status === 'SUPERSEDED')
      throw new GoneException('Esta proposta foi substituída por uma versão mais nova.');
    if (row.status === 'GENERATED') throw new NotFoundException('Proposta não encontrada');
    if (row.validUntil.getTime() < Date.now())
      throw new GoneException('A validade desta proposta acabou. Peça uma nova ao vendedor.');

    const accepted = await this.context.run({ tenantId: row.tenantId }, () =>
      this.prisma.db.$transaction(async (tx) => {
        const updated = await tx.proposal.update({
          where: { id: row.id },
          data: {
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedByName: input.name,
            acceptedByDocument: input.document ?? null,
            acceptedIp: meta.ip ?? null,
            acceptedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
          },
        });
        const opportunity = await tx.opportunity.findUniqueOrThrow({
          where: { id: row.opportunityId },
        });
        await this.timeline.record(
          {
            opportunityId: row.opportunityId,
            type: TimelineEventType.PROPOSAL_ACCEPTED,
            summary: `Proposta v${row.version} aceita por ${input.name}`,
            data: { proposalId: row.id, acceptedBy: input.name },
            actorId: null,
          },
          tx,
        );
        await this.audit.record(
          {
            action: 'proposal.accepted',
            entity: 'Proposal',
            entityId: row.id,
            actorId: null,
            after: { acceptedBy: input.name, ip: meta.ip ?? null, version: row.version },
          },
          tx,
        );
        await this.events.publish(
          {
            type: DomainEvent.PROPOSAL_ACCEPTED,
            actorId: null,
            projectCode: opportunity.projectCode,
            payload: {
              opportunityId: row.opportunityId,
              proposalId: row.id,
              version: row.version,
              acceptedBy: input.name,
            },
          },
          tx,
        );
        // O aceite leva a oportunidade ao contrato (quando a etapa atual permite).
        if (
          opportunity.status === 'OPEN' &&
          canTransition(opportunity.stage, OpportunityStage.CONTRACT)
        )
          await this.opportunities.moveStageWithin(
            tx,
            opportunity,
            OpportunityStage.CONTRACT,
            null,
            'proposta aceita pelo cliente',
          );
        return updated;
      }),
    );
    return toPublicProposal(content, {
      status: 'ACCEPTED',
      expired: false,
      acceptedAt: accepted.acceptedAt,
      acceptedByName: accepted.acceptedByName,
    });
  }

  /** PDF da proposta para o cliente (só com o link válido). */
  async publicPdf(token: string): Promise<{ buffer: Buffer; filename: string }> {
    const { row, content } = await this.findByToken(token);
    if (row.status === 'SUPERSEDED' || row.status === 'GENERATED')
      throw new NotFoundException('Proposta não encontrada');
    if (!row.pdfDocumentId)
      throw new NotFoundException('O PDF desta proposta ainda não está disponível');
    const file = await this.context.run({ tenantId: row.tenantId }, () =>
      this.documents.readContent(row.pdfDocumentId as string),
    );
    return { buffer: file.buffer, filename: `proposta-${content.projectCode}-v${row.version}.pdf` };
  }

  async publicLogo(token: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const { row, content } = await this.findByToken(token);
    if (!content.brand.logoDocumentId) throw new NotFoundException('Sem logo');
    const file = await this.context.run({ tenantId: row.tenantId }, () =>
      this.documents.readContent(content.brand.logoDocumentId as string),
    );
    return { buffer: file.buffer, mimeType: file.mimeType };
  }

  // ---- Internos ----

  private async buildContent(
    opportunity: Opportunity,
    quotes: Quote[],
    data: CreateProposalData,
  ): Promise<ProposalContent> {
    const [account, tenant, branding, guardOverview, bill] = await Promise.all([
      this.prisma.db.account.findFirstOrThrow({ where: { id: opportunity.accountId } }),
      this.prisma.system.tenant.findUniqueOrThrow({
        where: { id: this.context.requireTenantId() },
        select: { name: true },
      }),
      this.branding.get(),
      this.guard.overview(opportunity.id),
      this.prisma.db.energyBillSnapshot.findFirst({
        where: { bill: { opportunityId: opportunity.id } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    ]);

    // A proposta preserva o cálculo preliminar como fallback. Quando a cotação veio de
    // engenharia, usa exclusivamente o resultado que já está congelado no snapshot aprovado.
    const snapshotIds = quotes.flatMap((quote) =>
      quote.engineeringSnapshotId ? [quote.engineeringSnapshotId] : [],
    );
    const engineeringSnapshots = snapshotIds.length
      ? await this.prisma.db.engineeringSnapshot.findMany({
          where: { id: { in: snapshotIds }, project: { opportunityId: opportunity.id } },
          select: { id: true, content: true },
        })
      : [];
    const engineeringById = new Map(
      engineeringSnapshots.map((snapshot) => [
        snapshot.id,
        (snapshot.content as { version?: { results?: EngineeringResults } }).version?.results,
      ]),
    );
    const scenarios: ProposalScenarioContent[] = [];
    for (const [index, quote] of quotes.entries()) {
      if (!quote.calculationSessionId)
        throw new UnprocessableEntityException(
          `A cotação v${quote.version} não tem cálculo vinculado: os números da proposta vêm dele.`,
        );
      const session = await this.prisma.db.calculationSession.findFirst({
        where: { id: quote.calculationSessionId, deletedAt: null },
      });
      if (!session)
        throw new UnprocessableEntityException(
          `O cálculo da cotação v${quote.version} não foi encontrado`,
        );
      const result = session.result as unknown as QuickCalculationResult;
      const repriced = repriceCashFlow(result.cashFlow, quote.priceCents);
      const engineering = quote.engineeringSnapshotId
        ? engineeringById.get(quote.engineeringSnapshotId)
        : undefined;
      const engineeringSimulation = engineering?.simulation;
      const engineeringEconomics = engineering?.economics;
      const hasEngineeringGeneration =
        engineeringSimulation?.energyKwh !== null && engineeringSimulation?.energyKwh !== undefined;
      const hasEngineeringEconomics = engineeringEconomics?.status === 'VALID';
      scenarios.push({
        label:
          data.labels?.[index]?.trim() || (quotes.length > 1 ? `Cenário ${index + 1}` : 'Proposta'),
        installedPowerKwp: engineering?.totals.powerKwp ?? result.installedPowerKwp,
        moduleCount: engineering?.totals.moduleCount ?? result.moduleCount,
        estimatedAreaM2: result.estimatedAreaM2,
        annualGenerationKwh: hasEngineeringGeneration
          ? (engineeringSimulation.energyKwh as number)
          : result.annualGenerationKwh,
        monthlyGenerationKwh: result.monthlyGenerationKwh,
        averageMonthlyConsumptionKwh: result.averageMonthlyConsumptionKwh,
        compensationRatio: result.compensationRatio,
        priceCents: quote.priceCents,
        firstYearSavingsCents: hasEngineeringEconomics
          ? (engineeringEconomics.firstYearSavingsCents ?? repriced.firstYearSavingsCents)
          : repriced.firstYearSavingsCents,
        accumulatedSavingsCents: hasEngineeringEconomics
          ? (engineeringEconomics.accumulatedSavingsCents ?? repriced.accumulatedSavingsCents)
          : repriced.accumulatedSavingsCents,
        simplePaybackYears: hasEngineeringEconomics
          ? (engineeringEconomics.simplePaybackYears ?? repriced.simplePaybackYears)
          : repriced.simplePaybackYears,
        horizonYears: hasEngineeringEconomics
          ? (engineeringEconomics.horizonYears ?? result.assumptions.horizonYears)
          : result.assumptions.horizonYears,
        cashFlow: [
          { year: 0, cumulativeCents: -quote.priceCents },
          ...repriced.cashFlow.map((r) => ({ year: r.year, cumulativeCents: r.cumulativeCents })),
        ],
        quoteId: quote.id,
        quoteVersion: quote.version,
        calculationSessionId: session.id,
        ruleSetRef: session.ruleSetRef,
        algorithmVersion: session.algorithmVersion,
        engineeringSnapshotId: hasEngineeringGeneration ? quote.engineeringSnapshotId : null,
      });
    }

    const now = Date.now();
    const current = guardOverview.current;
    return {
      version: 0,
      tenantName: tenant.name,
      brand: {
        primaryColor: (branding as Branding).primaryColor ?? null,
        logoDocumentId: branding.logoDocumentId ?? null,
      },
      title: opportunity.title,
      customerName: account.name,
      projectCode: opportunity.projectCode,
      scenarios,
      conditions: {
        paymentTerms: data.paymentTerms ?? null,
        notes: data.notes ?? null,
        validityDays: data.validityDays,
      },
      validUntil: new Date(now + data.validityDays * DAY).toISOString(),
      guard: current
        ? {
            evaluationId: current.id,
            version: current.version,
            status: current.status,
            overridden: current.override !== null,
          }
        : null,
      billSnapshotId: bill?.id ?? null,
      generatedAt: new Date(now).toISOString(),
      disclaimer: PROPOSAL_DISCLAIMER,
    };
  }

  private async attachPdf(row: Row): Promise<void> {
    if (!row.snapshot) return;
    try {
      const content = row.snapshot.content as unknown as ProposalContent;
      let logo: { buffer: Buffer } | undefined;
      if (content.brand.logoDocumentId) {
        try {
          logo = {
            buffer: (await this.documents.readContent(content.brand.logoDocumentId)).buffer,
          };
        } catch {
          logo = undefined; // logo removida: a proposta sai só com o nome da empresa
        }
      }
      const pdf = await buildProposalPdf(content, logo);
      const document = await this.documents.upload(
        {
          originalname: `proposta-${content.projectCode}-v${row.version}.pdf`,
          mimetype: 'application/pdf',
          buffer: pdf,
          size: pdf.length,
        },
        { entityType: 'Proposal', entityId: row.id },
      );
      await this.prisma.db.proposal.update({
        where: { id: row.id },
        data: { pdfDocumentId: document.id },
      });
    } catch (error) {
      // A proposta existe e o snapshot está salvo; o PDF pode ser regenerado por `POST /proposals/:id/pdf`.
      this.logger.error({ err: error, proposalId: row.id }, 'Falha ao gerar o PDF da proposta');
    }
  }

  private async findOrThrow(id: string): Promise<Row> {
    const row = await this.prisma.db.proposal.findFirst({
      where: { id },
      include: { snapshot: true },
    });
    if (!row) throw new NotFoundException('Proposta não encontrada');
    return row;
  }

  private async findByToken(token: string): Promise<{ row: Row; content: ProposalContent }> {
    const row = await this.prisma.system.proposal.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { snapshot: true },
    });
    if (!row?.snapshot) throw new NotFoundException('Proposta não encontrada');
    return { row, content: row.snapshot.content as unknown as ProposalContent };
  }

  private toDto(row: Row): ProposalDto {
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      version: row.version,
      status: row.status as ProposalStatus,
      scenarios: row.scenarios as unknown as ProposalScenarioDto[],
      validUntil: row.validUntil.toISOString(),
      expired: row.validUntil.getTime() < Date.now() && row.status !== 'ACCEPTED',
      sentAt: row.sentAt?.toISOString() ?? null,
      firstViewedAt: row.firstViewedAt?.toISOString() ?? null,
      viewCount: row.viewCount,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      acceptedByName: row.acceptedByName,
      snapshotId: row.snapshot?.id ?? '',
      pdfDocumentId: row.pdfDocumentId,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
