import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@voltex/database';
import {
  DomainEvent,
  engineRulesDefinitionSchema,
  newOffgridDesign,
  type BatterySpec,
  type ChargeControllerSpec,
  type CreateOffgridProjectInput,
  type EngineeringDecisionInput,
  type EngineeringReviewCommentInput,
  type GeneratorSpec,
  type ListOffgridProjectsQuery,
  type ModuleSpec,
  type OffgridCommentDto,
  type OffgridDesign,
  type OffgridInverterSpec,
  type OffgridProjectDetailDto,
  type OffgridProjectDto,
  type OffgridResults,
  type OffgridSuggestion,
  type OffgridSystemType,
  type OffgridVersionDetailDto,
  type OffgridVersionDto,
  type UpdateOffgridProjectInput,
} from '@voltex/shared';
import {
  computeOffgridResults,
  suggestOffgrid,
  type EquipmentStatusLite,
  type OffgridContext,
  type SuggestCandidate,
} from '@voltex/solar-engine';
import { createHash } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PriceListService } from '../../platform/catalog/price-list.service';
import { ClimateService } from '../../platform/data-hub/climate.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { PrismaService, type ScopedPrismaClient } from '../../platform/prisma/prisma.service';
import { RulesService } from '../../platform/rules/rules.service';
import { OffgridEventsService } from './offgrid-events.service';
import { buildOffgridReportPdf } from './offgrid-report-pdf';

type ProjectRow = Awaited<ReturnType<ScopedPrismaClient['offgridProject']['findFirstOrThrow']>>;
type VersionRow = Awaited<ReturnType<ScopedPrismaClient['offgridVersion']['findFirstOrThrow']>>;

