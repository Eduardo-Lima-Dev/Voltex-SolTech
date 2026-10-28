import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ForecastsController } from '../../analytics/forecasts.controller';
import { ForecastsService } from '../../analytics/forecasts.service';
import { defineTool, type AiToolDefinition, type AiToolSet } from './tool';
import { projectCodeParam } from './tool-helpers';

/** Amostra pequena demais: o assistente responde "não posso responder com segurança" (regra 6 da instrução). */
const insufficient = (sample: number, required: number) => ({
  status: 'INSUFFICIENT_SAMPLE' as const,
  sampleCount: sample,
  requiredCount: required,
  aviso: 'Dados insuficientes para prever com segurança.',
});

/** Previsões determinísticas (12I). A IA só explica: o cálculo é do motor (`docs/06-calculos/previsoes.md`). */
@Injectable()
export class ForecastTools implements AiToolSet {
  constructor(private readonly forecasts: ForecastsService) {}

  private cache: AiToolDefinition[] | null = null;
  get tools(): readonly AiToolDefinition[] {
    return (this.cache ??= this.build());
  }

  private build(): AiToolDefinition[] {
    return [
      defineTool({
        name: 'previsoes_recebimentos',
        area: 'financeiro',
        description:
          'Previsão dos recebimentos dos próximos 90 dias: o que deve entrar no melhor cenário, no esperado e no pior, pelo histórico de atraso da própria empresa, e o que não dá para datar.',
        permissions: ['crm.finance.read'],
        mirrors: { controller: ForecastsController, handler: 'receivables' },
        params: z.object({}),
        run: async () => {
          const f = await this.forecasts.receivables();
          if (f.status !== 'OK') return insufficient(f.sample, f.required);
          return {
            status: f.status,
            sampleCount: f.sample,
            openCents: f.openCents,
            horizonDays: f.horizonDays,
            melhorCenario: { receivedCents: f.withinHorizon.best },
            esperado: { receivedCents: f.withinHorizon.expected },
            piorCenario: { receivedCents: f.withinHorizon.worst },
            alemDoHorizonteEsperadoCents: f.beyondHorizon.expected,
            semDataCents: f.unplacedCents,
            primeirasSemanas: f.weeks.slice(0, 4).map((w) => ({
              start: w.start,
              expectedCents: w.expectedCents,
            })),
          };
        },
      }),

      defineTool({
        name: 'previsoes_funil',
        area: 'funil de vendas',
        description:
          'Previsão de fechamento do funil: valor e quantidade esperados por mês, com faixa, pela taxa de ganho histórica de cada etapa.',
        permissions: ['crm.opportunity.read'],
        mirrors: { controller: ForecastsController, handler: 'funnel' },
        params: z.object({}),
        run: async () => {
          const f = await this.forecasts.funnel();
          if (f.status !== 'OK') return insufficient(f.sample, f.required);
          return {
            status: f.status,
            sampleCount: f.sample,
            openCount: f.openCount,
            overallWinRate: f.overallWinRate,
            meses: f.months.slice(0, 6).map((m) => ({
              month: m.month,
              expectedCount: m.expectedCount,
              expectedCents: m.expectedCents,
              worstCents: m.worstCents,
              bestCents: m.bestCents,
            })),
            semDataCount: f.undatedCount,
            semValorCount: f.withoutValueCount,
          };
        },
      }),

      defineTool({
        name: 'previsoes_instalacoes',
        area: 'operação e instalações',
        description:
          'Previsão de conclusão das instalações em andamento, pelo tempo médio das concluídas em cada situação, e quais já passaram do normal.',
        permissions: ['ops.installation.read'],
        mirrors: { controller: ForecastsController, handler: 'installations' },
        params: z.object({}),
        run: async () => {
          const f = await this.forecasts.installations();
          if (f.status !== 'OK') return insufficient(f.sample, f.required);
          const risk = f.installations.filter((i) => i.atRisk);
          const dates = f.installations.map((i) => i.estimatedDoneOn).sort();
          return {
            status: f.status,
            sampleCount: f.sample,
            inProgressCount: f.installations.length,
            atRiskCount: risk.length,
            earliestDoneOn: dates[0] ?? null,
            latestDoneOn: dates[dates.length - 1] ?? null,
          };
        },
      }),

      defineTool({
        name: 'previsoes_geracao',
        area: 'pós-venda',
        description:
          'Projeção da geração do mês de uma usina (código do projeto) e índice de desempenho real contra o esperado do projeto, pelas leituras recentes.',
        permissions: ['ops.plant.read'],
        mirrors: { controller: ForecastsController, handler: 'generation' },
        params: z.object({ projeto: projectCodeParam }),
        run: async (_ctx, p) => {
          const f = await this.forecasts.generation(p.projeto);
          if (f.status !== 'OK') return insufficient(f.sample, f.required);
          return {
            projectCode: f.projectCode,
            status: f.status,
            sampleCount: f.sample,
            performanceRatio: f.performanceRatio,
            monthExpectedKwh: f.monthExpectedKwh,
            monthToDateKwh: f.monthToDateKwh,
            monthProjectedKwh: f.monthProjectedKwh,
            lastReadingOn: f.lastReadingOn,
          };
        },
      }),
    ];
  }
}
