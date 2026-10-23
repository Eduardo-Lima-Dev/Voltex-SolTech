import { z } from 'zod';
import { CustomerSegment, LeadSource } from '../enums/index.js';

/**
 * Pontuação e distribuição de leads (RF-CRM-006). Tudo definido pela empresa: pesos, pontos e quem recebe.
 * Sem critérios cadastrados, nenhum lead é pontuado; sem regra de distribuição, nenhum lead é atribuído sozinho.
 */

const stateSchema = z.string().regex(/^[A-Z]{2}$/, 'Use a sigla do estado em maiúsculas (ex.: SP)');
const points = z.number().min(0).max(100);
const weight = z.number().int().min(1).max(100);

const sourceCriterion = z.object({
  key: z.literal('SOURCE'),
  weight,
  points: z.partialRecord(z.enum(LeadSource), points),
});
const segmentCriterion = z.object({
  key: z.literal('SEGMENT'),
  weight,
  points: z.partialRecord(z.enum(CustomerSegment), points),
});
const stateCriterion = z.object({
  key: z.literal('STATE'),
  weight,
  points: z.record(stateSchema, points),
});
const billCriterion = z.object({
  key: z.literal('MONTHLY_BILL'),
  weight,
  /** Vale a faixa de maior `minCents` que não passa do valor da conta de luz do lead. */
  ranges: z
    .array(z.object({ minCents: z.number().int().min(0).max(100_000_000), points }))
    .min(1)
    .max(10),
});

export const leadScoringCriterionSchema = z.discriminatedUnion('key', [
  sourceCriterion,
  segmentCriterion,
  stateCriterion,
  billCriterion,
]);
export type LeadScoringCriterion = z.infer<typeof leadScoringCriterionSchema>;
export type LeadScoringCriterionKey = LeadScoringCriterion['key'];

export const LEAD_ROUTING_METHODS = ['NONE', 'ROUND_ROBIN', 'REGION'] as const;
export type LeadRoutingMethod = (typeof LEAD_ROUTING_METHODS)[number];

export const leadRoutingSchema = z.object({
  method: z.enum(LEAD_ROUTING_METHODS).default('NONE'),
  /** Vendedores do rodízio. Vazio = todos os vendedores ativos. */
  userIds: z.array(z.uuid()).max(50).default([]),
  /** Por estado do lead (`REGION`). Estado sem região cadastrada fica sem responsável. */
  regions: z
    .array(
      z.object({
        states: z.array(stateSchema).min(1).max(27),
        userIds: z.array(z.uuid()).min(1).max(50),
      }),
    )
    .max(20)
    .default([]),
});
export type LeadRouting = z.output<typeof leadRoutingSchema>;

export const leadScoringConfigSchema = z
  .object({
    criteria: z.array(leadScoringCriterionSchema).max(4).default([]),
    routing: leadRoutingSchema.default({ method: 'NONE', userIds: [], regions: [] }),
  })
  .superRefine((config, ctx) => {
    const keys = config.criteria.map((c) => c.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['criteria'],
        message: 'Cada critério só pode aparecer uma vez',
      });
    if (config.routing.method === 'REGION' && config.routing.regions.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['routing', 'regions'],
        message: 'Cadastre ao menos uma região para distribuir por região',
      });
  });
export type LeadScoringConfig = z.output<typeof leadScoringConfigSchema>;
export type LeadScoringConfigInput = z.input<typeof leadScoringConfigSchema>;

export interface LeadScoreBreakdownItem {
  key: LeadScoringCriterionKey;
  weight: number;
  points: number;
}
