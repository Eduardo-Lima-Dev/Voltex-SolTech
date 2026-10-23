import { ForbiddenException, Injectable } from '@nestjs/common';
import { tenantPlanSchema, type TenantPlan } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../prisma/prisma.service';

export type PlanLimit = 'users' | 'monitoringConnections';

/**
 * Plano da empresa (RF-PLAT-013): recursos ligados/desligados e limites, guardados em `tenant.settings.plan`.
 * Quem define o plano é o operador da plataforma (CLI `set-tenant-plan`); a empresa não o altera pela API.
 * Sem plano definido: tudo liberado e sem limites, para não quebrar quem já usa o sistema.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  async getPlan(): Promise<TenantPlan | null> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    const raw = (tenant.settings as Record<string, unknown> | null)?.plan;
    const parsed = tenantPlanSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /** Recurso ausente do plano = liberado. Só `false` explícito bloqueia. */
  async isFeatureEnabled(feature: string): Promise<boolean> {
    const plan = await this.getPlan();
    return plan?.features[feature] !== false;
  }

  async assertFeature(feature: string): Promise<void> {
    if (!(await this.isFeatureEnabled(feature)))
      throw new ForbiddenException({
        code: 'PLAN_FEATURE_UNAVAILABLE',
        message: `O recurso "${feature}" não está incluído no plano da empresa.`,
      });
  }

  private async usage(limit: PlanLimit): Promise<number> {
    if (limit === 'users') return this.prisma.db.user.count({ where: { deletedAt: null } });
    return this.prisma.db.integrationConnection.count({
      where: { kind: 'MONITORING', deletedAt: null },
    });
  }

  /** Falha se criar mais um item ultrapassaria o limite do plano. */
  async assertWithinLimit(limit: PlanLimit): Promise<void> {
    const max = (await this.getPlan())?.limits[limit];
    if (max === undefined) return;
    if ((await this.usage(limit)) >= max)
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        message: `O limite do plano foi atingido (${max}).`,
      });
  }
}
