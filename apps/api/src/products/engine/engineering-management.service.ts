import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@voltex/database';
import {
  generationClassOf,
  loadMonthlyKwh,
  surveyMissing,
  surveySchema,
  type EngineeringEventDto,
  type EngineeringSurveyDto,
  type LoadAnalysisDto,
  type ProjectDocumentItemDto,
  type SurveyData,
  type SurveyInput,
  type UpdateDocumentItemInput,
  type UpdateProjectProfileInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { HomologationRulesService } from '../crm/projects/homologation-rules.service';
import { EngineeringEventsService } from './engineering-events.service';

/**
 * Gestão do projeto de engenharia (9K): ficha do projeto (UC, distribuidora, potência-alvo, ART), levantamento do local,
 * análise de carga e pacote de documentos da solicitação de acesso. Prazos e listas vêm de dado versionado.
 */
@Injectable()
export class EngineeringManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EngineeringEventsService,
    private readonly homologation: HomologationRulesService,
  ) {}

  private async project(id: string) {
    const project = await this.prisma.db.engineeringProject.findFirst({ where: { id } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }

  // ---- Ficha do projeto ----

  async updateProfile(id: string, input: UpdateProjectProfileInput) {
    const project = await this.project(id);
    if (project.status === 'CANCELLED') throw new ConflictException('O projeto foi cancelado');
    // Referências do CRM precisam existir na empresa (o filtro de empresa já vale).
    if (input.siteId) {
      if (!(await this.prisma.db.site.findFirst({ where: { id: input.siteId, deletedAt: null } })))
        throw new UnprocessableEntityException('Imóvel não encontrado');
    }
    if (input.consumerUnitId) {
      if (
        !(await this.prisma.db.consumerUnit.findFirst({
          where: { id: input.consumerUnitId, deletedAt: null },
        }))
      )
        throw new UnprocessableEntityException('Unidade consumidora não encontrada');
    }
    if (input.distributorId) {
      if (!(await this.prisma.db.distributor.findFirst({ where: { id: input.distributorId } })))
        throw new UnprocessableEntityException('Distribuidora não encontrada');
    }
    if (input.responsibleId) {
      if (
        !(await this.prisma.db.user.findFirst({
          where: { id: input.responsibleId, isActive: true, deletedAt: null },
        }))
      )
        throw new UnprocessableEntityException('Responsável não encontrado');
    }
    const data: Prisma.EngineeringProjectUncheckedUpdateInput = {};
    for (const key of [
      'name',
      'siteId',
      'consumerUnitId',
      'distributorId',
      'artType',
      'artNumber',
      'councilRegistration',
      'signatoryName',
      'councilType',
      'councilState',
      'responsibleId',
      'requireSecondReview',
      'notes',
    ] as const)
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    if (input.artIssuedAt !== undefined)
      data.artIssuedAt = input.artIssuedAt === null ? null : new Date(input.artIssuedAt);
    if (input.targetKwp !== undefined) {
      data.targetKwp = input.targetKwp;
      data.generationClass = input.targetKwp === null ? null : generationClassOf(input.targetKwp);
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringProject.update({ where: { id }, data });
      await this.events.record(
        {
          type: 'PROJECT',
          projectId: id,
          text: 'Ficha do projeto atualizada',
          data: { fields: Object.keys(input) },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'engineering.project_profile_updated',
          entity: 'EngineeringProject',
          entityId: id,
          after: input as Record<string, unknown>,
        },
        tx,
      );
    });
    // Mudar a distribuidora ou a classe muda o pacote de documentos.
    if (input.distributorId !== undefined || input.targetKwp !== undefined)
      await this.syncDocumentItems(id);
  }

  async timeline(id: string): Promise<EngineeringEventDto[]> {
    const project = await this.project(id);
    const request = await this.prisma.db.engineeringRequest.findFirst({
      where: { projectId: id },
      select: { id: true },
    });
    return this.events.list({ projectId: project.id, requestId: request?.id ?? null });
  }

  // ---- Levantamento do local ----

  private toSurveyDto(
    row: { status: string; data: unknown; completedAt: Date | null; updatedAt: Date } | null,
  ): EngineeringSurveyDto {
    const data: SurveyData = surveySchema.parse(row?.data ?? {});
    return {
      status: (row?.status as EngineeringSurveyDto['status']) ?? 'DRAFT',
      data,
      missing: surveyMissing(data),
      completedAt: row?.completedAt?.toISOString() ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async getSurvey(projectId: string): Promise<EngineeringSurveyDto> {
    await this.project(projectId);
    return this.toSurveyDto(
      await this.prisma.db.engineeringSurvey.findFirst({ where: { projectId } }),
    );
  }

  async saveSurvey(projectId: string, input: SurveyInput): Promise<EngineeringSurveyDto> {
    await this.project(projectId);
    const existing = await this.prisma.db.engineeringSurvey.findFirst({ where: { projectId } });
    if (existing?.status === 'COMPLETED')
      throw new ConflictException('O levantamento foi concluído. Reabra para editar.');
    const data = surveySchema.parse(input);
    if (data.photoDocumentIds.length) {
      const found = await this.prisma.db.document.count({
        where: { id: { in: data.photoDocumentIds }, deletedAt: null },
      });
      if (found !== data.photoDocumentIds.length)
        throw new UnprocessableEntityException('Algum arquivo do levantamento não foi encontrado');
    }
    const row = await this.prisma.db.engineeringSurvey.upsert({
      where: { projectId },
      create: {
        tenantId: this.context.requireTenantId(),
        projectId,
        data: data as Prisma.InputJsonValue,
        updatedById: this.context.userId ?? null,
      },
      update: { data: data as Prisma.InputJsonValue, updatedById: this.context.userId ?? null },
    });
    return this.toSurveyDto(row);
  }

  /** Conclui o levantamento: exige os dados mínimos (fornecimento, disjuntor, aterramento, local, área, data da visita). */
  async completeSurvey(projectId: string): Promise<EngineeringSurveyDto> {
    await this.project(projectId);
    const row = await this.prisma.db.engineeringSurvey.findFirst({ where: { projectId } });
    const missing = surveyMissing(surveySchema.parse(row?.data ?? {}));
    if (!row || missing.length)
      throw new UnprocessableEntityException({
        message: `Falta no levantamento: ${(row ? missing : ['todo o levantamento']).join('; ')}.`,
        code: 'SURVEY_INCOMPLETE',
        data: { missing },
      });
    const done = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.engineeringSurvey.update({
        where: { projectId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: this.context.userId ?? null,
        },
      });
      await this.events.record(
        { type: 'SURVEY', projectId, text: 'Levantamento do local concluído' },
        tx,
      );
      return updated;
    });
    // Visita concluída libera o pedido que aguardava a visita.
    await this.prisma.db.engineeringRequest.updateMany({
      where: { projectId, status: 'WAITING_VISIT' },
      data: { status: 'IN_PROGRESS' },
    });
    return this.toSurveyDto(done);
  }

  async reopenSurvey(projectId: string): Promise<EngineeringSurveyDto> {
    await this.project(projectId);
    const row = await this.prisma.db.engineeringSurvey.findFirst({ where: { projectId } });
    if (!row) throw new NotFoundException('O levantamento ainda não foi iniciado');
    const reopened = await this.prisma.db.engineeringSurvey.update({
      where: { projectId },
      data: { status: 'DRAFT', completedAt: null, completedById: null },
    });
    await this.events.record({
      type: 'SURVEY',
      projectId,
      text: 'Levantamento reaberto para edição',
    });
    return this.toSurveyDto(reopened);
  }

  // ---- Análise de carga ----

  async loadAnalysis(projectId: string): Promise<LoadAnalysisDto> {
    const project = await this.project(projectId);
    const notes: string[] = [];
    let monthly: { month: string; kwh: number }[] = [];
    let yieldPerKwp: number | null = null;
    if (project.opportunityId) {
      const [snapshot, session] = await Promise.all([
        this.prisma.db.energyBillSnapshot.findFirst({
          where: { bill: { opportunityId: project.opportunityId } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.db.calculationSession.findFirst({
          where: { opportunityId: project.opportunityId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      monthly = [
        ...((
          snapshot?.fields as { consumptionHistory?: { month: string; kwh: number }[] } | undefined
        )?.consumptionHistory ?? []),
      ]
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12);
      const result = (session?.result ?? null) as {
        annualGenerationKwh?: number;
        installedPowerKwp?: number;
      } | null;
      if (result?.annualGenerationKwh && result.installedPowerKwp)
        yieldPerKwp = result.annualGenerationKwh / result.installedPowerKwp;
    }
    if (monthly.length === 0)
      notes.push('Sem fatura validada: o consumo vem só das cargas levantadas na visita.');
    const survey = surveySchema.parse(
      (await this.prisma.db.engineeringSurvey.findFirst({ where: { projectId } }))?.data ?? {},
    );
    const loads = survey.loads.map((l) => ({
      id: l.id,
      name: l.name,
      monthlyKwh: Math.round(loadMonthlyKwh(l) * 10) / 10,
    }));
    const loadsMonthlyKwh = Math.round(loads.reduce((s, l) => s + l.monthlyKwh, 0) * 10) / 10;
    const kwh = monthly.map((m) => m.kwh);
    const averageKwh = kwh.length
      ? Math.round((kwh.reduce((a, b) => a + b, 0) / kwh.length) * 10) / 10
      : null;
    const suggestedKwp =
      averageKwh !== null && yieldPerKwp
        ? Math.round(((averageKwh * 12) / yieldPerKwp) * 100) / 100
        : null;
    if (averageKwh !== null && yieldPerKwp === null)
      notes.push(
        'Sem cálculo preliminar com geração: não há rendimento por kWp para sugerir a potência.',
      );
    if (loadsMonthlyKwh > 0 && averageKwh !== null && loadsMonthlyKwh > averageKwh * 1.5)
      notes.push(
        'As cargas levantadas somam bem mais que o consumo da fatura: confira horas de uso e quantidades.',
      );
    return {
      monthly,
      averageKwh,
      maxKwh: kwh.length ? Math.max(...kwh) : null,
      loads,
      loadsMonthlyKwh,
      annualYieldKwhPerKwp: yieldPerKwp ? Math.round(yieldPerKwp) : null,
      suggestedKwp,
      notes,
    };
  }

  // ---- Pacote de documentos ----

  /** Cria os itens do pacote (checklist da distribuidora ou o padrão da empresa) e mantém os já preenchidos. */
  async syncDocumentItems(projectId: string): Promise<void> {
    const project = await this.project(projectId);
    const rules = await this.homologation.resolve(project.distributorId);
    const mini = project.generationClass === 'MINI' || project.generationClass === 'PLANT';
    const wanted = rules.items.filter((i) => i.condition === 'ALWAYS' || mini);
    const existing = await this.prisma.db.engineeringDocumentItem.findMany({
      where: { projectId },
    });
    const have = new Set(existing.map((e) => e.code));
    for (const [index, item] of wanted.entries()) {
      if (have.has(item.code)) continue;
      await this.prisma.db.engineeringDocumentItem.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId,
          code: item.code,
          title: item.title,
          description: item.description ?? null,
          required: item.required,
          position: index,
          source: `${rules.ref}: ${item.source}`,
        },
      });
    }
    // Itens que só valiam para outra classe saem se ainda estiverem pendentes.
    const wantedCodes = new Set(wanted.map((w) => w.code));
    await this.prisma.db.engineeringDocumentItem.deleteMany({
      where: { projectId, status: 'PENDING', code: { notIn: [...wantedCodes] } },
    });
  }

  async documentItems(projectId: string): Promise<ProjectDocumentItemDto[]> {
    const project = await this.project(projectId);
    await this.syncDocumentItems(projectId);
    const [items, approved, survey] = await Promise.all([
      this.prisma.db.engineeringDocumentItem.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.db.engineeringVersion.findFirst({ where: { projectId, status: 'APPROVED' } }),
      this.prisma.db.engineeringSurvey.findFirst({ where: { projectId } }),
    ]);
    const suggest = (code: string): string | null => {
      if (code === 'SINGLE_LINE' || code === 'MEMORIAL')
        return approved
          ? 'Gerado na versão aprovada (use "Anexar à homologação" na versão).'
          : 'Disponível quando o projeto for aprovado.';
      if (code === 'ART_TRT')
        return project.artNumber
          ? `${project.artType ?? 'ART'} ${project.artNumber} informada na ficha do projeto.`
          : 'Informe o número na ficha do projeto.';
      if (code === 'INVERTER_CERT') return 'Registro INMETRO do inversor no catálogo.';
      if (code === 'SCHEDULE') return 'Exigido só para minigeração.';
      if (code === 'FORM' && survey?.status === 'COMPLETED')
        return 'Dados do levantamento disponíveis para preencher o formulário.';
      return null;
    };
    return items.map((i) => ({
      id: i.id,
      code: i.code,
      title: i.title,
      description: i.description,
      required: i.required,
      position: i.position,
      status: i.status as ProjectDocumentItemDto['status'],
      documentId: i.documentId,
      note: i.note,
      source: i.source,
      suggestion: suggest(i.code),
    }));
  }

  async updateDocumentItem(
    projectId: string,
    code: string,
    input: UpdateDocumentItemInput,
  ): Promise<ProjectDocumentItemDto[]> {
    await this.project(projectId);
    const item = await this.prisma.db.engineeringDocumentItem.findFirst({
      where: { projectId, code },
    });
    if (!item) throw new NotFoundException('Item do pacote não encontrado');
    const status = input.status ?? item.status;
    const note = input.note === undefined ? item.note : input.note;
    if (status === 'NOT_APPLICABLE' && !note?.trim())
      throw new UnprocessableEntityException(
        'Explique na observação por que o item não se aplica.',
      );
    if (input.documentId) {
      if (
        !(await this.prisma.db.document.findFirst({
          where: { id: input.documentId, deletedAt: null },
        }))
      )
        throw new UnprocessableEntityException('O documento informado não foi encontrado');
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringDocumentItem.update({
        where: { id: item.id },
        data: {
          status,
          note,
          ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        },
      });
      await this.events.record(
        {
          type: 'DOCUMENT',
          projectId,
          text: `${item.title}: ${status === 'READY' ? 'pronto' : status === 'NOT_APPLICABLE' ? 'não se aplica' : 'pendente'}`,
        },
        tx,
      );
    });
    return this.documentItems(projectId);
  }
}
