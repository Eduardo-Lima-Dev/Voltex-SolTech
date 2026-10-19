import { Injectable, NotFoundException } from '@nestjs/common';
import type { MarginPolicy, Opportunity } from '@voltex/database';
import type {
  CreateMarginPolicyData,
  MarginPolicyDto,
  UpdateMarginPolicyData,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';

const toDto = (row: MarginPolicy): MarginPolicyDto => ({
  id: row.id,
  name: row.name,
  minMarginRate: row.minMarginRate,
  projectType: row.projectType,
  teamId: row.teamId,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class MarginPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<MarginPolicyDto[]> {
    const rows = await this.prisma.db.marginPolicy.findMany({
      where: { deletedAt: null },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(data: CreateMarginPolicyData): Promise<MarginPolicyDto> {
    if (data.teamId) {
      const team = await this.prisma.db.team.findFirst({
        where: { id: data.teamId, deletedAt: null },
      });
      if (!team) throw new NotFoundException('Time não encontrado');
    }
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.marginPolicy.create({
        data: {
          tenantId: this.context.requireTenantId(),
          name: data.name,
          minMarginRate: data.minMarginRate,
          projectType: data.projectType ?? null,
          teamId: data.teamId ?? null,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'margin_policy.created',
          entity: 'MarginPolicy',
          entityId: created.id,
          after: {
            name: created.name,
            minMarginRate: created.minMarginRate,
            projectType: created.projectType,
            teamId: created.teamId,
          },
        },
        tx,
      );
      return created;
    });
    return toDto(row);
  }

  async update(id: string, data: UpdateMarginPolicyData): Promise<MarginPolicyDto> {
    const before = await this.findOrThrow(id);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.marginPolicy.update({ where: { id }, data });
      await this.audit.record(
        {
          action: 'margin_policy.updated',
          entity: 'MarginPolicy',
          entityId: id,
          before: { minMarginRate: before.minMarginRate, active: before.active },
          after: { minMarginRate: updated.minMarginRate, active: updated.active },
        },
        tx,
      );
      return updated;
    });
    return toDto(row);
  }

  async remove(id: string) {
    await this.findOrThrow(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.marginPolicy.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        { action: 'margin_policy.deleted', entity: 'MarginPolicy', entityId: id },
        tx,
      );
    });
    return { id };
  }

  /**
   * Política que vale para a oportunidade: a mais específica entre as ativas. Campos nulos são curinga; time e tipo
   * de projeto só valem se coincidirem (o time é o do responsável pela oportunidade). Empate: a mais recente.
   */
  async resolveFor(
    opportunity: Pick<Opportunity, 'ownerId' | 'projectType'>,
  ): Promise<MarginPolicy | null> {
    const [policies, owner] = await Promise.all([
      this.prisma.db.marginPolicy.findMany({ where: { active: true, deletedAt: null } }),
      opportunity.ownerId
        ? this.prisma.db.user.findFirst({
            where: { id: opportunity.ownerId },
            select: { teamId: true },
          })
        : null,
    ]);
    const teamId = owner?.teamId ?? null;
    const scored = policies
      .filter(
        (p) =>
          (p.teamId === null || p.teamId === teamId) &&
          (p.projectType === null || p.projectType === opportunity.projectType),
      )
      .map((p) => ({ p, score: (p.teamId ? 2 : 0) + (p.projectType ? 1 : 0) }))
      .sort((a, b) => b.score - a.score || b.p.createdAt.getTime() - a.p.createdAt.getTime());
    return scored[0]?.p ?? null;
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.db.marginPolicy.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Política de margem não encontrada');
    return row;
  }
}
