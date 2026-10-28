import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AftersalesController } from '../../../products/operations/aftersales/aftersales.controller';
import { AftersalesDashboardService } from '../../../products/operations/aftersales/dashboard.service';
import { MonitoringController } from '../../../products/operations/aftersales/monitoring/monitoring.controller';
import { MonitoringService } from '../../../products/operations/aftersales/monitoring/monitoring.service';
import { InstallationsService } from '../../../products/operations/installations.service';
import { OperationsController } from '../../../products/operations/operations.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { LABELS, iso, limitParam, notFound, projectCodeParam } from './tool-helpers';
import { defineTool, type AiToolDefinition, type AiToolSet } from './tool';

const DAY = 86_400_000;
const INSTALLATION_STATUSES = [
  'AWAITING_ENGINEERING',
  'AWAITING_MATERIAL',
  'MATERIAL_READY',
  'SCHEDULING',
  'CREW_ASSIGNED',
  'IN_PROGRESS',
  'FIELD_ISSUE',
  'INSTALLED',
  'COMMISSIONING',
  'CUSTOMER_ACCEPTANCE',
  'DONE',
  'CANCELLED',
] as const;

/** Duas ordens da mesma equipe com horários que se cruzam. */
export function crewConflicts(
  orders: readonly { crewId: string | null; start: Date; end: Date }[],
): number {
  let count = 0;
  const byCrew = new Map<string, { start: Date; end: Date }[]>();
  for (const o of orders) if (o.crewId) byCrew.set(o.crewId, [...(byCrew.get(o.crewId) ?? []), o]);
  for (const list of byCrew.values()) {
    const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start < sorted[i - 1]!.end) count += 1;
  }
  return count;
}

/** Operação e pós-venda: instalações, agenda, campo, comissionamento, usinas, chamados, garantias e O&M. */
@Injectable()
export class OperationsTools implements AiToolSet {
  constructor(
    private readonly prisma: PrismaService,
    private readonly installations: InstallationsService,
    private readonly aftersales: AftersalesDashboardService,
    private readonly monitoring: MonitoringService,
  ) {}

  private cache: AiToolDefinition[] | null = null;
  get tools(): readonly AiToolDefinition[] {
    return (this.cache ??= this.build());
  }

