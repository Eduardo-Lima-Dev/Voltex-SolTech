import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_PIPELINE_STAGES,
  type CreateCustomStageInput,
  type CustomStageDto,
  type PipelineStageDto,
  type UpdateCustomStageInput,
  type UpdatePipelineStageInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';

/**
 * Etapas do pipeline do tenant. As chaves seguem a máquina de estados (fixas); nomes e ordem são do tenant.
 * O pipeline padrão é criado na primeira consulta.
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PipelineStageDto[]> {
    let rows = await this.prisma.db.pipelineStage.findMany({
      orderBy: [{ order: 'asc' }, { key: 'asc' }],
    });
    if (rows.length === 0) {
      const tenantId = this.context.requireTenantId();
      await this.prisma.db.pipelineStage.createMany({
        data: DEFAULT_PIPELINE_STAGES.map((s) => ({
          tenantId,
          key: s.key,
          name: s.name,
          order: s.order,
          terminal: s.terminal,
        })),
        skipDuplicates: true,
      });
      rows = await this.prisma.db.pipelineStage.findMany({
        orderBy: [{ order: 'asc' }, { key: 'asc' }],
      });
    }
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      order: r.order,
      terminal: r.terminal,
      hidden: r.hidden,
    }));
  }

  async updateStage(id: string, input: UpdatePipelineStageInput): Promise<PipelineStageDto> {
    const before = await this.prisma.db.pipelineStage.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Etapa não encontrada');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.pipelineStage.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.order ? { order: input.order } : {}),
          ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'pipeline.stage_updated',
          entity: 'PipelineStage',
          entityId: id,
          before: { name: before.name, order: before.order, hidden: before.hidden },
          after: { name: updated.name, order: updated.order, hidden: updated.hidden },
        },
        tx,
      );
      return updated;
    });
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      order: row.order,
      terminal: row.terminal,
      hidden: row.hidden,
    };
  }

  // ---- Colunas personalizadas da empresa ----

  async customStages(): Promise<CustomStageDto[]> {
    const rows = await this.prisma.db.customPipelineStage.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toCustomDto);
  }

  async findCustom(id: string): Promise<CustomStageDto> {
    const row = await this.prisma.db.customPipelineStage.findFirst({ where: { id } });
    if (!row) throw new UnprocessableEntityException('A coluna escolhida não existe mais');
    return toCustomDto(row);
  }

  async createCustom(input: CreateCustomStageInput): Promise<CustomStageDto> {
    const tenantId = this.context.requireTenantId();
    await this.list(); // garante as etapas padrão do tenant
    const last = await this.prisma.db.customPipelineStage.aggregate({
      where: { baseStage: input.baseStage },
      _max: { position: true },
    });
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.customPipelineStage.create({
        data: {
          tenantId,
          name: input.name.trim(),
          baseStage: input.baseStage,
          position: (last._max.position ?? 0) + 1,
        },
      });
      await this.audit.record(
        {
          action: 'pipeline.custom_stage_created',
          entity: 'CustomPipelineStage',
          entityId: created.id,
          after: { name: created.name, baseStage: created.baseStage },
        },
        tx,
      );
      return created;
    });
    return toCustomDto(row);
  }

  async updateCustom(id: string, input: UpdateCustomStageInput): Promise<CustomStageDto> {
    const before = await this.prisma.db.customPipelineStage.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Coluna não encontrada');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.customPipelineStage.update({
        where: { id },
        data: { name: input.name.trim() },
      });
      await this.audit.record(
        {
          action: 'pipeline.custom_stage_updated',
          entity: 'CustomPipelineStage',
          entityId: id,
          before: { name: before.name },
          after: { name: updated.name },
        },
        tx,
      );
      return updated;
    });
    return toCustomDto(row);
  }

  /** Apaga a coluna; os negócios que estavam nela voltam para a coluna padrão da etapa-base. */
  async removeCustom(id: string): Promise<{ id: string; movedBack: number }> {
    const before = await this.prisma.db.customPipelineStage.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Coluna não encontrada');
    const movedBack = await this.prisma.db.$transaction(async (tx) => {
      const moved = await tx.opportunity.updateMany({
        where: { customStageId: id },
        data: { customStageId: null },
      });
      await tx.customPipelineStage.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'pipeline.custom_stage_removed',
          entity: 'CustomPipelineStage',
          entityId: id,
          before: { name: before.name, baseStage: before.baseStage },
          after: { movedBack: moved.count },
        },
        tx,
      );
      return moved.count;
    });
    return { id, movedBack };
  }
}

const toCustomDto = (r: {
  id: string;
  name: string;
  baseStage: CustomStageDto['baseStage'];
  position: number;
}): CustomStageDto => ({ id: r.id, name: r.name, baseStage: r.baseStage, position: r.position });
