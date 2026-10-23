import { z } from 'zod';

export const CreateReceivableInput = z.object({
  referenceId: z.string().min(1, 'ID de referência obrigatório'),
  order: z.number().int().positive('Número da parcela deve ser positivo'),
  amountCents: z.number().int().positive('Valor deve ser positivo'),
  dueAt: z.string().datetime('Data de vencimento inválida'),
});
export type CreateReceivableInput = z.infer<typeof CreateReceivableInput>;

export const ReceivableDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  referenceId: z.string(),
  order: z.number(),
  amountCents: z.number(),
  dueAt: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
  paymentMethod: z.string().nullable(),
  status: z.enum(['OPEN', 'PAID', 'OVERDUE', 'CANCELLED']),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ReceivableDto = z.infer<typeof ReceivableDto>;

export const ProjectCostEntryDto = z.object({
  id: z.string().uuid(),
  category: z.string(),
  description: z.string(),
  estimatedCents: z.number().nullable(),
  actualCents: z.number(),
  supplier: z.string().nullable(),
  recordedAt: z.string().datetime(),
});
export type ProjectCostEntryDto = z.infer<typeof ProjectCostEntryDto>;

export const ProjectFinancialSummaryDto = z.object({
  projectId: z.string().uuid(),
  valueCents: z.number(),
  totalReceivedCents: z.number(),
  totalCostsCents: z.number(),
  totalCommissionsCents: z.number(),
  marginCents: z.number(),
  marginPct: z.number(),
  receivablesCount: z.number(),
  receivablesPaidCount: z.number(),
  overdueCount: z.number(),
  receivables: z.array(ReceivableDto),
  costEntries: z.array(ProjectCostEntryDto),
});
export type ProjectFinancialSummaryDto = z.infer<typeof ProjectFinancialSummaryDto>;

export const CreateCommissionPolicyInput = z.object({
  base: z.enum(['RECEIVED', 'SIGNED']),
  weights: z.record(z.string(), z.number()),
  validFrom: z.string(),
  notes: z.string().optional(),
});
export type CreateCommissionPolicyInput = z.infer<typeof CreateCommissionPolicyInput>;

export const CommissionPolicyDto = z.object({
  id: z.string().uuid(),
  base: z.string(),
  weights: z.record(z.string(), z.number()),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CommissionPolicyDto = z.infer<typeof CommissionPolicyDto>;

export const CommissionDto = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  amountCents: z.number(),
  calculatedAt: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
});
export type CommissionDto = z.infer<typeof CommissionDto>;

export const CreateCreditApplicationInput = z.object({
  institution: z.string().min(1, 'Instituição obrigatória'),
  amountCents: z.number().int().positive('Valor deve ser positivo'),
  annualRatePct: z.number().positive('Taxa deve ser positiva').optional(),
  termMonths: z.number().int().positive('Prazo deve ser positivo').optional(),
});
export type CreateCreditApplicationInput = z.infer<typeof CreateCreditApplicationInput>;

export const CreditApplicationDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  institution: z.string(),
  status: z.enum(['SIMULATED', 'SENT', 'PENDING', 'APPROVED', 'REJECTED']),
  annualRatePct: z.number().nullable(),
  termMonths: z.number().nullable(),
  amountCents: z.number(),
  totalCents: z.number().nullable(),
  pendencies: z.array(z.string()),
  appliedAt: z.string().datetime().nullable(),
  respondedAt: z.string().datetime().nullable(),
});
export type CreditApplicationDto = z.infer<typeof CreditApplicationDto>;