  private build(): AiToolDefinition[] {
    const db = () => this.prisma.db;
    return [
      defineTool({
        name: 'operacao_painel',
        area: 'operação e instalações',
        description:
          'Painel da operação: instalações por situação, agendadas, atrasadas, aguardando material, pendências de campo e produtividade por equipe nos últimos 30 dias.',
        permissions: ['ops.installation.read'],
        mirrors: { controller: OperationsController, handler: 'dashboard' },
        params: z.object({}),
        run: async (ctx) => {
          const d = await this.installations.dashboard();
          return {
            porSituacao: Object.entries(d.byStatus).map(([s, count]) => ({
              situacao: LABELS.installationStatus(s),
              count,
            })),
            scheduledCount: d.scheduledCount,
            overdueCount: d.overdueCount,
            awaitingMaterialCount: d.awaitingMaterialCount,
            openIssuesCount: d.openIssuesCount,
            reworkCount: d.reworkCount,
            equipes: d.crews.map((c) => ({
              equipe: ctx.crew(c.crewId, c.crewName),
              doneLast30DaysCount: c.doneLast30Days,
            })),
          };
        },
      }),

      defineTool({
        name: 'instalacoes_buscar',
        area: 'operação e instalações',
        description:
          'Lista instalações por situação, com o cliente (pseudônimo), o código do projeto e a próxima ordem de serviço.',
        permissions: ['ops.installation.read'],
        mirrors: { controller: OperationsController, handler: 'list' },
        params: z.object({
          status: z.enum(INSTALLATION_STATUSES).optional(),
          limit: limitParam(20),
        }),
        run: async (ctx, p) => {
          const rows = await db().installation.findMany({
            where: p.status ? { status: p.status } : {},
            orderBy: { updatedAt: 'desc' },
            take: p.limit,
            select: {
              id: true,
              projectCode: true,
              status: true,
              accountId: true,
              materialsReadyAt: true,
              installedAt: true,
              doneAt: true,
              createdAt: true,
            },
          });
          const [accounts, orders] = await Promise.all([
            db().account.findMany({
              where: { id: { in: rows.map((r) => r.accountId) } },
              select: { id: true, name: true },
            }),
            db().workOrder.findMany({
              where: {
                installationId: { in: rows.map((r) => r.id) },
                status: { in: ['PENDING', 'SCHEDULED', 'IN_PROGRESS'] },
              },
              orderBy: { scheduledStart: 'asc' },
              select: {
                installationId: true,
                type: true,
                status: true,
                scheduledStart: true,
                scheduledEnd: true,
              },
            }),
          ]);
          const name = new Map(accounts.map((a) => [a.id, a.name]));
          return {
            count: rows.length,
            instalacoes: rows.map((r) => {
              const next = orders.find((o) => o.installationId === r.id);
              return {
                projectCode: r.projectCode,
                cliente: name.has(r.accountId)
                  ? ctx.client(r.accountId, name.get(r.accountId)!)
                  : null,
                situacao: LABELS.installationStatus(r.status),
                materialProntoEm: iso(r.materialsReadyAt),
                instaladaEm: iso(r.installedAt),
                finalizadaEm: iso(r.doneAt),
                proximaOrdem: next && {
                  tipo: next.type,
                  situacao: next.status,
                  inicio: iso(next.scheduledStart),
                  atrasada:
                    !!next.scheduledEnd &&
                    next.scheduledEnd < ctx.now &&
                    next.status !== 'IN_PROGRESS',
                },
              };
            }),
          };
        },
      }),

      defineTool({
        name: 'agenda_resumo',
        area: 'agenda de campo',
        description:
          'Ordens de serviço agendadas nos próximos dias por equipe, ordens atrasadas e choques de horário da mesma equipe.',
        permissions: ['ops.workorder.read'],
        mirrors: { controller: OperationsController, handler: 'agenda' },
        params: z.object({ dias: z.number().int().min(1).max(60).default(14) }),
        run: async (ctx, p) => {
          const until = new Date(ctx.now.getTime() + p.dias * DAY);
          const rows = await db().workOrder.findMany({
            where: {
              status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
              scheduledStart: { not: null, lte: until },
            },
            orderBy: { scheduledStart: 'asc' },
            take: 200,
            select: {
              type: true,
              status: true,
              crewId: true,
              projectCode: true,
              scheduledStart: true,
              scheduledEnd: true,
            },
          });
          const crews = await db().crew.findMany({
            where: { id: { in: rows.flatMap((r) => (r.crewId ? [r.crewId] : [])) } },
            select: { id: true, name: true },
          });
          const crewName = new Map(crews.map((c) => [c.id, c.name]));
          const dated = rows.flatMap((r) =>
            r.scheduledStart && r.scheduledEnd
              ? [{ ...r, start: r.scheduledStart, end: r.scheduledEnd }]
              : [],
          );
          return {
            days: p.dias,
            ordersCount: rows.length,
            overdueCount: rows.filter(
              (r) => r.status === 'SCHEDULED' && r.scheduledEnd && r.scheduledEnd < ctx.now,
            ).length,
            conflictsCount: crewConflicts(dated),
            ordens: rows.slice(0, 20).map((r) => ({
              tipo: r.type,
              situacao: r.status,
              projectCode: r.projectCode,
              equipe:
                r.crewId && crewName.has(r.crewId)
                  ? ctx.crew(r.crewId, crewName.get(r.crewId)!)
                  : null,
              inicio: iso(r.scheduledStart),
              fim: iso(r.scheduledEnd),
            })),
          };
        },
      }),

      defineTool({
        name: 'pendencias_campo',
        area: 'pendências de campo',
        description:
          'Pendências de campo abertas (as que bloqueiam e as demais), com o tempo aberto e o projeto.',
        permissions: ['ops.installation.read'],
        mirrors: { controller: OperationsController, handler: 'listIssues' },
        params: z.object({ limit: limitParam(20) }),
        run: async (ctx, p) => {
          const issues = await db().fieldIssue.findMany({
            where: { status: 'OPEN' },
            orderBy: { createdAt: 'asc' },
            take: 100,
            select: { installationId: true, type: true, blocking: true, createdAt: true },
          });
          const installs = await db().installation.findMany({
            where: { id: { in: [...new Set(issues.map((i) => i.installationId))] } },
            select: { id: true, projectCode: true },
          });
          const code = new Map(installs.map((i) => [i.id, i.projectCode]));
          return {
            openCount: issues.length,
            blockingCount: issues.filter((i) => i.blocking).length,
            pendencias: issues.slice(0, p.limit).map((i) => ({
              projectCode: code.get(i.installationId) ?? null,
              tipo: i.type,
              bloqueia: i.blocking,
              daysOpenDays: Math.floor((ctx.now.getTime() - i.createdAt.getTime()) / DAY),
            })),
          };
        },
      }),

      defineTool({
        name: 'comissionamento_resumo',
        area: 'comissionamento',
        description:
          'Comissionamento: registros por situação, quantos aguardam a decisão do responsável técnico e quantos foram reprovados.',
        permissions: ['ops.commissioning.read'],
        mirrors: { controller: OperationsController, handler: 'getCommissioning' },
        params: z.object({}),
        run: async () => {
          const rows = await db().commissioningRecord.groupBy({
            by: ['status'],
            _count: { _all: true },
          });
          const count = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
          return {
            totalCount: rows.reduce((a, r) => a + r._count._all, 0),
            inProgressCount: count('IN_PROGRESS'),
            awaitingDecisionCount: count('SUBMITTED'),
            approvedCount: count('APPROVED'),
            rejectedCount: count('REJECTED'),
            provisionalCount: await db().commissioningRecord.count({
              where: { provisional: true },
            }),
          };
        },
      }),

      defineTool({
        name: 'posvenda_painel',
        area: 'pós-venda',
        description:
          'Painel do pós-venda: base instalada, receita recorrente de O&M, chamados abertos e fora do prazo, tempo médio de resolução, garantias a vencer ou sem termo e contratos que terminam.',
        permissions: ['ops.plant.read'],
        mirrors: { controller: AftersalesController, handler: 'getDashboard' },
        params: z.object({}),
        run: async () => {
          const d = await this.aftersales.get();
          const plants = await db().plant.findMany({
            where: { id: { in: d.ticketsByPlant.map((t) => t.plantId) } },
            select: { id: true, projectCode: true },
          });
          const code = new Map(plants.map((p) => [p.id, p.projectCode]));
          return {
            baseInstalada: {
              plantsCount: d.installedBase.plants,
              powerKwp: d.installedBase.powerKwp,
            },
            mrrCents: d.mrrCents,
            openTicketsCount: d.openTickets,
            breachedTicketsCount: d.breachedTickets,
            mttrHours: d.mttrHours,
            chamadosPorUsina: d.ticketsByPlant.map((t) => ({
              projectCode: code.get(t.plantId) ?? null,
              openCount: t.open,
            })),
            warrantiesExpiringCount: d.warrantiesExpiring,
            warrantiesMissingCount: d.warrantiesMissing,
            contractsExpiringCount: d.contractsExpiring,
            upsellOpportunitiesCount: d.upsellOpportunities,
          };
        },
      }),

      defineTool({
        name: 'planta_desempenho',
        area: 'monitoramento das usinas',
        description:
          'Desempenho de uma usina (código do projeto): geração real contra a esperada por mês, dias abaixo do esperado, alarmes abertos e última leitura. Sem geração esperada (sem projeto técnico), só mostra a real.',
        permissions: ['ops.plant.read'],
        mirrors: { controller: MonitoringController, handler: 'page' },
        params: z.object({ projeto: projectCodeParam }),
        run: async (_ctx, p) => {
          const plant = await db().plant.findFirst({
            where: { projectCode: p.projeto.toUpperCase() },
            select: { id: true, projectCode: true, powerKwp: true, status: true },
          });
          if (!plant) return notFound();
          const page = await this.monitoring.page(plant.id);
          return {
            projectCode: plant.projectCode,
            powerKwp: plant.powerKwp,
            hasExpected: page.hasExpected,
            meses: page.months.map((m) => ({
              month: m.month,
              actualKwh: m.actualKwh,
              expectedKwh: m.expectedKwh,
              expectedToDateKwh: m.expectedToDateKwh,
              performanceRate: m.performanceIndex,
              deviationPct: m.deviationPct,
              daysWithDataCount: m.daysWithData,
            })),
            regraDeDesvio: page.deviationRule && {
              thresholdPct: page.deviationRule.thresholdPct,
              consecutiveDaysCount: page.deviationRule.consecutiveDays,
            },
            desvio: page.deviation && {
              alerta: page.deviation.alert,
              streakDays: page.deviation.streak,
              ultimosDias: page.deviation.days.slice(-7),
            },
            alarmesAbertos: page.openAlarms.map((a) => ({
              severidade: a.severity,
              abertoEm: a.openedAt,
            })),
            ultimaLeitura: page.snapshot && {
              powerKw: page.snapshot.powerKw,
              status: page.snapshot.status,
              recebidaEm: page.snapshot.receivedAt,
            },
            ultimosDiasKwh: page.daily.slice(-14).map((d) => ({ dia: d.date, kwh: d.kwh })),
          };
        },
      }),

      defineTool({
        name: 'chamados_resumo',
        area: 'chamados',
        description:
          'Chamados de pós-venda: abertos por situação e prioridade, fora do prazo, tempo médio de resolução (com amostra) e os mais antigos.',
        permissions: ['ops.ticket.read'],
        mirrors: { controller: AftersalesController, handler: 'listTickets' },
        params: z.object({ limit: limitParam(20) }),
        run: async (ctx, p) => {
          const [open, resolved] = await Promise.all([
            db().ticket.findMany({
              where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] } },
              orderBy: { createdAt: 'asc' },
              select: {
                plantId: true,
                number: true,
                type: true,
                priority: true,
                status: true,
                slaDueAt: true,
                createdAt: true,
              },
            }),
            db().ticket.findMany({
              where: { resolvedAt: { gte: new Date(ctx.now.getTime() - 90 * DAY) } },
              select: { createdAt: true, resolvedAt: true },
            }),
          ]);
          const plants = await db().plant.findMany({
            where: { id: { in: open.slice(0, p.limit).map((t) => t.plantId) } },
            select: { id: true, projectCode: true },
          });
          const code = new Map(plants.map((x) => [x.id, x.projectCode]));
          const hours = resolved.map(
            (t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000,
          );
          const enough = hours.length >= 5;
          const tally = (key: 'status' | 'priority') => {
            const m = new Map<string, number>();
            for (const t of open) m.set(t[key], (m.get(t[key]) ?? 0) + 1);
            return [...m.entries()].map(([k, count]) => ({ valor: k, count }));
          };
          return {
            openCount: open.length,
            breachedCount: open.filter((t) => t.slaDueAt && t.slaDueAt < ctx.now).length,
            porSituacao: tally('status'),
            porPrioridade: tally('priority'),
            mttrHours: enough
              ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
              : null,
            amostraInsuficienteParaTempoMedio: !enough,
            maisAntigos: open.slice(0, p.limit).map((t) => ({
              projectCode: code.get(t.plantId) ?? null,
              tipo: t.type,
              prioridade: t.priority,
              situacao: t.status,
              daysOpenDays: Math.floor((ctx.now.getTime() - t.createdAt.getTime()) / DAY),
              foraDoPrazo: !!t.slaDueAt && t.slaDueAt < ctx.now,
            })),
          };
        },
      }),

