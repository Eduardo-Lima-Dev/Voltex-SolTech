import { z } from 'zod';
import {
  CustomerGroup,
  CustomerSegment,
  LeadSource,
  OpportunityStage,
  ProjectType,
} from '../enums/index.js';
import { emailSchema, phoneSchema } from './common.js';

export const utmSchema = z.object({
  source: z.string().optional(),
  medium: z.string().optional(),
  campaign: z.string().optional(),
  term: z.string().optional(),
  content: z.string().optional(),
});
export type Utm = z.infer<typeof utmSchema>;

export const createLeadSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  document: z.string().trim().optional(),
  source: z.enum(LeadSource).default(LeadSource.MANUAL),
  segment: z.enum(CustomerSegment).optional(),
  preliminaryGroup: z.enum(CustomerGroup).optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().length(2).toUpperCase().optional(),
  notes: z.string().max(2000).optional(),
  utm: utmSchema.optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const createOpportunitySchema = z.object({
  accountId: z.string(),
  siteId: z.string().optional(),
  consumerUnitId: z.string().optional(),
  projectType: z.enum(ProjectType).default(ProjectType.ON_GRID),
  title: z.string().trim().min(2).max(160).optional(),
  ownerId: z.string().optional(),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const changeStageSchema = z
  .object({
    stage: z.enum(OpportunityStage),
    lostReason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((v) => v.stage !== OpportunityStage.LOST || !!v.lostReason, {
    path: ['lostReason'],
    message: 'O motivo da perda é obrigatório',
  });
export type ChangeStageInput = z.infer<typeof changeStageSchema>;
