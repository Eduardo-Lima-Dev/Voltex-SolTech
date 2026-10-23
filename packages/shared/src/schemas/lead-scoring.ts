import { z } from 'zod';

export const LeadScoringCriteriaSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  weight: z.number().min(0).max(100),
  type: z.enum(['origin', 'consumption', 'profile', 'region']),
  values: z.record(z.number()),
  active: z.boolean().default(true),
  createdAt: z.coerce.date(),
});
export type LeadScoringCriteria = z.infer<typeof LeadScoringCriteriaSchema>;

export const LeadScoreDtoSchema = z.object({
  leadId: z.string().uuid(),
  score: z.number().min(0).max(100),
  breakdown: z.record(z.number()),
  suggestedRoute: z.string().optional(),
  routable: z.boolean(),
});
export type LeadScoreDto = z.infer<typeof LeadScoreDtoSchema>;

export const LeadRoutingPolicySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  method: z.enum(['roundRobin', 'region', 'availability']),
  config: z.record(z.unknown()),
  active: z.boolean(),
});
export type LeadRoutingPolicy = z.infer<typeof LeadRoutingPolicySchema>;
