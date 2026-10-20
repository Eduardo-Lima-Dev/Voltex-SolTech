import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  type EngineeringDesign,
  type EngineeringResults,
  type EngineeringVersionDetailDto,
  type SpecIssue,
} from '@voltex/shared';
import { computeEngineeringResults, validateSpec, type ComputeContext } from '@voltex/solar-engine';
import { createHash } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService, type ScopedPrismaClient } from '../../platform/prisma/prisma.service';
import { toProjectDto, toVersionDto } from './engineering.mapper';

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

/** Ids de equipamento do catálogo citados no desenho. */
export function equipmentIdsOf(design: EngineeringDesign): string[] {
  const ids = new Set<string>();
  if (design.defaultModuleId) ids.add(design.defaultModuleId);
  for (const surface of design.surfaces) if (surface.moduleId) ids.add(surface.moduleId);
  return [...ids];
}

/**
 * Versões do projeto: o desenho é o documento; salvar valida os equipamentos (só catálogo **aprovado**), recalcula os
 * resultados no servidor (fonte oficial) e guarda o hash. Versão enviada ou decidida é congelada pelo banco.
 */
@Injectable()
export class EngineeringVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async require(id: string) {
    const row = await this.prisma.db.engineeringVersion.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Versão não encontrada');
    return row;
  }

  /** Carrega os módulos citados e monta o contexto do cálculo. Equipamento fora do catálogo aprovado é recusado. */
  async contextFor(
    design: EngineeringDesign,
    client: Pick<ScopedPrismaClient, 'equipmentItem'> = this.prisma.db,
    options: { requireApproved: boolean } = { requireApproved: true },
  ): Promise<{
    context: ComputeContext;
    items: Awaited<ReturnType<Tx['equipmentItem']['findMany']>>;
  }> {
    const ids = equipmentIdsOf(design);
    const items = ids.length
      ? await client.equipmentItem.findMany({ where: { id: { in: ids } } })
      : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const problems: { field: string; message: string }[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) problems.push({ field: id, message: 'Equipamento não encontrado no catálogo.' });
      else if (item.kind !== 'MODULE')
        problems.push({
          field: id,
          message: `${item.manufacturer} ${item.model} não é um módulo.`,
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
    const modules: ComputeContext['modules'] = {};
    for (const item of items) {
      const spec = item.spec as { lengthMm: number; widthMm: number; pmaxWp: number };
      modules[item.id] = { lengthMm: spec.lengthMm, widthMm: spec.widthMm, pmaxWp: spec.pmaxWp };
    }
    return { context: { modules }, items };
  }

  /** Recalcula e grava. Só rascunho. */
  async saveDesign(id: string, design: EngineeringDesign): Promise<EngineeringVersionDetailDto> {
    const version = await this.require(id);
    if (version.status !== 'DRAFT')
      throw new ConflictException(
        'Só versões em rascunho podem ser editadas; crie uma nova versão.',
      );
    const { context } = await this.contextFor(design);
    const results = computeEngineeringResults(design, context);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringVersion.update({
        where: { id },
        data: {
          design: design as unknown as Prisma.InputJsonValue,
          results: results as unknown as Prisma.InputJsonValue,
          fingerprint: fingerprintOf(design),
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
          after: { surfaces: design.surfaces.length, modules: results.totals.moduleCount },
        },
        tx,
      );
    });
    return this.detail(id);
  }

  /** Recalcula sem mudar o desenho (ex.: depois de uma correção no motor). */
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
    const quantities = new Map<string, number>();
    for (const layout of results.layout)
      if (layout.moduleId)
        quantities.set(
          layout.moduleId,
          (quantities.get(layout.moduleId) ?? 0) + layout.moduleCount,
        );
    for (const equipmentId of equipmentIdsOf(design))
      await tx.engineeringVersionEquipment.create({
        data: {
          tenantId: this.context.requireTenantId(),
          versionId,
          equipmentId,
          kind: 'MODULE',
          quantity: Math.max(1, quantities.get(equipmentId) ?? 0),
        },
      });
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

  /** Versão com o projeto e as fichas dos equipamentos usados (para o editor calcular no navegador). */
  async detail(id: string): Promise<EngineeringVersionDetailDto> {
    const row = await this.require(id);
    const project = await this.prisma.db.engineeringProject.findFirstOrThrow({
      where: { id: row.projectId },
    });
    const design = row.design as unknown as EngineeringDesign;
    const ids = equipmentIdsOf(design);
    const items = ids.length
      ? await this.prisma.db.equipmentItem.findMany({ where: { id: { in: ids } } })
      : [];
    const [latest, approved, request] = await Promise.all([
      this.prisma.db.engineeringVersion.findFirst({
        where: { projectId: project.id },
        orderBy: { number: 'desc' },
      }),
      this.prisma.db.engineeringVersion.findFirst({
        where: { projectId: project.id, status: 'APPROVED' },
      }),
      this.prisma.db.engineeringRequest.findFirst({ where: { projectId: project.id } }),
    ]);
    return {
      ...toVersionDto(row),
      project: toProjectDto(project, {
        requestId: request?.id ?? null,
        responsibleName: null,
        latest,
        approvedVersionId: approved?.id ?? null,
      }),
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
}
