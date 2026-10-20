import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  engineRulesDefinitionSchema,
  type EngineeringDesign,
  type EngineeringResults,
  type EngineeringVersionComparisonDto,
  type EngineeringVersionDetailDto,
  type CableSpec,
  type InverterSpec,
  type ModuleSpec,
  type ProtectionSpec,
  type SpecIssue,
  DomainEvent,
  type EngineeringDecisionInput,
  type EngineeringReviewCommentInput,
} from '@voltex/shared';
import {
  compareVersions,
  computeEngineeringResults,
  validateSpec,
  type Candidate,
  type ComputeContext,
  type EquipmentStatusLite,
  singleLineDxf,
  singleLineSvg,
} from '@voltex/solar-engine';
import { createHash } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PriceListService } from '../../platform/catalog/price-list.service';
import { PrismaService, type ScopedPrismaClient } from '../../platform/prisma/prisma.service';
import { RulesService } from '../../platform/rules/rules.service';
import { ClimateService } from '../../platform/data-hub/climate.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { toProjectDto, toVersionDto } from './engineering.mapper';
import { buildEngineeringReportPdf, buildSingleLinePdf } from './engineering-report-pdf';

type Tx = Pick<
  ScopedPrismaClient,
  'engineeringVersion' | 'engineeringVersionEquipment' | 'engineeringProject' | 'equipmentItem'
>;

/** Hash estável do desenho (chaves ordenadas): identifica o que foi calculado e aprovado. */
export function fingerprintOf(design: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return createHash('sha256')
    .update(JSON.stringify(canonical(design)))
    .digest('hex');
}

/** Ids de equipamento do catálogo citados no desenho (módulos e inversores). */
export function equipmentIdsOf(design: EngineeringDesign): {
  modules: string[];
  inverters: string[];
} {
  const modules = new Set<string>();
  if (design.defaultModuleId) modules.add(design.defaultModuleId);
  for (const surface of design.surfaces) if (surface.moduleId) modules.add(surface.moduleId);
  const inverters = new Set<string>(design.inverters.map((i) => i.inverterId));
  return { modules: [...modules], inverters: [...inverters] };
}

const KIND_ARTICLE = {
  MODULE: 'um módulo',
  INVERTER: 'um inversor',
  PROTECTION: 'uma proteção',
  CABLE: 'um cabo',
} as const;

export interface BuiltContext {
  context: ComputeContext;
  items: Awaited<ReturnType<Tx['equipmentItem']['findMany']>>;
  /** `<id>@<versão>` das regras `engine.design` e `engine.cables` usadas (só as que têm regra ativa). */
  ruleRefs: string[];
  parameters: Record<string, number>;
}

/** Ids de proteção e cabo citados no desenho: trechos de cabo com cabo escolhido e proteções trocadas à mão. */
export function manualCatalogIdsOf(design: EngineeringDesign): {
  protections: string[];
  cables: string[];
} {
  return {
    protections: [...new Set(design.protectionOverrides.map((o) => o.equipmentId))],
    cables: [...new Set(design.cables.flatMap((c) => (c.cableId ? [c.cableId] : [])))],
  };
}

/**
 * Versões do projeto: o desenho é o documento; salvar valida os equipamentos (só catálogo **aprovado**), lê a regra
 * `engine.design` em vigor, recalcula os resultados no servidor (fonte oficial) e guarda o hash. Versão enviada ou
 * decidida é congelada pelo banco.
 */