      defineTool({
        name: 'garantias_resumo',
        area: 'garantias',
        description:
          'Garantias de equipamentos: as que terminam primeiro, quantas estão sem termo cadastrado e quantas vencem na janela de aviso.',
        permissions: ['ops.plant.read'],
        mirrors: { controller: AftersalesController, handler: 'listWarranties' },
        params: z.object({ limit: limitParam(20) }),
        run: async (ctx, p) => {
          const d = await this.aftersales.get();
          const upcoming = await db().assetWarranty.findMany({
            where: { endsOn: { gte: ctx.now } },
            orderBy: { endsOn: 'asc' },
            take: p.limit,
            select: { assetId: true, kind: true, endsOn: true },
          });
          const assets = await db().plantAsset.findMany({
            where: { id: { in: upcoming.map((w) => w.assetId) } },
            select: { id: true, manufacturer: true, model: true, category: true, plantId: true },
          });
          const plants = await db().plant.findMany({
            where: { id: { in: assets.map((a) => a.plantId) } },
            select: { id: true, projectCode: true },
          });
          const asset = new Map(assets.map((a) => [a.id, a]));
          const code = new Map(plants.map((x) => [x.id, x.projectCode]));
          return {
            warrantiesExpiringCount: d.warrantiesExpiring,
            warrantiesMissingCount: d.warrantiesMissing,
            proximasAVencer: upcoming.map((w) => {
              const a = asset.get(w.assetId);
              return {
                tipo: w.kind,
                termina: iso(w.endsOn),
                equipamento: a ? `${a.manufacturer} ${a.model}` : null,
                categoria: a?.category ?? null,
                projectCode: a ? (code.get(a.plantId) ?? null) : null,
              };
            }),
          };
        },
      }),

