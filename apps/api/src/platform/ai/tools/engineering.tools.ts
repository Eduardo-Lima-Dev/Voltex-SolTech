import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CalculatorController } from '../../../products/calculator/calculator.controller';
import { EngineeringController } from '../../../products/engine/engineering.controller';
import { EngineeringRequestsService } from '../../../products/engine/engineering-requests.service';
import { OffgridController } from '../../../products/offgrid/offgrid.controller';
import { OffgridRequestsService } from '../../../products/offgrid/offgrid-requests.service';
import { PrismaService } from '../../prisma/prisma.service';
import { iso, periodParams } from './tool-helpers';
import { defineTool, type AiToolDefinition, type AiToolSet } from './tool';

const DAY = 86_400_000;

/** Engenharia: Engine, Off-Grid e cálculos rápidos. */
@Injectable()
export class EngineeringTools implements AiToolSet {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: EngineeringRequestsService,
    private readonly offgrid: OffgridRequestsService,
  ) {}

  private cache: AiToolDefinition[] | null = null;
  get tools(): readonly AiToolDefinition[] {
    return (this.cache ??= this.build());
  }

  private build(): AiToolDefinition[] {
    return [
      defineTool({
        name: 'engenharia_painel',
        area: 'engenharia',
        description:
          'Painel da engenharia (Engine): pedidos abertos, atrasados, sem responsável, urgentes, tempo médio de resolução, carga por responsável e os próximos prazos.',
        permissions: ['engine.request.manage'],
        mirrors: { controller: EngineeringController, handler: 'dashboard' },
        params: z.object({}),
        run: async (ctx) => {
          const d = await this.requests.dashboard();
          return {
            byStatus: d.byStatus,
            openCount: d.open,
            overdueCount: d.overdue,
            unassignedCount: d.unassigned,
            urgentCount: d.urgent,
            avgResolutionDays: d.avgResolutionDays,
            projetos: d.projects,
            porResponsavel: d.byAssignee.map((a) => ({
              responsavel: a.id ? ctx.person(a.id, a.name) : 'Sem responsável',
              openCount: a.open,
            })),
            proximosPrazos: d.upcoming.map((u) => ({
              projectCode: u.projectCode,
              dueAt: u.dueAt,
              prioridade: u.priority,
            })),
          };
        },
      }),

      defineTool({
        name: 'offgrid_painel',
        area: 'projetos off-grid',
        description:
          'Painel do Off-Grid Designer: pedidos e projetos por situação, versões aguardando revisão e pedidos atrasados.',
        permissions: ['offgrid.project.read'],
        mirrors: { controller: OffgridController, handler: 'dashboard' },
        params: z.object({}),
        run: async () => {
          const d = await this.offgrid.dashboard();
          return {
            pedidosPorSituacao: d.requests,
            projetosPorSituacao: d.projects,
            versionsAwaitingReviewCount: d.versionsAwaitingReview,
            overdueRequestsCount: d.overdueRequests,
          };
        },
      }),

      defineTool({
        name: 'calculos_resumo',
        area: 'cálculos rápidos',
        description:
          'Cálculos rápidos (Solar Calculator) do período: quantos foram feitos e a distribuição do semáforo (verde, amarelo, vermelho).',
        permissions: ['calculator.session.read'],
        mirrors: { controller: CalculatorController, handler: 'list' },
        params: z.object(periodParams),
        run: async (_ctx, p) => {
          const to = p.to ?? new Date();
          const from = p.from ?? new Date(to.getTime() - 90 * DAY);
          const rows = await this.prisma.db.calculationSession.groupBy({
            by: ['trafficLight'],
            where: { deletedAt: null, createdAt: { gte: from, lte: to } },
            _count: { _all: true },
          });
          return {
            from: iso(from),
            to: iso(to),
            totalCount: rows.reduce((a, r) => a + r._count._all, 0),
            porSemaforo: rows.map((r) => ({ semaforo: r.trafficLight, count: r._count._all })),
          };
        },
      }),
    ];
  }
}