@Injectable()
export class EngineeringVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly prices: PriceListService,
    private readonly climate: ClimateService,
    private readonly events: EventBus,
  ) {}

  async require(id: string) {
    const row = await this.prisma.db.engineeringVersion.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Versão não encontrada');
    return row;
  }

  /** O que mudou entre duas versões do mesmo projeto (desenho e indicadores), para a revisão. */
  async compare(id: string, otherId: string): Promise<EngineeringVersionComparisonDto> {
    const to = await this.require(id);
    const from = await this.require(otherId);
    if (from.projectId !== to.projectId)
      throw new UnprocessableEntityException({
        message: 'As versões precisam ser do mesmo projeto',
        code: 'VERSIONS_FROM_DIFFERENT_PROJECTS',
      });
    const diff = compareVersions(
      { design: from.design, results: from.results as unknown as EngineeringResults | null },
      { design: to.design, results: to.results as unknown as EngineeringResults | null },
    );
    const brief = (v: typeof from) => ({ id: v.id, number: v.number, status: v.status });
    return {
      from: brief(from),
      to: brief(to),
      designChanges: diff.designChanges,
      resultChanges: diff.resultChanges,
      truncated: diff.truncated,
    };
  }

  /** Parâmetros numéricos da regra `engine.design` para o local do projeto (sem regra: vazio, e o cálculo fica pendente). */
  async designRules(
    design: EngineeringDesign,
  ): Promise<{ ref: string | null; parameters: Record<string, number> }> {
    const resolved = await this.rules.resolve('engine.design', {
      ...(design.site.state ? { state: design.site.state } : {}),
    });
    if (!resolved) return { ref: null, parameters: {} };
    const definition = engineRulesDefinitionSchema.parse(resolved.definition);
    return { ref: resolved.ref, parameters: definition.parameters };
  }

  /** Regra `engine.cables` (parâmetros e tabelas, ex.: capacidade de condução) para o local do projeto. */
  async cableRules(design: EngineeringDesign): Promise<{
    ref: string | null;
    parameters: Record<string, number>;
    tables: Record<string, Record<string, number | string | null>[]>;
  }> {
    const resolved = await this.rules.resolve('engine.cables', {
      ...(design.site.state ? { state: design.site.state } : {}),
    });
    if (!resolved) return { ref: null, parameters: {}, tables: {} };
    const definition = engineRulesDefinitionSchema.parse(resolved.definition);
    return { ref: resolved.ref, parameters: definition.parameters, tables: definition.tables };
  }

  /** Regras condicionais de conexão, resolvidas pelo mesmo escopo da regra de projeto. */
  async connectionRules(design: EngineeringDesign): Promise<{
    ref: string | null;
    rules: import('@voltex/shared').ConditionalRule[];
  }> {
    const resolved = await this.rules.resolve('engine.connection', {
      ...(design.site.state ? { state: design.site.state } : {}),
    });
    if (!resolved) return { ref: null, rules: [] };
    const definition = engineRulesDefinitionSchema.parse(resolved.definition);
    return { ref: resolved.ref, rules: definition.rules };
  }

  async economicsRules(design: EngineeringDesign): Promise<{
    ref: string | null;
    parameters: Record<string, number>;
  }> {
    const resolved = await this.rules.resolve('engine.economics', {
      ...(design.site.state ? { state: design.site.state } : {}),
    });
    if (!resolved) return { ref: null, parameters: {} };
    const definition = engineRulesDefinitionSchema.parse(resolved.definition);
    return { ref: resolved.ref, parameters: definition.parameters };
  }

  /** Proteções e cabos aprovados do catálogo, com nome e custo, e os preços unitários de tudo que entra na lista. */
  async catalogExtras(design: EngineeringDesign, usedItems: { id: string }[]) {
    const approved = await this.prisma.db.equipmentItem.findMany({
      where: { kind: { in: ['PROTECTION', 'CABLE'] }, status: 'APPROVED' },
      orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
      take: 300,
    });
    const labels: Record<string, string> = {};
    const prices: Record<string, { cents: number; source: 'PRICE_LIST' | 'REFERENCE' }> = {};
    // Itens usados e escolhidos à mão que não estão entre os aprovados (aposentados ainda aparecem na conferência).
    const approvedIds = new Set(approved.map((a) => a.id));
    const manual = manualCatalogIdsOf(design);
    const extraIds = [
      ...new Set(
        [...usedItems.map((i) => i.id), ...manual.protections, ...manual.cables].filter(
          (id) => !approvedIds.has(id),
        ),
      ),
    ];
    const extra = extraIds.length
      ? await this.prisma.db.equipmentItem.findMany({ where: { id: { in: extraIds } } })
      : [];
    // Uma consulta de preços para todos (antes era uma por item aprovado).
    const lists = await this.prices.currentPrices([...approved, ...extra].map((i) => i.id));
    const price = (item: {
      id: string;
      manufacturer: string;
      model: string;
      referenceCostCents: number | null;
    }): number | null => {
      labels[item.id] = `${item.manufacturer} ${item.model}`;
      const current = lists.get(item.id);
      if (current) prices[item.id] = { cents: current.priceCents, source: 'PRICE_LIST' };
      else if (item.referenceCostCents !== null)
        prices[item.id] = { cents: item.referenceCostCents, source: 'REFERENCE' };
      return prices[item.id]?.cents ?? null;
    };
    const candidates = approved.map((item) => ({
      id: item.id,
      kind: item.kind as 'PROTECTION' | 'CABLE',
      label: `${item.manufacturer} ${item.model}`,
      costCents: price(item),
      spec: item.spec as Record<string, unknown>,
    }));
    for (const item of extra) price(item);
    return { candidates, labels, prices };
  }

  /**
   * Carrega os equipamentos citados e monta o contexto do cálculo. Com `requireApproved`, módulo ou inversor que não
   * esteja aprovado no catálogo é recusado (salvar); sem ele (recalcular uma versão antiga) a situação vai para o cálculo,
   * que aponta `MODULE_NOT_APPROVED` / `INVERTER_NOT_APPROVED`.
   */
  async contextFor(
    design: EngineeringDesign,
    options: { requireApproved: boolean } = { requireApproved: true },
  ): Promise<BuiltContext> {
    const { modules: moduleIds, inverters: inverterIds } = equipmentIdsOf(design);
    const manual = manualCatalogIdsOf(design);
    const ids = [...moduleIds, ...inverterIds, ...manual.protections, ...manual.cables];
    const items = ids.length
      ? await this.prisma.db.equipmentItem.findMany({ where: { id: { in: ids } } })
      : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const problems: { field: string; message: string }[] = [];
    const expect = (id: string, kind: 'MODULE' | 'INVERTER' | 'PROTECTION' | 'CABLE') => {
      const item = byId.get(id);
      if (!item) problems.push({ field: id, message: 'Equipamento não encontrado no catálogo.' });
      else if (item.kind !== kind)
        problems.push({
          field: id,
          message: `${item.manufacturer} ${item.model} não é ${KIND_ARTICLE[kind]}.`,
        });
      else if (options.requireApproved && item.status !== 'APPROVED')
        problems.push({
          field: id,
          message: `${item.manufacturer} ${item.model} não está aprovado no catálogo (situação: ${item.status}).`,
        });
    };
    for (const id of moduleIds) expect(id, 'MODULE');
    for (const id of inverterIds) expect(id, 'INVERTER');
    for (const id of manual.protections) expect(id, 'PROTECTION');
    for (const id of manual.cables) expect(id, 'CABLE');
    if (problems.length)
      throw new UnprocessableEntityException({
        message: 'O desenho usa equipamentos que não podem ser usados',
        code: 'EQUIPMENT_NOT_AVAILABLE',
        data: { problems },
      });

    const modules: ComputeContext['modules'] = {};
    const inverters: Record<string, InverterSpec> = {};
    const status: Record<string, EquipmentStatusLite> = {};
    for (const item of items) {
      status[item.id] = item.status;
      if (item.kind === 'MODULE') modules[item.id] = item.spec as unknown as ModuleSpec;
      else if (item.kind === 'INVERTER') inverters[item.id] = item.spec as unknown as InverterSpec;
    }
    const [rules, cableRules, connectionRules, economicsRules, extras] = await Promise.all([
      this.designRules(design),
      this.cableRules(design),
      this.connectionRules(design),
      this.economicsRules(design),
      this.catalogExtras(design, items),
    ]);
    let simulation: ComputeContext['simulation'];
    if (design.simulation) {
      try {
        const { series } = await this.climate.hourlySeries({
          source: design.simulation.source,
          kind: 'hourly',
          year: design.simulation.year,
          latitude: design.site.latitude,
          longitude: design.site.longitude,
        });
        simulation = {
          series,
          lossFraction: design.simulation.lossPct / 100,
          inverterEfficiencyPct: design.simulation.inverterEfficiencyPct,
          pvgisReferenceEnergyKwh: design.simulation.pvgisReferenceEnergyKwh,
          calculatorReferenceEnergyKwh: design.simulation.calculatorReferenceEnergyKwh,
          ...(design.simulation.albedo !== undefined ? { albedo: design.simulation.albedo } : {}),
          comparisonWarningPct: design.simulation.comparisonWarningPct,
        };
      } catch {
        // A versão continua salvável: o resultado deixa clara a ausência da série e não usa dado velho/implícito.
        simulation = undefined;
      }
    }
    const asCandidates = <T>(kind: 'PROTECTION' | 'CABLE'): Candidate<T>[] =>
      extras.candidates
        .filter((c) => c.kind === kind)
        .map((c) => ({
          id: c.id,
          spec: c.spec as unknown as T,
          costCents: c.costCents,
          label: c.label,
        }));
    for (const item of items) extras.labels[item.id] ??= `${item.manufacturer} ${item.model}`;
    return {
      context: {
        modules,
        inverters,
        status,
        parameters: rules.parameters,
        protections: asCandidates<ProtectionSpec>('PROTECTION'),
        cableCatalog: asCandidates<CableSpec>('CABLE'),
        cableRules: { parameters: cableRules.parameters, tables: cableRules.tables },
        labels: extras.labels,
        prices: extras.prices,
        connectionRules: connectionRules.rules,
        economicsParameters: economicsRules.parameters,
        simulation,
      },
      items,
      ruleRefs: [rules.ref, cableRules.ref, connectionRules.ref, economicsRules.ref].filter(
        (r): r is string => r !== null,
      ),
      parameters: rules.parameters,
    };
  }

  /** Recalcula e grava. Só rascunho. */
  async saveDesign(id: string, design: EngineeringDesign): Promise<EngineeringVersionDetailDto> {
    const version = await this.require(id);
    if (version.status !== 'DRAFT')
      throw new ConflictException(
        'Só versões em rascunho podem ser editadas; crie uma nova versão.',
      );
    const built = await this.contextFor(design);
    const results = computeEngineeringResults(design, built.context);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringVersion.update({
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
      await this.syncEquipment(tx, id, design, results);
      await tx.engineeringProject.update({
        where: { id: version.projectId },
        data: { updatedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'engineering.design_saved',
          entity: 'EngineeringVersion',
          entityId: id,
          after: {
            surfaces: design.surfaces.length,
            inverters: design.inverters.length,
            modules: results.totals.moduleCount,
            compatibility: results.compatibility.status,
          },
        },
        tx,
      );
    });
    return this.detail(id);
  }

  /** Recalcula sem mudar o desenho (ex.: depois de uma regra ou ficha atualizada). */
  async recalculate(id: string): Promise<EngineeringVersionDetailDto> {
    const version = await this.require(id);
    return this.saveDesign(id, version.design as unknown as EngineeringDesign);
  }

  private async syncEquipment(
    tx: Tx,
    versionId: string,
    design: EngineeringDesign,
    results: EngineeringResults,
  ) {
    await tx.engineeringVersionEquipment.deleteMany({ where: { versionId } });
    const quantities = new Map<string, { kind: string; quantity: number }>();
    const add = (id: string, kind: string, quantity: number) =>
      quantities.set(id, { kind, quantity: (quantities.get(id)?.quantity ?? 0) + quantity });
    for (const layout of results.layout)
      if (layout.moduleId) add(layout.moduleId, 'MODULE', layout.moduleCount);
    for (const entry of design.inverters)
      add(entry.inverterId, 'INVERTER', entry.micro ? entry.micro.units : 1);
    for (const line of results.bom.lines)
      if (line.equipmentId && (line.category === 'PROTECTION' || line.category === 'CABLE'))
        add(line.equipmentId, line.category, Math.ceil(line.quantity));
    const { modules, inverters } = equipmentIdsOf(design);
    const others = [...quantities.entries()]
      .filter(([, q]) => q.kind === 'PROTECTION' || q.kind === 'CABLE')
      .map(([id]) => id);
    for (const equipmentId of [...modules, ...inverters, ...others]) {
      const q = quantities.get(equipmentId);
      await tx.engineeringVersionEquipment.create({
        data: {
          tenantId: this.context.requireTenantId(),
          versionId,
          equipmentId,
          kind: q?.kind ?? (modules.includes(equipmentId) ? 'MODULE' : 'INVERTER'),
          quantity: Math.max(1, q?.quantity ?? 0),
        },
      });
    }
  }

  async submit(id: string): Promise<EngineeringVersionDetailDto> {
    const version = await this.require(id);
    if (version.status !== 'DRAFT')
      throw new ConflictException('Só rascunhos podem ser enviados para revisão.');
    if (!version.results)
      throw new UnprocessableEntityException('Salve e calcule a versão antes de enviá-la.');
    const results = version.results as unknown as EngineeringResults;
    this.assertResultsReady(results);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringVersion.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        { action: 'engineering.version_submitted', entity: 'EngineeringVersion', entityId: id },
        tx,
      );
    });
    return this.detail(id);
  }

  async comments(versionId: string) {
    await this.require(versionId);
    return this.prisma.db.engineeringReviewComment.findMany({
      where: { versionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        section: true,
        text: true,
        status: true,
        authorId: true,
        resolvedById: true,
        resolvedAt: true,
        createdAt: true,
      },
    });
  }

  async addComment(versionId: string, input: EngineeringReviewCommentInput) {
    const version = await this.require(versionId);
    if (version.status !== 'SUBMITTED')
      throw new ConflictException('Comentários de revisão exigem versão enviada.');
    const created = await this.prisma.db.engineeringReviewComment.create({
      data: {
        tenantId: this.context.requireTenantId(),
        versionId,
        section: input.section,
        text: input.text,
        authorId: this.context.userId ?? null,
      },
    });
    await this.audit.record({
      action: 'engineering.review_comment_added',
      entity: 'EngineeringReviewComment',
      entityId: created.id,
      after: { versionId, section: input.section },
    });
    return created;
  }

  async resolveComment(versionId: string, commentId: string) {
    await this.require(versionId);
    const row = await this.prisma.db.engineeringReviewComment.findFirst({
      where: { id: commentId, versionId },
    });
    if (!row) throw new NotFoundException('Comentário não encontrado nesta versão');
    if (row.status === 'RESOLVED') return row;
    const updated = await this.prisma.db.engineeringReviewComment.update({
      where: { id: commentId },
      data: {
        status: 'RESOLVED',
        resolvedById: this.context.userId ?? null,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record({
      action: 'engineering.review_comment_resolved',
      entity: 'EngineeringReviewComment',
      entityId: commentId,
    });
    return updated;
  }

  async approve(
    id: string,
    note: EngineeringDecisionInput['note'],
  ): Promise<EngineeringVersionDetailDto> {
    const version = await this.require(id);
    if (version.status !== 'SUBMITTED')
      throw new ConflictException('Só versões enviadas podem ser aprovadas.');
    if (version.stale)
      throw new UnprocessableEntityException(
        'A versão está desatualizada e precisa ser recalculada.',
      );
    const results = version.results as unknown as EngineeringResults | null;
    if (!results)
      throw new UnprocessableEntityException('A versão não possui resultados calculados.');
    this.assertResultsReady(results);
    const open = await this.prisma.db.engineeringReviewComment.count({
      where: { versionId: id, status: 'OPEN' },
    });
    if (open)
      throw new UnprocessableEntityException(`Há ${open} comentário(s) de revisão em aberto.`);
    const project = await this.prisma.db.engineeringProject.findFirstOrThrow({
      where: { id: version.projectId },
    });
    const equipment = await this.prisma.db.equipmentItem.findMany({
      where: {
        id: {
          in: (
            await this.prisma.db.engineeringVersionEquipment.findMany({
              where: { versionId: id },
              select: { equipmentId: true },
            })
          ).map((row) => row.equipmentId),
        },
      },
    });
    const content = {
      version: {
        number: version.number,
        design: version.design,
        results,
        fingerprint: version.fingerprint,
        ruleRefs: version.ruleRefs,
        dataRefs: version.dataRefs,
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
      // O índice parcial permite uma só aprovada: aposenta a anterior antes de promover a nova.
      await tx.engineeringVersion.updateMany({
        where: { projectId: version.projectId, status: 'APPROVED', id: { not: id } },
        data: { status: 'SUPERSEDED' },
      });
      await tx.engineeringVersion.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          decidedById: this.context.userId ?? null,
          decisionNote: note,
        },
      });
      await tx.engineeringSnapshot.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId: version.projectId,
          versionId: id,
          content: content as unknown as Prisma.InputJsonValue,
          hash,
          approvedById: this.context.userId ?? null,
        },
      });
      await tx.engineeringProject.update({
        where: { id: version.projectId },
        data: { status: 'APPROVED', updatedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'engineering.version_approved',
          entity: 'EngineeringVersion',
          entityId: id,
          after: { snapshotHash: hash },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.ENGINEERING_VERSION_APPROVED,
          projectCode: project.code,
          payload: { versionId: id, projectId: project.id, snapshotHash: hash, schemaVersion: 1 },
        },
        tx,
      );
    });
    return this.detail(id);
  }

  async reject(
    id: string,
    note: EngineeringDecisionInput['note'],
  ): Promise<EngineeringVersionDetailDto> {
    const version = await this.require(id);
    if (version.status !== 'SUBMITTED')
      throw new ConflictException('Só versões enviadas podem ser recusadas.');
    await this.prisma.db.engineeringVersion.update({
      where: { id },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(),
        decidedById: this.context.userId ?? null,
        decisionNote: note,
      },
    });
    await this.audit.record({
      action: 'engineering.version_rejected',
      entity: 'EngineeringVersion',
      entityId: id,
      after: { note },
    });
    return this.detail(id);
  }

  private assertResultsReady(results: EngineeringResults) {
    const status = [
      results.compatibility.status,
      results.protection.status,
      results.cables.status,
      results.simulation?.status,
      results.connection?.status,
      results.economics?.status,
    ];
    if (
      results.pending.length ||
      status.some((value) => value === 'INVALID' || value === 'INCOMPLETE' || value === undefined)
    )
      throw new UnprocessableEntityException(
        'A versão tem verificações inválidas ou pendentes e não pode seguir para aprovação.',
      );
  }

  /** Nova versão em rascunho, copiando o desenho da versão indicada (cópia na escrita). */
  async createFrom(sourceId: string) {
    const source = await this.require(sourceId);
    if (source.status === 'DRAFT')
      throw new ConflictException('Esta versão já é um rascunho: edite-a.');
    return this.prisma.db.$transaction(async (tx) => {
      const draft = await tx.engineeringVersion.findFirst({
        where: { projectId: source.projectId, status: 'DRAFT' },
      });
      if (draft)
        throw new ConflictException(
          `O projeto já tem a versão ${draft.number} em rascunho: conclua ou exclua antes.`,
        );
      const last = await tx.engineeringVersion.findFirstOrThrow({
        where: { projectId: source.projectId },
        orderBy: { number: 'desc' },
      });
      const created = await tx.engineeringVersion.create({
        data: {
          tenantId: this.context.requireTenantId(),
          projectId: source.projectId,
          number: last.number + 1,
          design: source.design as Prisma.InputJsonValue,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'engineering.version_created',
          entity: 'EngineeringVersion',
          entityId: created.id,
          after: { number: created.number, copiedFrom: source.number },
        },
        tx,
      );
      return created;
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const version = await this.require(id);
    if (version.status !== 'DRAFT') throw new ConflictException('Só rascunhos podem ser excluídos');
    const count = await this.prisma.db.engineeringVersion.count({
      where: { projectId: version.projectId },
    });
    if (count === 1) throw new ConflictException('O projeto precisa de ao menos uma versão');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringVersion.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'engineering.version_deleted',
          entity: 'EngineeringVersion',
          entityId: id,
          before: { number: version.number },
        },
        tx,
      );
    });
    return { id };
  }

  /** Versão com o projeto, as regras em vigor e as fichas dos equipamentos usados (para o editor calcular no navegador). */
  async detail(id: string): Promise<EngineeringVersionDetailDto> {
    const row = await this.require(id);
    const project = await this.prisma.db.engineeringProject.findFirstOrThrow({
      where: { id: row.projectId },
    });
    const design = row.design as unknown as EngineeringDesign;
    const { modules, inverters } = equipmentIdsOf(design);
    const manual = manualCatalogIdsOf(design);
    const ids = [...modules, ...inverters, ...manual.protections, ...manual.cables];
    const items = ids.length
      ? await this.prisma.db.equipmentItem.findMany({ where: { id: { in: ids } } })
      : [];
    const [latest, approved, request, rules, cableRules, extras] = await Promise.all([
      this.prisma.db.engineeringVersion.findFirst({
        where: { projectId: project.id },
        orderBy: { number: 'desc' },
      }),
      this.prisma.db.engineeringVersion.findFirst({
        where: { projectId: project.id, status: 'APPROVED' },
      }),
      this.prisma.db.engineeringRequest.findFirst({ where: { projectId: project.id } }),
      this.designRules(design),
      this.cableRules(design),
      this.catalogExtras(design, items),
    ]);
    for (const item of items) extras.labels[item.id] ??= `${item.manufacturer} ${item.model}`;
    return {
      ...toVersionDto(row),
      project: toProjectDto(project, {
        requestId: request?.id ?? null,
        responsibleName: null,
        latest,
        approvedVersionId: approved?.id ?? null,
      }),
      rules: { engineDesign: rules, engineCables: cableRules },
      candidates: extras.candidates,
      prices: extras.prices,
      labels: extras.labels,
      equipment: items.map((i) => ({
        id: i.id,
        kind: i.kind,
        manufacturer: i.manufacturer,
        model: i.model,
        status: i.status,
        spec: i.spec as Record<string, unknown>,
        issues: validateSpec(i.kind, i.spec) as SpecIssue[],
      })),
    };
  }

  async singleLine(id: string, format: 'svg' | 'dxf'): Promise<string> {
    const version = await this.require(id);
    const results = version.results as unknown as EngineeringResults | null;
    if (!results)
      throw new UnprocessableEntityException('Calcule a versão antes de gerar o unifilar.');
    const design = version.design as unknown as EngineeringDesign;
    return format === 'svg' ? singleLineSvg(design, results) : singleLineDxf(design, results);
  }

  /** Memorial em PDF, sempre derivado da versão congelada (ou do rascunho recalculado). */
  async reportPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const version = await this.require(id);
    const results = version.results as unknown as EngineeringResults | null;
    if (!results)
      throw new UnprocessableEntityException('Calcule a versão antes de gerar o memorial técnico.');
    const project = await this.prisma.db.engineeringProject.findFirst({
      where: { id: version.projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const buffer = await buildEngineeringReportPdf({
      projectCode: project.code,
      projectName: project.name,
      version: version.number,
      status: version.status,
      design: version.design as unknown as EngineeringDesign,
      results,
    });
    return { buffer, filename: `memorial-${project.code}-v${version.number}.pdf` };
  }

  async singleLinePdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const version = await this.require(id);
    const results = version.results as unknown as EngineeringResults | null;
    if (!results)
      throw new UnprocessableEntityException('Calcule a versão antes de gerar o unifilar.');
    const project = await this.prisma.db.engineeringProject.findFirst({
      where: { id: version.projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const buffer = await buildSingleLinePdf({
      projectCode: project.code,
      projectName: project.name,
      version: version.number,
      status: version.status,
      design: version.design as unknown as EngineeringDesign,
      results,
    });
    return { buffer, filename: `unifilar-${project.code}-v${version.number}.pdf` };
  }

  async approvedSnapshot(projectId: string) {
    const project = await this.prisma.db.engineeringProject.findFirst({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const snapshot = await this.prisma.db.engineeringSnapshot.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    if (!snapshot) throw new NotFoundException('O projeto ainda não tem snapshot aprovado');
    return {
      id: snapshot.id,
      projectId,
      versionId: snapshot.versionId,
      hash: snapshot.hash,
      content: snapshot.content,
      createdAt: snapshot.createdAt.toISOString(),
    };
  }
}
