import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../common/context/request-context';
import { PrismaService } from '../../../platform/prisma/prisma.service';

const dayStart = (): Date => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/**
 * Rotina diária do financeiro: parcela aberta e vencida passa a `OVERDUE` e vira tarefa de cobrança para o
 * financeiro. A cobrança ao cliente é sempre disparada à mão por uma pessoa (e-mail ou link do WhatsApp).
 */
@Injectable()
export class FinanceScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  /** Roda para a empresa do contexto. Idempotente: a tarefa tem chave por parcela. */
  async scanTenant(): Promise<{ overdue: number; tasks: number }> {
    const tenantId = this.context.requireTenantId();
    const today = dayStart();
    const rows = await this.prisma.db.receivable.findMany({
      where: { status: { in: ['OPEN', 'OVERDUE'] }, dueAt: { lt: today } },
      include: { project: { select: { projectCode: true, accountId: true } } },
    });
    if (rows.length === 0) return { overdue: 0, tasks: 0 };

    await this.prisma.db.receivable.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'OPEN' },
      data: { status: 'OVERDUE' },
    });

    const finance = await this.prisma.db.user.findFirst({
      where: { role: 'FINANCE', isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    let tasks = 0;
    for (const row of rows) {
      const key = `receivable-overdue:${row.id}`;
      const existing = await this.prisma.db.task.findFirst({
        where: { automationKey: key },
        select: { id: true },
      });
      if (existing) continue;
      let assigneeId = finance?.id ?? null;
      if (!assigneeId) {
        const opportunity = await this.prisma.db.opportunity.findFirst({
          where: { id: row.opportunityId },
          select: { ownerId: true },
        });
        assigneeId = opportunity?.ownerId ?? null;
      }
      await this.prisma.db.task.create({
        data: {
          tenantId,
          title: `Cobrar parcela ${row.order} (${row.referenceId}) — projeto ${row.project.projectCode}`,
          dueAt: today,
          assigneeId,
          opportunityId: row.opportunityId,
          accountId: row.project.accountId,
          origin: 'automation:finance',
          automationKey: key,
        },
      });
      tasks += 1;
    }
    return { overdue: rows.length, tasks };
  }
}
