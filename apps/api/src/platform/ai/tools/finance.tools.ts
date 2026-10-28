import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  FinanceController,
  FinanceOverviewController,
} from '../../../products/crm/finance/finance.controller';
import { FinanceService } from '../../../products/crm/finance/finance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { iso, limitParam, notFound, projectCodeParam } from './tool-helpers';
import { defineTool, type AiToolDefinition, type AiToolSet } from './tool';

/** Financeiro dos projetos (lançado à mão): visão da empresa, vencidos, projeto, margem e comissões. */
@Injectable()
export class FinanceTools implements AiToolSet {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  private cache: AiToolDefinition[] | null = null;
  get tools(): readonly AiToolDefinition[] {
    return (this.cache ??= this.build());
  }

  private build(): AiToolDefinition[] {
    const db = () => this.prisma.db;
    return [
      defineTool({
        name: 'financeiro_visao',
        area: 'financeiro',
        description:
          'Visão financeira da empresa: total a receber, total vencido, recebido nos últimos 30 dias e comissões pendentes.',
        permissions: ['crm.finance.read'],
        mirrors: { controller: FinanceOverviewController, handler: 'overview' },
        params: z.object({}),
        run: async () => {
          const o = await this.finance.overview();
          return {
            totalOpenCents: o.totalOpenCents,
            totalOverdueCents: o.totalOverdueCents,
            receivedLast30DaysCents: o.receivedLast30DaysCents,
            commissionsPendingCents: o.commissionsPendingCents,
            overdueInstallmentsCount: o.overdue.length,
          };
        },
      }),

      defineTool({
        name: 'recebiveis_vencidos',
        area: 'financeiro',
        description:
          'Parcelas vencidas e não pagas, da mais antiga para a mais nova, com o cliente (pseudônimo), o projeto, o valor e os dias de atraso.',
        permissions: ['crm.finance.read'],
        mirrors: { controller: FinanceOverviewController, handler: 'overview' },
        params: z.object({ limit: limitParam(20) }),
        run: async (ctx, p) => {
          const o = await this.finance.overview();
          const rows = o.overdue.slice(0, p.limit);
          const projects = await db().project.findMany({
            where: { projectCode: { in: rows.map((r) => r.projectCode) } },
            select: { projectCode: true, accountId: true },
          });
          const accountOf = new Map(projects.map((x) => [x.projectCode, x.accountId]));
          return {
            totalOverdueCents: o.totalOverdueCents,
            listedCount: rows.length,
            parcelas: rows.map((r) => {
              const accountId = accountOf.get(r.projectCode);
              return {
                projectCode: r.projectCode,
                cliente: accountId && r.accountName ? ctx.client(accountId, r.accountName) : null,
                parcela: r.order,
                amountCents: r.amountCents,
                dueOn: r.dueOn,
                daysOverdueDays: r.daysOverdue,
              };
            }),
          };
        },
      }),

      defineTool({
        name: 'financeiro_projeto',
        area: 'financeiro',
        description:
          'Financeiro de um projeto (código): valor do contrato, parcelas, recebido, custos previstos e realizados, margem real, comissões e crédito.',
        permissions: ['crm.finance.read'],
        mirrors: { controller: FinanceController, handler: 'summary' },
        params: z.object({ projeto: projectCodeParam }),
        run: async (ctx, p) => {
          const project = await db().project.findFirst({
            where: { projectCode: p.projeto.toUpperCase() },
            select: { id: true, projectCode: true },
          });
          if (!project) return notFound();
          const s = await this.finance.summary(project.id);
          return {
            projectCode: project.projectCode,
            valueCents: s.valueCents,
            totalReceivedCents: s.totalReceivedCents,
            totalOpenCents: s.totalOpenCents,
            totalOverdueCents: s.totalOverdueCents,
            totalCostsCents: s.totalCostsCents,
            totalEstimatedCostsCents: s.totalEstimatedCostsCents,
            totalCommissionsCents: s.totalCommissionsCents,
            marginCents: s.marginCents,
            marginPct: s.marginPct,
            costDeviationPct: s.costDeviationPct,
            parcelas: s.receivables.map((r) => ({
              parcela: r.order,
              amountCents: r.amountCents,
              dueOn: r.dueOn,
              paidOn: r.paidOn,
              situacao: r.status,
              daysOverdueDays: r.daysOverdue,
            })),
            custos: s.costEntries.map((c) => ({
              categoria: c.category,
              estimatedCents: c.estimatedCents,
              actualCents: c.actualCents,
            })),
            credito: s.creditApplications.map((c) => ({
              instituicao: c.institution,
              situacao: c.status,
              amountCents: c.amountCents,
              annualRatePct: c.annualRatePct,
              termMonths: c.termMonths,
            })),
            comissoes: s.commissions.map((c) => ({
              beneficiario: c.userId && c.userName ? ctx.person(c.userId, c.userName) : null,
              amountCents: c.amountCents,
              paidAt: c.paidAt,
            })),
          };
        },
      }),

      defineTool({
        name: 'comissoes_resumo',
        area: 'comissões',
        description:
          'Comissões da empresa: total calculado, total já pago, total pendente e as maiores por pessoa.',
        permissions: ['crm.finance.read'],
        mirrors: { controller: FinanceOverviewController, handler: 'overview' },
        params: z.object({ limit: limitParam(20) }),
        run: async (ctx, p) => {
          const rows = await db().commission.groupBy({
            by: ['userId'],
            _sum: { amountCents: true },
            orderBy: { _sum: { amountCents: 'desc' } },
          });
          const [pending, paid] = await Promise.all([
            db().commission.aggregate({ where: { paidAt: null }, _sum: { amountCents: true } }),
            db().commission.aggregate({
              where: { paidAt: { not: null } },
              _sum: { amountCents: true },
            }),
          ]);
          const users = await db().user.findMany({
            where: { id: { in: rows.flatMap((r) => (r.userId ? [r.userId] : [])) } },
            select: { id: true, name: true },
          });
          const name = new Map(users.map((u) => [u.id, u.name]));
          return {
            totalCalculatedCents: rows.reduce((a, r) => a + (r._sum.amountCents ?? 0), 0),
            paidCents: paid._sum.amountCents ?? 0,
            pendingCents: pending._sum.amountCents ?? 0,
            porPessoa: rows.slice(0, p.limit).map((r) => ({
              beneficiario:
                r.userId && name.has(r.userId)
                  ? ctx.person(r.userId, name.get(r.userId)!)
                  : 'Sem beneficiário',
              amountCents: r._sum.amountCents ?? 0,
            })),
            consultadoEm: iso(ctx.now),
          };
        },
      }),
    ];
  }
}
