import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Contract } from '@voltex/database';
import {
  CONTRACT_VARIABLES,
  DEFAULT_CONTRACT_TEMPLATE,
  DomainEvent,
  OpportunityStage,
  TimelineEventType,
  renderContractTemplate,
  unknownTemplateVariables,
  type CancelContractInput,
  type ContractDto,
  type ContractTemplateDto,
  type CreateContractInput,
  type GenerationClass,
  type SignContractData,
  type UpdateContractTemplateData,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { DocumentsService, type UploadedFile } from '../../../platform/documents/documents.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { OpportunitiesService } from '../opportunities.service';
import type { ProposalContent } from '../proposals/proposal-content';
import { ProjectsService } from '../projects/projects.service';
import { TimelineService } from '../support/timeline.service';
import { buildContractPdf } from './contract-pdf';
import { DOCX_MIME, DocxTemplateError, inspectDocx, renderDocx } from './docx-template';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number) => brl.format(cents / 100).replace(/\u00a0/g, ' ');
const SIGNED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly timeline: TimelineService,
    private readonly documents: DocumentsService,
    private readonly opportunities: OpportunitiesService,
    private readonly projects: ProjectsService,
  ) {}

  // ---- Modelo ----

  async getTemplate(): Promise<ContractTemplateDto> {
    const row = await this.prisma.db.contractTemplate.findFirst({ orderBy: { version: 'desc' } });
    return {
      version: row?.version ?? null,
      name: row?.name ?? 'Modelo-base (sem revisão jurídica)',
      body: row?.body ?? DEFAULT_CONTRACT_TEMPLATE,
      isDefault: !row,
      kind: (row?.kind ?? 'TEXT') as 'TEXT' | 'DOCX',
      fileName: row?.fileName ?? null,
      variables: [...CONTRACT_VARIABLES],
      createdAt: row?.createdAt.toISOString() ?? null,
    };
  }

  async saveTemplate(data: UpdateContractTemplateData): Promise<ContractTemplateDto> {
    const unknown = unknownTemplateVariables(data.body);
    if (unknown.length)
      throw new UnprocessableEntityException({
        message: `Variáveis desconhecidas no modelo: ${unknown.map((u) => `{{${u}}}`).join(', ')}.`,
        code: 'UNKNOWN_TEMPLATE_VARIABLES',
        data: { unknown },
      });
    await this.prisma.db.$transaction(async (tx) => {
      const last = await tx.contractTemplate.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.contractTemplate.create({
        data: {
          tenantId: this.context.requireTenantId(),
          version: (last?.version ?? 0) + 1,
          name: data.name,
          body: data.body,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'contract_template.published',
          entity: 'ContractTemplate',
          entityId: created.id,
          after: { version: created.version, name: created.name },
        },
        tx,
      );
    });
    return this.getTemplate();
  }

  /** Modelo em Word enviado pela empresa: valida as variáveis e guarda o arquivo como nova versão do modelo. */
  async uploadTemplate(
    file: UploadedFile | undefined,
    name: string | undefined,
  ): Promise<ContractTemplateDto> {
    if (!file) throw new BadRequestException('Envie o modelo no campo "file"');
    if (file.mimetype !== DOCX_MIME && !/\.docx$/i.test(file.originalname))
      throw new UnprocessableEntityException('O modelo precisa ser um arquivo do Word (.docx).');
    let inspected: { text: string; variables: string[] };
    try {
      inspected = inspectDocx(file.buffer);
    } catch (error) {
      if (error instanceof DocxTemplateError)
        throw new UnprocessableEntityException({
          message: error.message,
          code: 'INVALID_DOCX_TEMPLATE',
        });
      throw error;
    }
    const unknown = unknownTemplateVariables(inspected.text);
    if (unknown.length)
      throw new UnprocessableEntityException({
        message: `Variáveis desconhecidas no modelo: ${unknown.map((u) => `{{${u}}}`).join(', ')}.`,
        code: 'UNKNOWN_TEMPLATE_VARIABLES',
        data: { unknown },
      });
    if (inspected.variables.length === 0)
      throw new UnprocessableEntityException({
        message:
          'O modelo não usa nenhuma variável (como {{cliente.nome}}): o contrato sairia igual para todo cliente.',
        code: 'NO_TEMPLATE_VARIABLES',
      });
    const document = await this.documents.upload(
      { ...file, mimetype: DOCX_MIME },
      { entityType: 'ContractTemplate', entityId: this.context.requireTenantId() },
    );
    await this.prisma.db.$transaction(async (tx) => {
      const last = await tx.contractTemplate.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.contractTemplate.create({
        data: {
          tenantId: this.context.requireTenantId(),
          version: (last?.version ?? 0) + 1,
          name: name?.trim() || file.originalname.replace(/\.docx$/i, ''),
          body: inspected.text,
          kind: 'DOCX',
          documentId: document.id,
          fileName: file.originalname,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'contract_template.uploaded',
          entity: 'ContractTemplate',
          entityId: created.id,
          after: {
            version: created.version,
            fileName: file.originalname,
            variables: inspected.variables.length,
          },
        },
        tx,
      );
    });
    return this.getTemplate();
  }

  async templateFileUrl() {
    const row = await this.prisma.db.contractTemplate.findFirst({ orderBy: { version: 'desc' } });
    if (!row?.documentId) throw new NotFoundException('O modelo atual não é um arquivo enviado.');
    return this.documents.downloadUrl(row.documentId);
  }

  // ---- Consulta ----

  async list(opportunityId: string): Promise<ContractDto[]> {
    await this.opportunities.findOrThrow(opportunityId);
    const rows = await this.prisma.db.contract.findMany({
      where: { opportunityId },
      include: { project: { select: { id: true } } },
      orderBy: { version: 'desc' },
    });
    return rows.map((r) => this.toDto(r, r.project?.id ?? null));
  }

  async get(id: string): Promise<ContractDto> {
    const row = await this.findOrThrow(id);
    const project = await this.prisma.db.project.findFirst({
      where: { contractId: id },
      select: { id: true },
    });
    return this.toDto(row, project?.id ?? null);
  }

  async pdfUrl(id: string) {
    const row = await this.findOrThrow(id);
    if (!row.pdfDocumentId)
      throw new NotFoundException('O PDF deste contrato ainda não foi gerado');
    return this.documents.downloadUrl(row.pdfDocumentId);
  }

  async signedUrl(id: string) {
    const row = await this.findOrThrow(id);
    if (!row.signedDocumentId) throw new NotFoundException('Este contrato ainda não foi assinado');
    return this.documents.downloadUrl(row.signedDocumentId);
  }

  // ---- Geração ----

  async generate(opportunityId: string, input: CreateContractInput): Promise<ContractDto> {
    const opportunity = await this.opportunities.findOrThrow(opportunityId);
    if (opportunity.status !== 'OPEN')
      throw new ConflictException('Oportunidade encerrada não recebe contrato');
    if (opportunity.stage !== OpportunityStage.CONTRACT)
      throw new UnprocessableEntityException({
        message:
          'O contrato é gerado com a oportunidade na etapa Contrato (depois do aceite da proposta).',
        code: 'WRONG_STAGE',
      });
    const active = await this.prisma.db.contract.findFirst({
      where: { opportunityId, status: { not: 'CANCELLED' } },
    });
    if (active)
      throw new ConflictException({
        message: `Já existe o contrato v${active.version} (${active.status === 'SIGNED' ? 'assinado' : 'em rascunho'}): cancele o rascunho para gerar outro.`,
        code: 'CONTRACT_EXISTS',
      });

    const proposal = input.proposalId
      ? await this.prisma.db.proposal.findFirst({
          where: { id: input.proposalId, opportunityId },
          include: { snapshot: true },
        })
      : await this.prisma.db.proposal.findFirst({
          where: { opportunityId, status: 'ACCEPTED' },
          include: { snapshot: true },
          orderBy: { version: 'desc' },
        });
    if (!proposal?.snapshot)
      throw new UnprocessableEntityException('Não há proposta aceita para gerar o contrato.');
    if (proposal.status !== 'ACCEPTED')
      throw new UnprocessableEntityException(
        'O contrato só pode ser gerado a partir de uma proposta aceita pelo cliente.',
      );

    const content = proposal.snapshot.content as unknown as ProposalContent;
    let scenario = content.scenarios[0];
    if (content.scenarios.length > 1) {
      if (!input.quoteId)
        throw new UnprocessableEntityException({
          message: 'A proposta tem mais de um cenário: informe qual o cliente escolheu.',
          code: 'SCENARIO_REQUIRED',
          data: {
            scenarios: content.scenarios.map((s) => ({ quoteId: s.quoteId, label: s.label })),
          },
        });
      scenario = content.scenarios.find((s) => s.quoteId === input.quoteId);
    } else if (input.quoteId && scenario?.quoteId !== input.quoteId) scenario = undefined;
    if (!scenario)
      throw new UnprocessableEntityException('O cenário informado não pertence a esta proposta.');

    const [tenant, account, site, template] = await Promise.all([
      this.prisma.system.tenant.findUniqueOrThrow({
        where: { id: this.context.requireTenantId() },
        select: { name: true, document: true },
      }),
      this.prisma.db.account.findFirstOrThrow({ where: { id: opportunity.accountId } }),
      opportunity.siteId
        ? this.prisma.db.site.findFirst({ where: { id: opportunity.siteId } })
        : null,
      this.prisma.db.contractTemplate.findFirst({ orderBy: { version: 'desc' } }),
    ]);
    const address =
      input.customerAddress ??
      (site
        ? [
            site.street && `${site.street}${site.number ? `, ${site.number}` : ''}`,
            site.district,
            `${site.city}/${site.state}`,
            site.zip,
          ]
            .filter(Boolean)
            .join(' — ')
        : null);
    const values: Record<string, string | null> = {
      'empresa.nome': tenant.name,
      'empresa.documento': input.companyDocument ?? tenant.document,
      'cliente.nome': account.name,
      'cliente.documento': input.customerDocument ?? account.document,
      'cliente.endereco': address,
      'projeto.codigo': opportunity.projectCode,
      'projeto.potencia_kwp': scenario.installedPowerKwp.toLocaleString('pt-BR', {
        maximumFractionDigits: 2,
      }),
      'projeto.modulos': String(scenario.moduleCount),
      'projeto.geracao_anual_kwh': Math.round(scenario.annualGenerationKwh).toLocaleString('pt-BR'),
      'contrato.valor': money(scenario.priceCents),
      'contrato.pagamento': content.conditions.paymentTerms,
      'contrato.data': new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }),
      'proposta.versao': String(proposal.version),
      'proposta.observacoes': content.conditions.notes,
    };
    // Modelo em Word: preenche o próprio arquivo (a formatação da empresa fica intacta) e gera um .docx.
    let docx: ReturnType<typeof renderDocx> | null = null;
    if (template?.kind === 'DOCX' && template.documentId) {
      try {
        docx = renderDocx((await this.documents.readContent(template.documentId)).buffer, values);
      } catch (error) {
        if (error instanceof DocxTemplateError)
          throw new UnprocessableEntityException(error.message);
        throw error;
      }
    }
    const rendered = docx
      ? { text: docx.text, missing: docx.missing }
      : renderContractTemplate(template?.body ?? DEFAULT_CONTRACT_TEMPLATE, values);

    const row = await this.prisma.db.$transaction(async (tx) => {
      const last = await tx.contract.findFirst({
        where: { opportunityId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.contract.create({
        data: {
          tenantId: this.context.requireTenantId(),
          opportunityId,
          proposalId: proposal.id,
          proposalVersion: proposal.version,
          quoteId: scenario.quoteId,
          scenarioLabel: scenario.label,
          version: (last?.version ?? 0) + 1,
          templateVersion: template?.version ?? null,
          templateIsDefault: !template,
          fileKind: docx ? 'DOCX' : 'PDF',
          body: rendered.text,
          variables: values as object,
          missingVariables: rendered.missing as object,
          valueCents: scenario.priceCents,
          createdById: this.context.userId ?? null,
        },
      });
      await this.timeline.record(
        {
          opportunityId,
          type: TimelineEventType.CONTRACT_GENERATED,
          summary: `Contrato v${created.version} gerado (${money(created.valueCents)})${rendered.missing.length ? ` — faltam ${rendered.missing.length} dado(s)` : ''}`,
          data: { contractId: created.id, version: created.version },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'contract.generated',
          entity: 'Contract',
          entityId: created.id,
          after: {
            opportunityId,
            version: created.version,
            valueCents: created.valueCents,
            templateVersion: created.templateVersion,
          },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.CONTRACT_GENERATED,
          projectCode: opportunity.projectCode,
          payload: { opportunityId, contractId: created.id, version: created.version },
        },
        tx,
      );
      return created;
    });
    await this.attachFile(row, opportunity.projectCode, tenant.name, docx?.buffer ?? null);
    return this.get(row.id);
  }

  async cancel(id: string, input: CancelContractInput): Promise<ContractDto> {
    const row = await this.findOrThrow(id);
    if (row.status !== 'DRAFT')
      throw new ConflictException('Só é possível cancelar um contrato em rascunho.');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason },
      });
      await this.audit.record(
        {
          action: 'contract.cancelled',
          entity: 'Contract',
          entityId: id,
          after: { reason: input.reason },
        },
        tx,
      );
    });
    return this.get(id);
  }

  // ---- Assinatura: contrato assinado → ganho → projeto ----

  async sign(
    id: string,
    file: UploadedFile | undefined,
    input: SignContractData,
  ): Promise<ContractDto> {
    const row = await this.findOrThrow(id);
    if (row.status !== 'DRAFT') throw new ConflictException('Este contrato não está em rascunho.');
    if (!file) throw new BadRequestException('Envie o contrato assinado no campo "file"');
    if (!SIGNED_TYPES.includes(file.mimetype))
      throw new UnprocessableEntityException('O contrato assinado deve ser PDF, PNG ou JPEG');
    const opportunity = await this.opportunities.findOrThrow(row.opportunityId);
    if (opportunity.status !== 'OPEN' || opportunity.stage !== OpportunityStage.CONTRACT)
      throw new ConflictException(
        'A oportunidade precisa estar na etapa Contrato para registrar a assinatura.',
      );
    const signedAt = input.signedAt ?? new Date();
    if (signedAt.getTime() > Date.now() + 86_400_000)
      throw new UnprocessableEntityException('A data da assinatura não pode ser futura');

    const document = await this.documents.upload(file, { entityType: 'Contract', entityId: id });
    const generationClass = await this.generationClassOf(row);

    await this.prisma.db.$transaction(async (tx) => {
      const signed = await tx.contract.update({
        where: { id },
        data: {
          status: 'SIGNED',
          signedAt,
          signedByName: input.signedByName ?? null,
          signedDocumentId: document.id,
          recordedById: this.context.userId ?? null,
        },
      });
      await this.timeline.record(
        {
          opportunityId: opportunity.id,
          type: TimelineEventType.CONTRACT_SIGNED,
          summary: `Contrato v${signed.version} assinado${input.signedByName ? ` por ${input.signedByName}` : ''} (${money(signed.valueCents)})`,
          data: { contractId: id, documentId: document.id },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'contract.signed',
          entity: 'Contract',
          entityId: id,
          after: { documentId: document.id, signedAt, signedByName: input.signedByName ?? null },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.CONTRACT_SIGNED,
          projectCode: opportunity.projectCode,
          payload: { opportunityId: opportunity.id, contractId: id, valueCents: signed.valueCents },
        },
        tx,
      );
      // O ganho só nasce aqui, do contrato assinado; o projeto sai na mesma transação (tudo ou nada).
      await this.opportunities.moveStageWithin(
        tx,
        opportunity,
        OpportunityStage.WON,
        null,
        'contrato assinado',
      );
      await this.events.publish(
        {
          type: DomainEvent.DEAL_WON,
          projectCode: opportunity.projectCode,
          payload: { opportunityId: opportunity.id, contractId: id, valueCents: signed.valueCents },
        },
        tx,
      );
      await this.projects.createFromContract(tx, signed, opportunity, generationClass);
    });
    return this.get(id);
  }

  // ---- Internos ----

  private async generationClassOf(contract: Contract): Promise<GenerationClass | null> {
    const proposal = await this.prisma.db.proposal.findFirst({
      where: { id: contract.proposalId },
      include: { snapshot: true },
    });
    const content = proposal?.snapshot?.content as unknown as ProposalContent | undefined;
    const sessionId = content?.scenarios.find(
      (s) => s.quoteId === contract.quoteId,
    )?.calculationSessionId;
    if (!sessionId) return null;
    const session = await this.prisma.db.calculationSession.findFirst({
      where: { id: sessionId },
      select: { result: true },
    });
    return ((session?.result as { generationClass?: GenerationClass } | null)?.generationClass ??
      null) as GenerationClass | null;
  }

  /** Guarda o arquivo do contrato: o Word já preenchido (modelo enviado) ou o PDF gerado a partir do texto. */
  private async attachFile(
    row: Contract,
    projectCode: string,
    tenantName: string,
    docx: Buffer | null,
  ): Promise<void> {
    try {
      const file = docx
        ? { name: `contrato-${projectCode}-v${row.version}.docx`, mime: DOCX_MIME, buffer: docx }
        : {
            name: `contrato-${projectCode}-v${row.version}.pdf`,
            mime: 'application/pdf',
            buffer: await buildContractPdf({
              title: `Contrato — ${projectCode}`,
              subtitle: tenantName,
              body: row.body,
            }),
          };
      const document = await this.documents.upload(
        {
          originalname: file.name,
          mimetype: file.mime,
          buffer: file.buffer,
          size: file.buffer.length,
        },
        { entityType: 'Contract', entityId: row.id },
      );
      await this.prisma.db.contract.update({
        where: { id: row.id },
        data: { pdfDocumentId: document.id },
      });
    } catch (error) {
      this.logger.error({ err: error, contractId: row.id }, 'Falha ao gerar o arquivo do contrato');
    }
  }

  private async findOrThrow(id: string): Promise<Contract> {
    const row = await this.prisma.db.contract.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Contrato não encontrado');
    return row;
  }

  private toDto(row: Contract, projectId: string | null): ContractDto {
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      proposalId: row.proposalId,
      proposalVersion: row.proposalVersion,
      scenarioLabel: row.scenarioLabel,
      version: row.version,
      status: row.status,
      templateVersion: row.templateVersion,
      templateIsDefault: row.templateIsDefault,
      body: row.body,
      missingVariables: row.missingVariables as unknown as string[],
      valueCents: row.valueCents,
      pdfDocumentId: row.pdfDocumentId,
      fileKind: (row.fileKind === 'DOCX' ? 'DOCX' : 'PDF') as 'PDF' | 'DOCX',
      signedDocumentId: row.signedDocumentId,
      signedAt: row.signedAt?.toISOString() ?? null,
      signedByName: row.signedByName,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      projectId,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
