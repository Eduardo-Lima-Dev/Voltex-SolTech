import { z } from 'zod';

/** Financeiro por projeto (11G). Tudo manual: não há gateway de pagamento nem integração bancária. */

const isoDate = z.iso.date();

export const RECEIVABLE_STATUSES = ['OPEN', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const COST_CATEGORIES = ['MATERIAL', 'LABOR', 'TRANSPORT', 'TAXES', 'OTHER'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const CREDIT_STATUSES = ['SIMULATED', 'SENT', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export const COMMISSION_BASES = ['RECEIVED', 'SIGNED'] as const;
export type CommissionBase = (typeof COMMISSION_BASES)[number];

export const createReceivableSchema = z.object({
  referenceId: z.string().trim().min(1).max(80),
  order: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  dueOn: isoDate,
  notes: z.string().trim().max(500).optional(),
});
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>;

export const markReceivablePaidSchema = z.object({
  paymentMethod: z.string().trim().min(1).max(60),
  /** Data do recebimento; sem ela vale hoje. */
  paidOn: isoDate.optional(),
  receiptDocumentId: z.uuid().optional(),
});
export type MarkReceivablePaidInput = z.infer<typeof markReceivablePaidSchema>;

export const cancelReceivableSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type CancelReceivableInput = z.infer<typeof cancelReceivableSchema>;

export const createCostEntrySchema = z.object({
  category: z.enum(COST_CATEGORIES),
  description: z.string().trim().min(1).max(200),
  actualCents: z.number().int().nonnegative(),
  estimatedCents: z.number().int().nonnegative().optional(),
  supplier: z.string().trim().max(120).optional(),
  documentId: z.uuid().optional(),
});
export type CreateCostEntryInput = z.infer<typeof createCostEntrySchema>;

export const createCreditApplicationSchema = z.object({
  institution: z.string().trim().min(1).max(120),
  amountCents: z.number().int().positive(),
  /** Taxa anual em %, como informada pela instituição. */
  annualRatePct: z.number().positive().max(1000).optional(),
  termMonths: z.number().int().positive().max(480).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateCreditApplicationInput = z.infer<typeof createCreditApplicationSchema>;

export const updateCreditStatusSchema = z.object({
  status: z.enum(['SENT', 'PENDING', 'APPROVED', 'REJECTED']),
  pendencies: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type UpdateCreditStatusInput = z.infer<typeof updateCreditStatusSchema>;

/**
 * Política de comissão da empresa. Sem valor padrão: quem define é a empresa.
 * `weights`: percentual (0–100) por perfil (`SALESPERSON`) ou por usuário (id); o id do usuário tem precedência.
 */
export const createCommissionPolicySchema = z.object({
  base: z.enum(COMMISSION_BASES),
  weights: z.record(z.string().min(1).max(64), z.number().min(0).max(100)),
  validFrom: isoDate,
  notes: z.string().trim().max(500).optional(),
});
export type CreateCommissionPolicyInput = z.infer<typeof createCommissionPolicySchema>;

export const markCommissionPaidSchema = z.object({ paidOn: isoDate.optional() });
export type MarkCommissionPaidInput = z.infer<typeof markCommissionPaidSchema>;
