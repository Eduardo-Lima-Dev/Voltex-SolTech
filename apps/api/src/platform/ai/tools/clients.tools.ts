import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CLIENT_SORTS } from '@voltex/shared';
import { AnalyticsController } from '../../analytics/analytics.controller';
import { AnalyticsService } from '../../analytics/analytics.service';
import { LABELS, limitParam, notFound } from './tool-helpers';
import { defineTool, type AiToolDefinition, type AiToolSet, type ToolContext } from './tool';

/** Clientes: ranking, perfil, risco e semelhança com os melhores (camada analítica da 12C). */
@Injectable()
export class ClientsTools implements AiToolSet {
  constructor(private readonly analytics: AnalyticsService) {}

  private cache: AiToolDefinition[] | null = null;
  get tools(): readonly AiToolDefinition[] {
    return (this.cache ??= this.build());
  }

  /** Linha de cliente sem nome real nem id: só o pseudônimo. */
  private row(ctx: ToolContext, r: Awaited<ReturnType<AnalyticsService['client']>>) {
    const { accountId, accountName, ...rest } = r;
    return {
      cliente: ctx.client(accountId, accountName),
      ...rest,
      segment: LABELS.segment(r.segment),
    };
  }

  private build(): AiToolDefinition[] {
    const finance = (ctx: ToolContext) => ctx.user.permissions.includes('crm.finance.read');
    return [
      defineTool({
        name: 'clientes_ranking',
        area: 'clientes',
        description:
          'Ranking de clientes (contas com projeto) por margem real, valor recebido, valor contratado, inadimplência, número de projetos ou chamados. Valores financeiros só aparecem se o perfil tiver acesso ao financeiro.',
        permissions: ['crm.account.read'],
        mirrors: { controller: AnalyticsController, handler: 'clients' },
        params: z.object({
          sortBy: z.enum(CLIENT_SORTS).default('margin'),
          order: z.enum(['desc', 'asc']).default('desc'),
          limit: limitParam(20, 10),
        }),
        run: async (ctx, p) => {
          const out = await this.analytics.clients(p, finance(ctx));
          return { ...out, rows: out.rows.map((r) => this.row(ctx, r)) };
        },
      }),

      defineTool({
        name: 'cliente_perfil',
        area: 'clientes',
        description:
          'Perfil de um cliente (use o pseudônimo, como [CLIENTE_1]): projetos, contratado, recebido, margem real, inadimplência, usinas, chamados e contratos de O&M.',
        permissions: ['crm.account.read'],
        mirrors: { controller: AnalyticsController, handler: 'client' },
        params: z.object({
          cliente: z
            .string()
            .trim()
            .min(3)
            .max(60)
            .describe('Pseudônimo do cliente, como [CLIENTE_1].'),
        }),
        run: async (ctx, p) => {
          const id = ctx.resolve('CLIENTE', p.cliente);
          if (!id) return notFound();
          return this.row(ctx, await this.analytics.client(id, finance(ctx)));
        },
      }),

      defineTool({
        name: 'clientes_potencial',
        area: 'clientes com mais potencial',
        description:
          'Leads e contas em negociação que mais se parecem com os melhores clientes da empresa, com a explicação de cada atributo. É semelhança, não probabilidade de fechar. Sem clientes suficientes, informa a amostra.',
        permissions: ['crm.account.read', 'crm.finance.read'],
        mirrors: { controller: AnalyticsController, handler: 'potential' },
        params: z.object({ limit: limitParam(20, 10) }),
        run: async (ctx, p) => {
          const out = await this.analytics.potential(
            p,
            ctx.user.permissions.includes('crm.lead.read'),
          );
          if (out.status === 'INSUFFICIENT_SAMPLE') return out;
          return {
            status: out.status,
            data: {
              ...out.data,
              candidates: out.data.candidates.map(({ id, name, kind, ...c }) => ({
                ...c,
                tipo: kind === 'LEAD' ? 'lead' : 'conta em negociação',
                candidato: kind === 'LEAD' ? ctx.contact(id, name) : ctx.client(id, name),
              })),
            },
          };
        },
      }),

      defineTool({
        name: 'clientes_risco',
        area: 'clientes em risco',
        description:
          'Clientes que merecem atenção: com parcelas vencidas, margem real negativa ou chamados abertos, do mais urgente (maior valor vencido) para o menos.',
        permissions: ['crm.account.read', 'crm.finance.read'],
        mirrors: { controller: AnalyticsController, handler: 'clients' },
        params: z.object({ limit: limitParam(20, 10) }),
        run: async (ctx, p) => {
          const all = await this.analytics.clients(
            { sortBy: 'overdue', order: 'desc', limit: 50 },
            true,
          );
          const risky = all.rows
            .filter(
              (r) =>
                (r.overdueCents ?? 0) > 0 || (r.marginRealCents ?? 0) < 0 || r.openTicketsCount > 0,
            )
            .slice(0, p.limit);
          return {
            clientsCount: all.clientsCount,
            riskyCount: risky.length,
            clientes: risky.map((r) => ({
              ...this.row(ctx, r),
              motivos: [
                ...((r.overdueCents ?? 0) > 0 ? ['parcela vencida'] : []),
                ...((r.marginRealCents ?? 0) < 0 ? ['margem real negativa'] : []),
                ...(r.openTicketsCount > 0 ? ['chamado aberto'] : []),
              ],
            })),
          };
        },
      }),
    ];
  }
}