/** Hash estável do documento (chaves ordenadas). */
export function fingerprintOf(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

type EquipmentKind = 'MODULE' | 'BATTERY' | 'CHARGE_CONTROLLER' | 'OFFGRID_INVERTER' | 'GENERATOR';
const ARTICLE: Record<EquipmentKind, string> = {
  MODULE: 'um módulo',
  BATTERY: 'uma bateria',
  CHARGE_CONTROLLER: 'um controlador de carga',
  OFFGRID_INVERTER: 'um inversor off-grid',
  GENERATOR: 'um gerador',
};

/** Equipamentos do catálogo citados no desenho, por tipo. */
export function offgridEquipmentIds(design: OffgridDesign): Record<EquipmentKind, string[]> {
  const modules = new Set<string>();
  for (const array of design.arrays) if (array.moduleId) modules.add(array.moduleId);
  // Os cenários podem trocar o banco: o catálogo de todos entra no contexto.
  const batteries = new Set<string>();
  if (design.bank.batteryId) batteries.add(design.bank.batteryId);
  for (const s of design.scenarios) if (s.bank?.batteryId) batteries.add(s.bank.batteryId);
  return {
    MODULE: [...modules],
    BATTERY: [...batteries],
    CHARGE_CONTROLLER: design.controllerId ? [design.controllerId] : [],
    OFFGRID_INVERTER: design.inverterId ? [design.inverterId] : [],
    GENERATOR: design.generator.generatorId ? [design.generator.generatorId] : [],
  };
}

const toVersionDto = (row: VersionRow): OffgridVersionDto => ({
  id: row.id,
  projectId: row.projectId,
  number: row.number,
  status: row.status,
  design: row.design as unknown as OffgridDesign,
  results: row.results as unknown as OffgridResults | null,
  fingerprint: row.fingerprint,
  stale: row.stale,
  staleReasons: row.staleReasons as string[],
  ruleRefs: row.ruleRefs as string[],
  submittedAt: row.submittedAt?.toISOString() ?? null,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  decisionNote: row.decisionNote,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Projetos off-grid/híbridos e suas versões. Salvar valida os equipamentos (só catálogo **aprovado**), lê a regra
 * `offgrid.design` em vigor, recalcula no servidor (fonte oficial) e guarda o hash. Versão enviada ou decidida é
 * congelada pelo banco; a aprovação gera o snapshot imutável.
 */
@Injectable()
export class OffgridProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly prices: PriceListService,
    private readonly climate: ClimateService,
    private readonly bus: EventBus,
    private readonly timeline: OffgridEventsService,
  ) {}

  // ---- Projetos ----

  private async dto(row: ProjectRow): Promise<OffgridProjectDto> {
    const latest = await this.prisma.db.offgridVersion.findFirst({
      where: { projectId: row.id },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, status: true },
    });
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      systemType: row.systemType as OffgridSystemType,
      status: row.status,
      opportunityId: row.opportunityId,
      responsibleId: row.responsibleId,
      artType: row.artType,
      artNumber: row.artNumber,
      notes: row.notes,
      currentVersion: latest,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(query: ListOffgridProjectsQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.offgridProject.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 25),
        take: query.pageSize ?? 25,
      }),
      this.prisma.db.offgridProject.count({ where }),
    ]);
    const data = await Promise.all(rows.map((r) => this.dto(r)));
    return { data, total, page: query.page ?? 1, pageSize: query.pageSize ?? 25 };
  }

  async requireProject(id: string): Promise<ProjectRow> {
    const row = await this.prisma.db.offgridProject.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Projeto não encontrado');
    return row;
  }

  async detail(id: string): Promise<OffgridProjectDetailDto> {
    const row = await this.requireProject(id);
    const versions = await this.prisma.db.offgridVersion.findMany({
      where: { projectId: id },
      orderBy: { number: 'desc' },
      select: {
        id: true,
        number: true,
        status: true,
        stale: true,
        createdAt: true,
        decidedAt: true,
      },
    });
    const requests = await this.prisma.db.offgridRequest.findMany({
      where: { projectId: id, status: { notIn: ['DONE', 'CANCELLED'] } },
      select: { id: true, title: true, status: true },
    });
    return {
      ...(await this.dto(row)),
      versions: versions.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
        decidedAt: v.decidedAt?.toISOString() ?? null,
      })),
      events: await this.timeline.list({ projectId: id }),
      openRequests: requests,
    };
  }

  private async nextCode(tx: Pick<ScopedPrismaClient, 'offgridProject'>): Promise<string> {
    const year = new Date().getUTCFullYear();
    let seq =
      (await tx.offgridProject.count({ where: { code: { startsWith: `OFG-${year}-` } } })) + 1;
    for (;;) {
      const code = `OFG-${year}-${String(seq).padStart(4, '0')}`;
      if (!(await tx.offgridProject.findFirst({ where: { code }, select: { id: true } })))
        return code;
      seq += 1;
    }
  }

  async create(input: CreateOffgridProjectInput): Promise<OffgridProjectDetailDto> {
    const systemType = input.systemType ?? 'OFFGRID';
    const created = await this.prisma.db.$transaction(async (tx) => {
      if (input.opportunityId) {
        const opportunity = await tx.opportunity.findFirst({
          where: { id: input.opportunityId, deletedAt: null },
          select: { id: true },
        });
        if (!opportunity) throw new NotFoundException('Oportunidade não encontrada');
      }
      let request = null;
      if (input.requestId) {
        request = await tx.offgridRequest.findFirst({ where: { id: input.requestId } });
        if (!request) throw new NotFoundException('Pedido não encontrado');
        if (request.projectId) throw new ConflictException('O pedido já tem um projeto.');
        if (['DONE', 'CANCELLED'].includes(request.status))
          throw new ConflictException('O pedido está encerrado.');
      }
      const project = await tx.offgridProject.create({
        data: {
          tenantId: this.context.requireTenantId(),
          code: await this.nextCode(tx),
          name: input.name,
          systemType: request?.systemType ?? systemType,
          opportunityId: input.opportunityId ?? request?.opportunityId ?? null,
          responsibleId: request?.assigneeId ?? this.context.userId ?? null,
          createdById: this.context.userId ?? null,
        },
      });
      const design = newOffgridDesign(
        input.site,
        request?.systemType === 'HYBRID' ? 'HYBRID' : systemType,
      );
      await tx.offgridVersion.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId: project.id,
          number: 1,
          design: design as unknown as Prisma.InputJsonValue,
          createdById: this.context.userId ?? null,
        },
      });
      if (request)
        await tx.offgridRequest.update({
          where: { id: request.id },
          data: {
            projectId: project.id,
            status: request.status === 'PENDING' ? 'IN_PROGRESS' : request.status,
            assigneeId: request.assigneeId ?? this.context.userId ?? null,
          },
        });
      await this.timeline.record(
        {
          type: 'PROJECT',
          projectId: project.id,
          requestId: request?.id ?? null,
          text: `Projeto ${project.code} criado`,
        },
        tx,
      );
      await this.audit.record(
        { action: 'offgrid.project_created', entity: 'OffgridProject', entityId: project.id },
        tx,
      );
      return project;
    });
    return this.detail(created.id);
  }

  async update(id: string, input: UpdateOffgridProjectInput): Promise<OffgridProjectDetailDto> {
    await this.requireProject(id);
    await this.prisma.db.offgridProject.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.responsibleId !== undefined ? { responsibleId: input.responsibleId } : {}),
        ...(input.artType !== undefined ? { artType: input.artType } : {}),
        ...(input.artNumber !== undefined ? { artNumber: input.artNumber } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    await this.audit.record({
      action: 'offgrid.project_updated',
      entity: 'OffgridProject',
      entityId: id,
      after: input,
    });
    return this.detail(id);
  }

  // ---- Versões ----

  async requireVersion(id: string): Promise<VersionRow> {
    const row = await this.prisma.db.offgridVersion.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Versão não encontrada');
    return row;
  }

  async versionDetail(id: string): Promise<OffgridVersionDetailDto> {
    const row = await this.requireVersion(id);
    const [project, open] = await Promise.all([
      this.prisma.db.offgridProject.findFirstOrThrow({ where: { id: row.projectId } }),
      this.prisma.db.offgridReviewComment.count({ where: { versionId: id, status: 'OPEN' } }),
    ]);
    const design = row.design as unknown as OffgridDesign;
    const ids = Object.values(offgridEquipmentIds(design)).flat();
    const [items, rules] = await Promise.all([
      ids.length
        ? this.prisma.db.equipmentItem.findMany({ where: { id: { in: ids } } })
        : Promise.resolve([]),
      this.designRules(design),
    ]);
    const priceMap = await this.prices.currentPrices(items.map((i) => i.id));
    return {
      ...toVersionDto(row),
      catalog: {
        ruleRef: rules.ref,
        parameters: rules.parameters,
        items: items.map((i) => ({
          id: i.id,
          kind: i.kind,
          status: i.status,
          label: `${i.manufacturer} ${i.model}`,
          spec: i.spec as Record<string, unknown>,
          priceCents: priceMap.get(i.id)?.priceCents ?? i.referenceCostCents,
        })),
      },
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        systemType: project.systemType as OffgridSystemType,
      },
      openComments: open,
      canApprove: row.status === 'SUBMITTED' && !row.stale && open === 0,
    };
  }

  /** Regra `offgrid.design` para o local do projeto (sem regra: vazio, e o cálculo fica pendente). */
  async designRules(design: OffgridDesign) {
    const resolved = await this.rules.resolve('offgrid.design', {
      ...(design.site.state ? { state: design.site.state } : {}),
    });
    if (!resolved) return { ref: null as string | null, parameters: {} as Record<string, number> };
    const definition = engineRulesDefinitionSchema.parse(resolved.definition);
    return { ref: resolved.ref as string | null, parameters: definition.parameters };
  }

  async contextFor(
    design: OffgridDesign,
    options: { requireApproved: boolean } = { requireApproved: true },
  ): Promise<{ context: OffgridContext; ruleRefs: string[] }> {
    const wanted = offgridEquipmentIds(design);
    const ids = Object.values(wanted).flat();
    const items = ids.length
      ? await this.prisma.db.equipmentItem.findMany({ where: { id: { in: ids } } })
      : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const problems: { field: string; message: string }[] = [];
    for (const kind of Object.keys(wanted) as EquipmentKind[])
      for (const id of wanted[kind]) {
        const item = byId.get(id);
        if (!item) problems.push({ field: id, message: 'Equipamento não encontrado no catálogo.' });
        else if (item.kind !== kind)
          problems.push({
            field: id,
            message: `${item.manufacturer} ${item.model} não é ${ARTICLE[kind]}.`,
          });
        else if (options.requireApproved && item.status !== 'APPROVED')
          problems.push({
            field: id,
            message: `${item.manufacturer} ${item.model} não está aprovado no catálogo (situação: ${item.status}).`,
          });
      }
    if (problems.length)
      throw new UnprocessableEntityException({
        message: 'O desenho usa equipamentos que não podem ser usados',
        code: 'EQUIPMENT_NOT_AVAILABLE',
        data: { problems },
      });

    const context: OffgridContext = {
      modules: {},
      batteries: {},
      controllers: {},
      inverters: {},
      generators: {},
      status: {},
      labels: {},
    };
    const status: Record<string, EquipmentStatusLite> = {};
    for (const item of items) {
      status[item.id] = item.status;
      context.labels = { ...context.labels, [item.id]: `${item.manufacturer} ${item.model}` };
      const spec = item.spec as unknown;
      if (item.kind === 'MODULE') context.modules[item.id] = spec as ModuleSpec;
      else if (item.kind === 'BATTERY') context.batteries[item.id] = spec as BatterySpec;
      else if (item.kind === 'CHARGE_CONTROLLER')
        context.controllers[item.id] = spec as ChargeControllerSpec;
      else if (item.kind === 'OFFGRID_INVERTER')
        context.inverters[item.id] = spec as OffgridInverterSpec;
      else if (item.kind === 'GENERATOR') context.generators[item.id] = spec as GeneratorSpec;
    }
    context.status = status;
    const priceMap = await this.prices.currentPrices(items.map((i) => i.id));
    context.prices = Object.fromEntries(
      items.flatMap((item) => {
        const cents = priceMap.get(item.id)?.priceCents ?? item.referenceCostCents;
        return cents === null || cents === undefined ? [] : [[item.id, { unitCostCents: cents }]];
      }),
    );
    const rules = await this.designRules(design);
    context.parameters = rules.parameters;
    if (design.simulation) {
      try {
        const { series } = await this.climate.hourlySeries({
          source: design.simulation.source,
          kind: 'hourly',
          year: design.simulation.year,
          latitude: design.site.latitude,
          longitude: design.site.longitude,
        });
        context.series = series;
      } catch {
        // Sem série o motor usa o ano sintético da climatologia e avisa.
      }
    }
    return { context, ruleRefs: rules.ref ? [rules.ref] : [] };
  }

  async saveDesign(id: string, design: OffgridDesign): Promise<OffgridVersionDetailDto> {
    const version = await this.requireVersion(id);
    if (version.status !== 'DRAFT')
      throw new ConflictException(
        'Só versões em rascunho podem ser editadas; crie uma nova versão.',
      );
    const built = await this.contextFor(design);
    const results = computeOffgridResults(design, built.context);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.offgridVersion.update({
        where: { id },
        data: {
          design: design as unknown as Prisma.InputJsonValue,
          results: results as unknown as Prisma.InputJsonValue,
          fingerprint: fingerprintOf(design),
          ruleRefs: built.ruleRefs,
          stale: false,
          staleReasons: [],
        },
      });
      await tx.offgridProject.update({
        where: { id: version.projectId },
        data: { systemType: design.systemType, updatedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'offgrid.design_saved',
          entity: 'OffgridVersion',
          entityId: id,
          after: { loads: design.loads.length, status: results.status },
        },
        tx,
      );
    });
    return this.versionDetail(id);
  }

  async recalculate(id: string): Promise<OffgridVersionDetailDto> {
    const version = await this.requireVersion(id);
    return this.saveDesign(id, version.design as unknown as OffgridDesign);
  }

  /** Sugere combinações do catálogo aprovado (módulo × bateria × controlador × inversor). */
  async suggest(
    id: string,
    design: OffgridDesign | undefined,
    limit: number,
  ): Promise<OffgridSuggestion[]> {
    const version = await this.requireVersion(id);
    const current = design ?? (version.design as unknown as OffgridDesign);
    const approved = await this.prisma.db.equipmentItem.findMany({
      where: {
        status: 'APPROVED',
        kind: { in: ['MODULE', 'BATTERY', 'CHARGE_CONTROLLER', 'OFFGRID_INVERTER'] },
      },
      take: 400,
    });
    const priceMap = await this.prices.currentPrices(approved.map((i) => i.id));
    const of = <T>(kind: string): SuggestCandidate<T>[] =>
      approved
        .filter((i) => i.kind === kind)
        .map((i) => ({
          id: i.id,
          spec: i.spec as unknown as T,
          priceCents: priceMap.get(i.id)?.priceCents ?? i.referenceCostCents,
        }));
    const rules = await this.designRules(current);
    let series;
    if (current.simulation) {
      try {
        series = (
          await this.climate.hourlySeries({
            source: current.simulation.source,
            kind: 'hourly',
            year: current.simulation.year,
            latitude: current.site.latitude,
            longitude: current.site.longitude,
          })
        ).series;
      } catch {
        series = undefined;
      }
    }
    return suggestOffgrid({
      design: current,
      catalog: {
        modules: of<ModuleSpec>('MODULE'),
        batteries: of<BatterySpec>('BATTERY'),
        controllers: of<ChargeControllerSpec>('CHARGE_CONTROLLER'),
        inverters: of<OffgridInverterSpec>('OFFGRID_INVERTER'),
      },
      context: { parameters: rules.parameters, generators: {}, ...(series ? { series } : {}) },
      limit,
    });
  }

  async submit(id: string): Promise<OffgridVersionDetailDto> {
    const version = await this.requireVersion(id);
    if (version.status !== 'DRAFT')
      throw new ConflictException('Só rascunhos podem ser enviados para revisão.');
    if (!version.results)
      throw new UnprocessableEntityException('Salve e calcule a versão antes de enviá-la.');
    this.assertReady(version.results as unknown as OffgridResults);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.offgridVersion.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedById: this.context.userId ?? null,
        },
      });
      await tx.offgridRequest.updateMany({
        where: { projectId: version.projectId, status: 'IN_PROGRESS' },
        data: { status: 'IN_REVIEW' },
      });
      await this.timeline.record(
        {
          type: 'STATUS',
          projectId: version.projectId,
          text: `Versão ${version.number} enviada para revisão`,
          data: { versionId: id },
        },
        tx,
      );
      await this.audit.record(
        { action: 'offgrid.version_submitted', entity: 'OffgridVersion', entityId: id },
        tx,
      );
    });
    return this.versionDetail(id);
  }

  private assertReady(results: OffgridResults): void {
    if (
      results.pending.length > 0 ||
      results.status === 'INVALID' ||
      results.status === 'INCOMPLETE'
    )
      throw new UnprocessableEntityException(
        'A versão tem verificações inválidas ou pendentes e não pode seguir para aprovação.',
      );
  }

  async comments(versionId: string): Promise<OffgridCommentDto[]> {
    await this.requireVersion(versionId);
    const rows = await this.prisma.db.offgridReviewComment.findMany({
      where: { versionId },
      orderBy: { createdAt: 'asc' },
    });
    const ids = [...new Set(rows.map((r) => r.authorId).filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      section: r.section,
      text: r.text,
      status: r.status,
      authorId: r.authorId,
      authorName: r.authorId ? (names.get(r.authorId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
  }

  async addComment(versionId: string, input: EngineeringReviewCommentInput) {
    const version = await this.requireVersion(versionId);
    if (version.status !== 'SUBMITTED')
      throw new ConflictException('Comentários de revisão exigem versão enviada.');
    const created = await this.prisma.db.offgridReviewComment.create({
      data: {
        tenantId: this.context.requireTenantId(),
        versionId,
        section: input.section,
        text: input.text,
        authorId: this.context.userId ?? null,
      },
    });
    await this.audit.record({
      action: 'offgrid.review_comment_added',
      entity: 'OffgridReviewComment',
      entityId: created.id,
      after: { versionId, section: input.section },
    });
    return (await this.comments(versionId)).find((c) => c.id === created.id);
  }

  async resolveComment(versionId: string, commentId: string) {
    await this.requireVersion(versionId);
    const row = await this.prisma.db.offgridReviewComment.findFirst({
      where: { id: commentId, versionId },
    });
    if (!row) throw new NotFoundException('Comentário não encontrado nesta versão');
    if (row.status === 'OPEN')
      await this.prisma.db.offgridReviewComment.update({
        where: { id: commentId },
        data: {
          status: 'RESOLVED',
          resolvedById: this.context.userId ?? null,
          resolvedAt: new Date(),
        },
      });
    return (await this.comments(versionId)).find((c) => c.id === commentId);
  }

  async approve(
    id: string,
    note: EngineeringDecisionInput['note'],
  ): Promise<OffgridVersionDetailDto> {
    const version = await this.requireVersion(id);
    if (version.status !== 'SUBMITTED')
      throw new ConflictException('Só versões enviadas podem ser aprovadas.');
    if (version.stale)
      throw new UnprocessableEntityException(
        'A versão está desatualizada e precisa ser recalculada.',
      );
    const results = version.results as unknown as OffgridResults | null;
    if (!results)
      throw new UnprocessableEntityException('A versão não possui resultados calculados.');
    this.assertReady(results);
    const open = await this.prisma.db.offgridReviewComment.count({
      where: { versionId: id, status: 'OPEN' },
    });
    if (open)
      throw new UnprocessableEntityException(`Há ${open} comentário(s) de revisão em aberto.`);
    const project = await this.requireProject(version.projectId);
    const design = version.design as unknown as OffgridDesign;
    const ids = Object.values(offgridEquipmentIds(design)).flat();
    const equipment = ids.length
      ? await this.prisma.db.equipmentItem.findMany({ where: { id: { in: ids } } })
      : [];
    const content = {
      version: {
        number: version.number,
        design,
        results,
        fingerprint: version.fingerprint,
        ruleRefs: version.ruleRefs,
      },
      equipment: equipment.map((item) => ({
        id: item.id,
        kind: item.kind,
        manufacturer: item.manufacturer,
        model: item.model,
        revision: item.revision,
        spec: item.spec,
      })),
      approvedAt: new Date().toISOString(),
      approvalNote: note,
    };
    const hash = fingerprintOf(content);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.offgridVersion.updateMany({
        where: { projectId: version.projectId, status: 'APPROVED', id: { not: id } },
        data: { status: 'SUPERSEDED' },
      });
      await tx.offgridVersion.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          decidedById: this.context.userId ?? null,
          decisionNote: note,
        },
      });
      await tx.offgridSnapshot.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId: version.projectId,
          versionId: id,
          content: content as unknown as Prisma.InputJsonValue,
          hash,
          approvedById: this.context.userId ?? null,
        },
      });
      await tx.offgridProject.update({
        where: { id: version.projectId },
        data: { status: 'APPROVED', updatedAt: new Date() },
      });
      await tx.offgridRequest.updateMany({
        where: { projectId: version.projectId, status: { notIn: ['DONE', 'CANCELLED'] } },
        data: {
          status: 'DONE',
          resolvedAt: new Date(),
          resolution: `Versão ${version.number} aprovada`,
        },
      });
      await this.timeline.record(
        {
          type: 'STATUS',
          projectId: version.projectId,
          text: `Versão ${version.number} aprovada`,
          data: { versionId: id },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'offgrid.version_approved',
          entity: 'OffgridVersion',
          entityId: id,
          after: { snapshotHash: hash },
        },
        tx,
      );
      await this.bus.publish(
        {
          type: DomainEvent.OFFGRID_SCENARIO_APPROVED,
          projectCode: project.code,
          payload: { versionId: id, projectId: project.id, snapshotHash: hash, schemaVersion: 1 },
        },
        tx,
      );
    });
    return this.versionDetail(id);
  }

  async reject(
    id: string,
    note: EngineeringDecisionInput['note'],
  ): Promise<OffgridVersionDetailDto> {
    const version = await this.requireVersion(id);
    if (version.status !== 'SUBMITTED')
      throw new ConflictException('Só versões enviadas podem ser recusadas.');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.offgridVersion.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decidedById: this.context.userId ?? null,
          decisionNote: note,
        },
      });
      await tx.offgridRequest.updateMany({
        where: { projectId: version.projectId, status: 'IN_REVIEW' },
        data: { status: 'IN_PROGRESS' },
      });
      await this.timeline.record(
        {
          type: 'STATUS',
          projectId: version.projectId,
          text: `Versão ${version.number} recusada: ${note}`,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'offgrid.version_rejected',
          entity: 'OffgridVersion',
          entityId: id,
          after: { note },
        },
        tx,
      );
    });
    return this.versionDetail(id);
  }

  /** Nova versão em rascunho copiando o desenho da versão indicada. */
  async createFrom(sourceId: string): Promise<OffgridVersionDetailDto> {
    const source = await this.requireVersion(sourceId);
    if (source.status === 'DRAFT')
      throw new ConflictException('Esta versão já é um rascunho: edite-a.');
    const created = await this.prisma.db.$transaction(async (tx) => {
      const draft = await tx.offgridVersion.findFirst({
        where: { projectId: source.projectId, status: 'DRAFT' },
      });
      if (draft)
        throw new ConflictException(
          `O projeto já tem a versão ${draft.number} em rascunho: conclua ou exclua antes.`,
        );
      const last = await tx.offgridVersion.findFirstOrThrow({
        where: { projectId: source.projectId },
        orderBy: { number: 'desc' },
      });
      return tx.offgridVersion.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId: source.projectId,
          number: last.number + 1,
          design: source.design as Prisma.InputJsonValue,
          createdById: this.context.userId ?? null,
        },
      });
    });
    await this.audit.record({
      action: 'offgrid.version_created',
      entity: 'OffgridVersion',
      entityId: created.id,
      after: { from: sourceId },
    });
    return this.recalculate(created.id);
  }

  async deleteDraft(id: string): Promise<void> {
    const version = await this.requireVersion(id);
    if (version.status !== 'DRAFT')
      throw new ConflictException('Só rascunhos podem ser excluídos.');
    const count = await this.prisma.db.offgridVersion.count({
      where: { projectId: version.projectId },
    });
    if (count <= 1) throw new ConflictException('O projeto precisa ter ao menos uma versão.');
    await this.prisma.db.offgridVersion.delete({ where: { id } });
    await this.audit.record({
      action: 'offgrid.version_deleted',
      entity: 'OffgridVersion',
      entityId: id,
    });
  }

  async reportPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const version = await this.requireVersion(id);
    if (!version.results)
      throw new UnprocessableEntityException('Calcule a versão antes de gerar o relatório.');
    const project = await this.requireProject(version.projectId);
    const buffer = await buildOffgridReportPdf({
      projectCode: project.code,
      projectName: project.name,
      version: version.number,
      status: version.status,
      design: version.design as unknown as OffgridDesign,
      results: version.results as unknown as OffgridResults,
    });
    return { buffer, filename: `${project.code}-v${version.number}-offgrid.pdf` };
  }
}
