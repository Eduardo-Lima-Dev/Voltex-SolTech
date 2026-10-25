import { z } from 'zod';
import { isoDateTimeSchema } from './common.js';

/**
 * Camada analítica (Fase 12C, RF-PLAT-018). Métricas determinísticas sobre os dados da empresa, com amostra mínima
 * declarada. Os padrões abaixo são PRUDÊNCIA ESTATÍSTICA DA PLATAFORMA, não norma: a empresa pode ajustá-los.
 */
export const ANALYTICS_DEFAULT_MIN_SAMPLES = {
  /** Clientes com margem real recebida para falar em "clientes com mais potencial". */
  potentialClients: 25,
  /** Registros por grupo (origem, segmento, UF, vendedor) para entrar em ranking e comparação. */
  groupSize: 5,
  /** Oportunidades encerradas (ganhas + perdidas) para falar em taxa de conversão geral. */
  funnelClosed: 30,
  /** Parcelas pagas para a previsão de recebimentos (12I). */
  receivablesPaid: 20,
  /** Instalações concluídas para a previsão de atraso (12I). */
  installationsDone: 10,
  /** Dias de leitura para a tendência de geração (12I). */
  generationDays: 14,
  /** Registros para médias simples (ticket médio, ciclo médio, tempo de resolução). */
  simpleAverage: 5,
} as const;
export type AnalyticsMinSamples = {
  -readonly [K in keyof typeof ANALYTICS_DEFAULT_MIN_SAMPLES]: number;
};

export const BEST_CLIENT_CRITERIA = ['MARGIN', 'RECEIVED', 'PROJECTS', 'OM'] as const;
export type BestClientCriterion = (typeof BEST_CLIENT_CRITERIA)[number];

const minSample = z.number().int().min(3).max(1000);

/** Configuração da análise da empresa, guardada em `tenant.settings.analytics`. Tudo opcional: faltando, vale o padrão. */
export const analyticsSettingsSchema = z.object({
  minSamples: z
    .object({
      potentialClients: minSample.optional(),
      groupSize: minSample.optional(),
      funnelClosed: minSample.optional(),
      receivablesPaid: minSample.optional(),
      installationsDone: minSample.optional(),
      generationDays: minSample.optional(),
      simpleAverage: minSample.optional(),
    })
    .default({}),
  /** Fatia dos clientes tratada como "os melhores" (padrão: 20%). */
  bestClientShare: z.number().min(0.05).max(0.5).default(0.2),
  /** Como medir "melhor cliente" (padrão: margem real recebida). */
  bestClientCriterion: z.enum(BEST_CLIENT_CRITERIA).default('MARGIN'),
  /** Dias sem movimento na etapa para a oportunidade ser dada como parada (padrão: 14). */
  stalledDays: z.number().int().min(3).max(180).default(14),
});
export type AnalyticsSettingsInput = z.input<typeof analyticsSettingsSchema>;

export interface AnalyticsSettings {
  minSamples: AnalyticsMinSamples;
  bestClientShare: number;
  bestClientCriterion: BestClientCriterion;
  stalledDays: number;
}

export const FUNNEL_GROUP_BY = ['source', 'segment', 'state', 'owner', 'projectType'] as const;
export type FunnelGroupBy = (typeof FUNNEL_GROUP_BY)[number];

export const analyticsPeriodQuerySchema = z.object({
  /** Período (padrão: últimos 90 dias). */
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

export const funnelQuerySchema = analyticsPeriodQuerySchema.extend({
  groupBy: z.enum(FUNNEL_GROUP_BY).default('source'),
});
export type FunnelQuery = z.output<typeof funnelQuerySchema>;

export const CLIENT_SORTS = [
  'margin',
  'received',
  'contracted',
  'overdue',
  'projects',
  'tickets',
] as const;
export const clientsQuerySchema = z.object({
  sortBy: z.enum(CLIENT_SORTS).default('margin'),
  order: z.enum(['desc', 'asc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ClientsQuery = z.output<typeof clientsQuerySchema>;

export const potentialQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(10),
});
export type PotentialQuery = z.output<typeof potentialQuerySchema>;

export const stalledQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
