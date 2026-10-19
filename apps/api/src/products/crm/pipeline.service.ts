import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PIPELINE_STAGES,
  type PipelineStageDto,
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
        },
      });
      await this.audit.record(
        {
          action: 'pipeline.stage_updated',
          entity: 'PipelineStage',
          entityId: id,
          before: { name: before.name, order: before.order },
          after: { name: updated.name, order: updated.order },
        },
        tx,
      );
      return updated;
    });
    return { id: row.id, key: row.key, name: row.name, order: row.order, terminal: row.terminal };
  }
}
