import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { FUNNEL_GROUP_BY } from '@voltex/shared';
import { AnalyticsController } from '../../analytics/analytics.controller';
import { AnalyticsService } from '../../analytics/analytics.service';
import { stageName } from '../../analytics/analytics-core';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardController } from '../../../products/crm/dashboard/dashboard.controller';
import { DashboardService } from '../../../products/crm/dashboard/dashboard.service';
import { ContractsController } from '../../../products/crm/contracts/contracts.controller';
import { EnergyBillsController } from '../../../products/crm/energy-bills/energy-bills.controller';
import { LeadsController } from '../../../products/crm/leads.controller';
import { OpportunitiesController } from '../../../products/crm/opportunities.controller';
import { ProjectsController } from '../../../products/crm/projects/projects.controller';
import { ProposalsController } from '../../../products/crm/proposals/proposals.controller';
import { QuotesController } from '../../../products/crm/quotes/quotes.controller';
import { LABELS, iso, limitParam, notFound, periodParams, projectCodeParam } from './tool-helpers';
import { defineTool, type AiToolDefinition, type AiToolSet } from './tool';

const DAY = 86_400_000;

/** Comercial: leads, funil, oportunidades, cotações, propostas, contratos, projetos e faturas. */
@Injectable()
export class CommercialTools implements AiToolSet {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly dashboard: DashboardService,
  ) {}

  private cache: AiToolDefinition[] | null = null;
  get tools(): readonly AiToolDefinition[] {
    return (this.cache ??= this.build());
  }

  private build(): AiToolDefinition[] {
    const db = () => this.prisma.db;
    return [
      defineTool({
        name: 'leads_resumo',
        area: 'leads',
        description:
          'Resumo dos leads do período: quantos por origem, segmento, UF e situação, quantos estão com o primeiro contato atrasado (SLA) e a conversão em oportunidade.',
        permissions: ['crm.lead.read'],
        mirrors: { controller: AnalyticsController, handler: 'leads' },
        params: z.object(periodParams),
        run: (_ctx, p) => this.analytics.leads(p),
      }),

      defineTool({
        name: 'leads_buscar',
        area: 'leads',
        description:
          'Lista leads (sem contato nem documento) com origem, segmento, UF, situação, pontuação e conta de luz. Use para perguntas como "quais leads estão com contato atrasado" ou "os leads mais bem pontuados".',
        permissions: ['crm.lead.read'],
        mirrors: { controller: LeadsController, handler: 'list' },
        params: z.object({
          status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED']).optional(),
          segmento: z.enum(['RESIDENTIAL', 'RURAL', 'COMMERCIAL', 'INDUSTRIAL']).optional(),
          uf: z.string().trim().length(2).optional(),
          ordenarPor: z.enum(['pontuacao', 'recentes']).default('recentes'),
          limit: limitParam(20),
        }),
        run: async (ctx, p) => {
          const rows = await db().lead.findMany({
            where: {
              deletedAt: null,
              ...(p.status ? { status: p.status } : {}),
              ...(p.segmento ? { segment: p.segmento } : {}),
              ...(p.uf ? { state: p.uf.toUpperCase() } : {}),
            },
            orderBy:
              p.ordenarPor === 'pontuacao'
                ? [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]
                : { createdAt: 'desc' },
            take: p.limit,
            select: {
              id: true,
              name: true,
              source: true,
              segment: true,
              state: true,
              status: true,
              score: true,
              monthlyBillCents: true,
              firstContactAt: true,
              firstContactDueAt: true,
              ownerId: true,
              createdAt: true,
            },
          });
          const owners = await this.names(rows.map((r) => r.ownerId));
          return {
            count: rows.length,
            leads: rows.map((r) => ({
              lead: ctx.contact(r.id, r.name),
              origem: LABELS.source(r.source),
              segmento: LABELS.segment(r.segment),
              uf: r.state,
              situacao: LABELS.leadStatus(r.status),
              score: r.score,
              monthlyBillCents: r.monthlyBillCents,
              primeiroContatoAtrasado:
                r.status === 'NEW' &&
                !r.firstContactAt &&
                !!r.firstContactDueAt &&
                r.firstContactDueAt < ctx.now,
              responsavel:
                r.ownerId && owners.get(r.ownerId)
                  ? ctx.person(r.ownerId, owners.get(r.ownerId)!)
                  : null,
              criadoEm: iso(r.createdAt),
            })),
          };
        },
      }),

      defineTool({
        name: 'funil_resumo',
        area: 'funil de vendas',
        description:
          'Funil de vendas por grupo (origem, segmento, UF, vendedor ou tipo de projeto): oportunidades, propostas, ganhas, perdidas, taxa de ganho, ticket médio e ciclo médio. Grupos com poucos registros não têm taxa.',
        permissions: ['crm.opportunity.read'],
        mirrors: { controller: AnalyticsController, handler: 'funnel' },
        params: z.object({ groupBy: z.enum(FUNNEL_GROUP_BY).default('source'), ...periodParams }),
        run: async (ctx, p) => {
          const out = await this.analytics.funnel(p);
          const alias = (group: string, label: string) =>
            p.groupBy === 'owner' && group !== 'SEM_RESPONSAVEL' ? ctx.person(group, label) : label;
          return {
            ...out,
            rows: out.rows.map((r) => ({ ...r, group: undefined, label: alias(r.group, r.label) })),
          };
        },
      }),

      defineTool({
        name: 'oportunidades_paradas',
        area: 'funil de vendas',
        description:
          'Oportunidades abertas que estão sem tarefa aberta ou há muitos dias na mesma etapa, da mais parada para a menos.',
        permissions: ['crm.opportunity.read'],
        mirrors: { controller: AnalyticsController, handler: 'stalled' },
        params: z.object({ limit: limitParam(20) }),
        run: async (ctx, p) => {
          const out = await this.analytics.stalled(p.limit);
          return {
            ...out,
            rows: out.rows.map((r) => ({
              projectCode: r.projectCode,
              stageLabel: r.stageLabel,
              daysInStageDays: r.daysInStageDays,
              withoutOpenTask: r.withoutOpenTask,
              responsavel: r.ownerId && r.ownerName ? ctx.person(r.ownerId, r.ownerName) : null,
            })),
          };
        },
      }),

      defineTool({
        name: 'oportunidade_detalhe',
        area: 'oportunidades',
        description:
          'Situação de uma oportunidade pelo código do projeto: etapa, responsável, valor da última cotação e da proposta, contrato, tarefas abertas e linha do tempo recente.',
        permissions: ['crm.opportunity.read'],
        mirrors: { controller: OpportunitiesController, handler: 'get' },
        params: z.object({ projeto: projectCodeParam }),
        run: async (ctx, p) => {
          const opp = await db().opportunity.findFirst({
            where: { projectCode: p.projeto.toUpperCase(), deletedAt: null },
            select: {
              id: true,
              projectCode: true,
              stage: true,
              status: true,
              projectType: true,
              ownerId: true,
              accountId: true,
              lostReason: true,
              expectedCloseDate: true,
              stageChangedAt: true,
              createdAt: true,
            },
          });
          if (!opp) return notFound();
          const [account, owners, quote, proposal, contract, openTasks, timeline] =
            await Promise.all([
              db().account.findFirst({
                where: { id: opp.accountId },
                select: { name: true, segment: true },
              }),
              this.names([opp.ownerId]),
              db().quote.findFirst({
                where: { opportunityId: opp.id, deletedAt: null },
                orderBy: { version: 'desc' },
                select: {
                  version: true,
                  priceCents: true,
                  marginStatus: true,
                  approvalStatus: true,
                },
              }),
              db().proposal.findFirst({
                where: { opportunityId: opp.id },
                orderBy: { version: 'desc' },
                select: {
                  status: true,
                  sentAt: true,
                  firstViewedAt: true,
                  acceptedAt: true,
                  viewCount: true,
                },
              }),
              db().contract.findFirst({
                where: { opportunityId: opp.id },
                orderBy: { version: 'desc' },
                select: { status: true, valueCents: true, signedAt: true },
              }),
              db().task.count({
                where: { opportunityId: opp.id, status: 'OPEN', deletedAt: null },
              }),
              db().timelineEvent.findMany({
                where: { opportunityId: opp.id },
                orderBy: { createdAt: 'desc' },
                take: 8,
                select: { type: true, createdAt: true },
              }),
            ]);
          return {
            projectCode: opp.projectCode,
            cliente: account ? ctx.client(opp.accountId, account.name) : null,
            segmento: LABELS.segment(account?.segment),
            etapa: stageName(opp.stage),
            situacao: LABELS.oppStatus(opp.status),
            tipoDeProjeto: opp.projectType,
            responsavel:
              opp.ownerId && owners.get(opp.ownerId)
                ? ctx.person(opp.ownerId, owners.get(opp.ownerId)!)
                : null,
            previsaoDeFechamento: iso(opp.expectedCloseDate),
            diasNaEtapaDays: Math.floor((ctx.now.getTime() - opp.stageChangedAt.getTime()) / DAY),
            criadaEm: iso(opp.createdAt),
            motivoDaPerda: opp.lostReason ? ctx.session.pseudonyms.scrub(opp.lostReason) : null,
            tarefasAbertasCount: openTasks,
            cotacao: quote && {
              versao: quote.version,
              priceCents: quote.priceCents,
              margem: quote.marginStatus,
              aprovacao: quote.approvalStatus,
            },
            proposta: proposal && {
              situacao: proposal.status,
              enviadaEm: iso(proposal.sentAt),
              vistaPelaPrimeiraVezEm: iso(proposal.firstViewedAt),
              aceitaEm: iso(proposal.acceptedAt),
              visualizacoesCount: proposal.viewCount,
            },
            contrato: contract && {
              situacao: contract.status,
              valueCents: contract.valueCents,
              assinadoEm: iso(contract.signedAt),
            },
            linhaDoTempo: timeline.map((t) => ({ evento: t.type, em: iso(t.createdAt) })),
          };
        },
      }),

      defineTool({
        name: 'tarefas_resumo',
        area: 'tarefas',
        description: 'Tarefas abertas e atrasadas da empresa, por responsável.',
        permissions: ['crm.task.read'],
        mirrors: { controller: AnalyticsController, handler: 'tasks' },
        params: z.object({}),
        run: async (ctx) => {
          const out = await this.analytics.tasks();
          return {
            ...out,
            byAssignee: out.byAssignee.map((a) => ({
              responsavel: a.userId && a.name ? ctx.person(a.userId, a.name) : 'Sem responsável',
              openCount: a.openCount,
              overdueCount: a.overdueCount,
            })),
          };
        },
      }),

      defineTool({
        name: 'cotacoes_margens',
        area: 'cotações e margem',
        description:
          'Cotações de um projeto (código): preço, situação da margem em relação à política e da aprovação. Use também para saber se há cotação abaixo da margem mínima.',
        permissions: ['crm.quote.read'],
        mirrors: { controller: QuotesController, handler: 'list' },
        params: z.object({ projeto: projectCodeParam }),
        run: async (_ctx, p) => {
          const opp = await db().opportunity.findFirst({
            where: { projectCode: p.projeto.toUpperCase(), deletedAt: null },
            select: { id: true, projectCode: true },
          });
          if (!opp) return notFound();
          const quotes = await db().quote.findMany({
            where: { opportunityId: opp.id, deletedAt: null },
            orderBy: { version: 'desc' },
            take: 10,
            select: {
              version: true,
              priceCents: true,
              marginStatus: true,
              minMarginRate: true,
              approvalStatus: true,
              createdAt: true,
            },
          });
          return {
            projectCode: opp.projectCode,
            quotes: quotes.map((q) => ({
              versao: q.version,
              priceCents: q.priceCents,
              margemEmRelacaoAPolitica: q.marginStatus,
              minMarginRate: q.minMarginRate,
              aprovacao: q.approvalStatus,
              criadaEm: iso(q.createdAt),
            })),
          };
        },
      }),

      defineTool({
        name: 'propostas_resumo',
        area: 'propostas',
        description:
          'Propostas do período: quantas foram geradas, enviadas, vistas e aceitas, por situação, e o tempo médio entre o envio e o aceite (quando há amostra).',
        permissions: ['crm.proposal.read'],
        mirrors: { controller: ProposalsController, handler: 'list' },
        params: z.object(periodParams),
        run: async (_ctx, p) => {
          const to = p.to ?? new Date();
          const from = p.from ?? new Date(to.getTime() - 90 * DAY);
          const rows = await db().proposal.findMany({
            where: { createdAt: { gte: from, lte: to } },
            select: { status: true, sentAt: true, firstViewedAt: true, acceptedAt: true },
          });
          const accepted = rows.filter((r) => r.sentAt && r.acceptedAt);
          const hours = accepted.map(
            (r) => (r.acceptedAt!.getTime() - r.sentAt!.getTime()) / 3_600_000,
          );
          const enough = hours.length >= (await this.analytics.settings()).minSamples.simpleAverage;
          const byStatus = new Map<string, number>();
          for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
          return {
            from: iso(from),
            to: iso(to),
            generatedCount: rows.length,
            sentCount: rows.filter((r) => r.sentAt).length,
            viewedCount: rows.filter((r) => r.firstViewedAt).length,
            acceptedCount: rows.filter((r) => r.acceptedAt).length,
            sentNotAcceptedCount: rows.filter((r) => r.sentAt && !r.acceptedAt).length,
            porSituacao: [...byStatus.entries()].map(([situacao, count]) => ({ situacao, count })),
            averageHoursToAcceptDays: enough
              ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length / 24) * 10) / 10
              : null,
            amostraInsuficienteParaTempoMedio: !enough,
          };
        },
      }),

      defineTool({
        name: 'contratos_resumo',
        area: 'contratos',
        description:
          'Contratos assinados no período: quantidade, valor total, ticket médio e os últimos assinados (sem o texto do contrato).',
        permissions: ['crm.contract.read'],
        mirrors: { controller: ContractsController, handler: 'list' },
        params: z.object({ ...periodParams, limit: limitParam(10, 5) }),
        run: async (_ctx, p) => {
          const to = p.to ?? new Date();
          const from = p.from ?? new Date(to.getTime() - 90 * DAY);
          const rows = await db().contract.findMany({
            where: { status: 'SIGNED', signedAt: { gte: from, lte: to } },
            orderBy: { signedAt: 'desc' },
            select: { opportunityId: true, valueCents: true, signedAt: true },
          });
          const opps = await db().opportunity.findMany({
            where: { id: { in: rows.slice(0, p.limit).map((r) => r.opportunityId) } },
            select: { id: true, projectCode: true },
          });
          const code = new Map(opps.map((o) => [o.id, o.projectCode]));
          const total = rows.reduce((a, r) => a + r.valueCents, 0);
          const enough = rows.length >= (await this.analytics.settings()).minSamples.simpleAverage;
          return {
            from: iso(from),
            to: iso(to),
            signedCount: rows.length,
            totalValueCents: total,
            averageTicketCents: enough ? Math.round(total / rows.length) : null,
            amostraInsuficienteParaTicketMedio: !enough,
            ultimos: rows.slice(0, p.limit).map((r) => ({
              projectCode: code.get(r.opportunityId) ?? null,
              valueCents: r.valueCents,
              assinadoEm: iso(r.signedAt),
            })),
          };
        },
      }),

      defineTool({
        name: 'projetos_resumo',
        area: 'projetos e homologação',
        description:
          'Projetos (pós-contrato): quantos por situação da homologação e quais têm mais itens obrigatórios pendentes no checklist.',
        permissions: ['crm.project.read'],
        mirrors: { controller: ProjectsController, handler: 'list' },
        params: z.object({ limit: limitParam(20) }),
        run: async (_ctx, p) => {
          const [byStatus, pending] = await Promise.all([
            db().project.groupBy({
              by: ['status'],
              _count: { _all: true },
              _sum: { valueCents: true },
            }),
            db().projectChecklistItem.groupBy({
              by: ['projectId'],
              where: { required: true, status: 'PENDING' },
              _count: { _all: true },
              orderBy: { _count: { projectId: 'desc' } },
              take: p.limit,
            }),
          ]);
          const projects = await db().project.findMany({
            where: { id: { in: pending.map((x) => x.projectId) }, status: { not: 'CANCELLED' } },
            select: { id: true, projectCode: true, status: true },
          });
          const byId = new Map(projects.map((x) => [x.id, x]));
          return {
            porSituacao: byStatus.map((s) => ({
              situacao: LABELS.projectStatus(s.status),
              count: s._count._all,
              totalValueCents: s._sum.valueCents ?? 0,
            })),
            totalCount: byStatus.reduce((a, s) => a + s._count._all, 0),
            comPendencias: pending.flatMap((x) => {
              const project = byId.get(x.projectId);
              return project
                ? [
                    {
                      projectCode: project.projectCode,
                      situacao: LABELS.projectStatus(project.status),
                      pendingRequiredCount: x._count._all,
                    },
                  ]
                : [];
            }),
          };
        },
      }),

      defineTool({
        name: 'painel_comercial',
        area: 'painel comercial',
        description:
          'Painel comercial do período: leads por origem, funil por etapa, propostas, negócios ganhos e previsão do pipeline aberto.',
        permissions: ['crm.dashboard.read'],
        mirrors: { controller: DashboardController, handler: 'commercial' },
        params: z.object(periodParams),
        run: (_ctx, p) => this.dashboard.commercial({ from: p.from, to: p.to }),
      }),

      defineTool({
        name: 'faturas_resumo',
        area: 'faturas de energia',
        description:
          'Faturas de energia enviadas: quantas por situação (enviada, lida, validada, recusada). Não traz dados da fatura nem do cliente.',
        permissions: ['crm.energy-bill.read'],
        mirrors: { controller: EnergyBillsController, handler: 'list' },
        params: z.object({}),
        run: async () => {
          const rows = await db().energyBill.groupBy({
            by: ['status'],
            where: { deletedAt: null },
            _count: { _all: true },
          });
          return {
            totalCount: rows.reduce((a, r) => a + r._count._all, 0),
            porSituacao: rows.map((r) => ({ situacao: r.status, count: r._count._all })),
          };
        },
      }),
    ];
  }

  private async names(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (!unique.length) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}
