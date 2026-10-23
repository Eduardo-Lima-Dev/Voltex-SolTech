import { Injectable } from '@nestjs/common';
import { PrismaService } from '@voltex/database';

@Injectable()
export class LeadScoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula score de um lead com base em critérios configurados.
   */
  async scoreLeadAsync(
    tenantId: string,
    leadId: string,
  ): Promise<{ score: number; breakdown: Record<string, number> }> {
    const lead = await this.prisma.crm.lead.findUnique({
      where: { id: leadId },
      include: { account: true },
    });

    if (!lead) {
      return { score: 0, breakdown: {} };
    }

    const criteria = await this.prisma.crm.leadScoringCriteria.findMany({
      where: { tenantId, active: true },
    });

    if (criteria.length === 0) {
      return { score: 0, breakdown: {} };
    }

    const breakdown: Record<string, number> = {};
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const criterion of criteria) {
      let criterionScore = 0;

      if (criterion.type === 'origin' && lead.origin) {
        criterionScore = criterion.values[lead.origin] || 0;
      } else if (criterion.type === 'consumption' && lead.monthlyConsumption) {
        criterionScore = this.getConsumptionScore(lead.monthlyConsumption, criterion.values);
      } else if (criterion.type === 'region' && lead.account?.state) {
        criterionScore = criterion.values[lead.account.state] || 0;
      }

      breakdown[criterion.name] = criterionScore;
      totalWeightedScore += criterionScore * criterion.weight;
      totalWeight += criterion.weight;
    }

    const score = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;

    return { score: Math.min(score, 100), breakdown };
  }

  /**
   * Roteia um lead para o vendedor apropriado.
   */
  async routeLeadAsync(
    tenantId: string,
    leadId: string,
  ): Promise<{ salespersonId: string; method: string } | null> {
    const policy = await this.prisma.crm.leadRoutingPolicy.findFirst({
      where: { tenantId, active: true },
    });

    if (!policy || policy.method === 'roundRobin') {
      return this.roundRobinRoute(tenantId);
    }

    if (policy.method === 'region') {
      const lead = await this.prisma.crm.lead.findUnique({
        where: { id: leadId },
        include: { account: true },
      });

      if (lead?.account?.state) {
        const regionConfig = (policy.config as Record<string, string>)[lead.account.state];
        if (regionConfig) {
          return { salespersonId: regionConfig, method: 'region' };
        }
      }
    }

    return this.roundRobinRoute(tenantId);
  }

  private async roundRobinRoute(
    tenantId: string,
  ): Promise<{ salespersonId: string; method: string } | null> {
    const salespeople = await this.prisma.system.user.findMany({
      where: { tenantId, role: 'SALESPERSON', isActive: true },
      orderBy: { id: 'asc' },
    });

    if (salespeople.length === 0) {
      return null;
    }

    const lastAssigned = await this.prisma.crm.lead.findFirst({
      where: { tenantId, assignedToId: { not: null } },
      orderBy: { assignedAt: 'desc' },
    });

    let nextIndex = 0;
    if (lastAssigned?.assignedToId) {
      const lastIndex = salespeople.findIndex((s) => s.id === lastAssigned.assignedToId);
      nextIndex = (lastIndex + 1) % salespeople.length;
    }

    return { salespersonId: salespeople[nextIndex].id, method: 'roundRobin' };
  }

  private getConsumptionScore(monthlyConsumption: number, scores: Record<string, number>): number {
    if (monthlyConsumption >= 500) return scores['high'] || 0;
    if (monthlyConsumption >= 200) return scores['medium'] || 0;
    return scores['low'] || 0;
  }
}
