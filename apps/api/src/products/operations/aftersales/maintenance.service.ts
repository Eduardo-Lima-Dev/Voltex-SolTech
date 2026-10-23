import { Injectable, NotFoundException } from '@nestjs/common';
import type { MaintenancePlan } from '@voltex/database';
import type {
  CreateMaintenancePlanInput,
  MaintenancePlanDto,
  UpdateMaintenancePlanInput,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { dateOnly, isoDay } from './dates';

export const toPlanDto = (p: MaintenancePlan): MaintenancePlanDto => ({
  id: p.id,
  plantId: p.plantId,
  title: p.title,
  kind: p.kind,
  everyMonths: p.everyMonths,
  lastDoneAt: p.lastDoneAt?.toISOString() ?? null,
  nextDueAt: isoDay(p.nextDueAt),
  active: p.active,
  notes: p.notes,
});

/**
 * Planos de manutenção recorrentes. A **periodicidade é da empresa** (o sistema não presume nenhuma): informa-se de
 * quantos em quantos meses e quando vence a primeira. Quando vence, o sistema abre um chamado preventivo e uma ordem
 * de serviço; ao concluir a ordem, o plano avança.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async list(plantId?: string): Promise<MaintenancePlanDto[]> {
    const rows = await this.prisma.db.maintenancePlan.findMany({
      where: plantId ? { plantId } : {},
      orderBy: { nextDueAt: 'asc' },
      take: 500,
    });
    return rows.map(toPlanDto);
  }

  async create(input: CreateMaintenancePlanInput): Promise<MaintenancePlanDto> {
    const plant = await this.prisma.db.plant.findFirst({
      where: { id: input.plantId },
      select: { id: true },
    });
    if (!plant) throw new NotFoundException('Planta não encontrada');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.maintenancePlan.create({
        data: {
          tenantId: this.context.requireTenantId(),
          plantId: input.plantId,
          title: input.title,
          kind: input.kind ?? 'PREVENTIVE',
          everyMonths: input.everyMonths,
          nextDueAt: dateOnly(input.firstDueOn),
          notes: input.notes ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'maintenance_plan.created',
          entity: 'MaintenancePlan',
          entityId: created.id,
          after: { title: created.title, everyMonths: created.everyMonths },
        },
        tx,
      );
      return created;
    });
    return toPlanDto(row);
  }

  async update(id: string, input: UpdateMaintenancePlanInput): Promise<MaintenancePlanDto> {
    const plan = await this.prisma.db.maintenancePlan.findFirst({ where: { id } });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.maintenancePlan.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.everyMonths !== undefined ? { everyMonths: input.everyMonths } : {}),
          ...(input.nextDueAt !== undefined ? { nextDueAt: dateOnly(input.nextDueAt) } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'maintenance_plan.updated',
          entity: 'MaintenancePlan',
          entityId: id,
          after: input,
        },
        tx,
      );
      return next;
    });
    return toPlanDto(row);
  }
}
