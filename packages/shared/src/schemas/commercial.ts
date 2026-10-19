import { z } from 'zod';
import { ApprovalStatus, ProjectType } from '../enums/index.js';
import { paginationQuerySchema } from './common.js';

/** Triagem, margem e proposta (Fase 7B). */

// ---- Política de margem (Margin Guard) ----

const marginRate = z.number().min(0).max(0.95);

/** Margem mínima como fração do preço (0,2 = 20%). Pode valer para a empresa toda, um time e/ou um tipo de projeto. */
export const createMarginPolicySchema = z.object({
  name: z.string().trim().min(2).max(80),
  minMarginRate: marginRate,
  projectType: z.enum(ProjectType).optional(),
  teamId: z.uuid().optional(),
});
export type CreateMarginPolicyInput = z.input<typeof createMarginPolicySchema>;
export type CreateMarginPolicyData = z.output<typeof createMarginPolicySchema>;

/** Atualização parcial: sem reaplicar padrões. */
export const updateMarginPolicySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  minMarginRate: marginRate.optional(),
  active: z.boolean().optional(),
});
export type UpdateMarginPolicyInput = z.input<typeof updateMarginPolicySchema>;
export type UpdateMarginPolicyData = z.output<typeof updateMarginPolicySchema>;

// ---- Aprovação de margem ----

export const requestApprovalSchema = z.object({
  justification: z
    .string()
    .trim()
    .min(10, 'Explique por que a margem abaixo do mínimo é aceitável')
    .max(500),
});
export type RequestApprovalInput = z.infer<typeof requestApprovalSchema>;

export const decideApprovalSchema = z.object({
  approve: z.boolean(),
  justification: z.string().trim().min(5, 'Registre o motivo da decisão').max(500),
});
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;

export const listApprovalsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ApprovalStatus).optional(),
});
export type ListApprovalsQuery = z.output<typeof listApprovalsQuerySchema>;

// ---- Triagem (Project Guard) ----

/** Liberar uma triagem amarela ou vermelha exige justificativa formal, que fica na auditoria. */
export const overrideGuardSchema = z.object({
  evaluationId: z.uuid(),
  justification: z
    .string()
    .trim()
    .min(10, 'Justifique a liberação (mínimo de 10 caracteres)')
    .max(500),
});
export type OverrideGuardInput = z.infer<typeof overrideGuardSchema>;

// ---- Proposta ----

export const MAX_PROPOSAL_SCENARIOS = 3;

export const createProposalSchema = z.object({
  /** De 1 a 3 cotações da oportunidade: cada uma vira um cenário. */
  quoteIds: z.array(z.uuid()).min(1).max(MAX_PROPOSAL_SCENARIOS),
  /** Nome de cada cenário (mesma ordem de `quoteIds`); sem nome, usa "Cenário N". */
  labels: z.array(z.string().trim().min(1).max(60)).max(MAX_PROPOSAL_SCENARIOS).optional(),
  validityDays: z.number().int().min(1).max(90).default(15),
  paymentTerms: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateProposalInput = z.input<typeof createProposalSchema>;
export type CreateProposalData = z.output<typeof createProposalSchema>;

/** Aceite online pelo cliente (página pública). */
export const acceptProposalSchema = z.object({
  name: z.string().trim().min(3, 'Informe seu nome completo').max(160),
  document: z.string().trim().max(32).optional(),
  acknowledge: z.literal(true, { error: 'É necessário confirmar o aceite' }),
});
export type AcceptProposalInput = z.input<typeof acceptProposalSchema>;

/** Identidade visual da empresa nas propostas (guardada em `tenant.settings.branding`). */
export const brandingSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
    .optional(),
  /** Documento (PNG/JPEG) enviado pela própria empresa. */
  logoDocumentId: z.uuid().nullable().optional(),
});
export type Branding = z.infer<typeof brandingSchema>;