      defineTool({
        name: 'om_contratos',
        area: 'contratos de O&M',
        description:
          'Contratos de operação e manutenção: ativos, receita mensal recorrente, os que terminam nos próximos 60 dias e renovação automática.',
        permissions: ['ops.plant.read'],
        mirrors: { controller: AftersalesController, handler: 'listContracts' },
        params: z.object({ limit: limitParam(20) }),
        run: async (ctx, p) => {
          const rows = await db().omContract.findMany({
            where: { status: 'ACTIVE' },
            orderBy: { endsOn: 'asc' },
            select: {
              plantId: true,
              accountId: true,
              monthlyCents: true,
              endsOn: true,
              autoRenew: true,
            },
          });
          const soon = rows.filter((r) => r.endsOn.getTime() - ctx.now.getTime() <= 60 * DAY);
          const [plants, accounts] = await Promise.all([
            db().plant.findMany({
              where: { id: { in: soon.slice(0, p.limit).map((r) => r.plantId) } },
              select: { id: true, projectCode: true },
            }),
            db().account.findMany({
              where: { id: { in: soon.slice(0, p.limit).map((r) => r.accountId) } },
              select: { id: true, name: true },
            }),
          ]);
          const code = new Map(plants.map((x) => [x.id, x.projectCode]));
          const name = new Map(accounts.map((a) => [a.id, a.name]));
          return {
            activeCount: rows.length,
            mrrCents: rows.reduce((a, r) => a + r.monthlyCents, 0),
            autoRenewCount: rows.filter((r) => r.autoRenew).length,
            endingSoonCount: soon.length,
            terminamEmBreve: soon.slice(0, p.limit).map((r) => ({
              projectCode: code.get(r.plantId) ?? null,
              cliente: name.has(r.accountId)
                ? ctx.client(r.accountId, name.get(r.accountId)!)
                : null,
              monthlyCents: r.monthlyCents,
              termina: iso(r.endsOn),
              renovacaoAutomatica: r.autoRenew,
            })),
          };
        },
      }),
    ];
  }
}
