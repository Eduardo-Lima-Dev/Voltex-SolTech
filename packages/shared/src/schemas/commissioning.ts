import { z } from 'zod';
import {
  COMMISSIONING_EXPECTED,
  COMMISSIONING_LEVELS,
  COMMISSIONING_SCOPES,
  COMMISSIONING_TEST_KINDS,
} from './rules.js';

/** Comissionamento (Fase 11D, ADR-0022): registros, ensaios, aprovação e aceite do cliente. */

export const COMMISSIONING_STATUSES = ['IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type CommissioningStatus = (typeof COMMISSIONING_STATUSES)[number];

export const COMMISSIONING_RESULTS = [
  'PENDING',
  'PENDING_RULE',
  'PENDING_DATA',
  'PASS',
  'FAIL',
  'NOT_APPLICABLE',
] as const;
export type CommissioningResultValue = (typeof COMMISSIONING_RESULTS)[number];

/** Condições medidas no local, com instrumento próprio. */
export const measurementConditionsSchema = z.object({
  irradianceWm2: z.number().min(0).max(2000).nullable().optional(),
  moduleTempC: z.number().min(-40).max(130).nullable().optional(),
  ambientC: z.number().min(-60).max(70).nullable().optional(),
});
export type MeasurementConditionsInput = z.infer<typeof measurementConditionsSchema>;

export const updateCommissioningSchema = z.object({
  level: z.enum(COMMISSIONING_LEVELS).optional(),
  conditions: measurementConditionsSchema.optional(),
});
export type UpdateCommissioningInput = z.infer<typeof updateCommissioningSchema>;

export const recordMeasurementSchema = z
  .object({
    /** Valor medido (ensaio de medição). */
    value: z.number().finite().nullable().optional(),
    /** Conforme ou não (ensaio de conferência). */
    passed: z.boolean().nullable().optional(),
    note: z.string().trim().max(500).optional(),
    /** Condições desta medição, quando diferem das do registro. */
    irradianceWm2: z.number().min(0).max(2000).optional(),
    moduleTempC: z.number().min(-40).max(130).optional(),
  })
  .refine((v) => v.value !== undefined || v.passed !== undefined || v.note !== undefined, {
    message: 'Informe o valor medido, a conformidade ou uma observação',
  });
export type RecordMeasurementInput = z.infer<typeof recordMeasurementSchema>;

/** Strings acrescentadas à mão quando a venda não teve projeto técnico (sem dados elétricos para o esperado). */
export const addCommissioningStringsSchema = z.object({
  labels: z.array(z.string().trim().min(1).max(80)).min(1).max(60),
});
export type AddCommissioningStringsInput = z.infer<typeof addCommissioningStringsSchema>;

export const decideCommissioningSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || !!v.note, {
    path: ['note'],
    message: 'Informe o motivo da reprovação',
  });
export type DecideCommissioningInput = z.infer<typeof decideCommissioningSchema>;

export const ACCEPTANCE_CHANNELS = ['FIELD', 'OFFICE', 'PORTAL'] as const;
export type AcceptanceChannel = (typeof ACCEPTANCE_CHANNELS)[number];

export const registerAcceptanceSchema = z.object({
  acceptedByName: z.string().trim().min(2).max(120),
  channel: z.enum(['FIELD', 'OFFICE']),
  note: z.string().trim().max(500).optional(),
  /** Ordem de serviço cuja assinatura de campo comprova o aceite. */
  workOrderId: z.uuid().optional(),
});
export type RegisterAcceptanceInput = z.infer<typeof registerAcceptanceSchema>;

// Reexporta as listas usadas pelas telas.
export {
  COMMISSIONING_EXPECTED,
  COMMISSIONING_LEVELS,
  COMMISSIONING_SCOPES,
  COMMISSIONING_TEST_KINDS,
};
