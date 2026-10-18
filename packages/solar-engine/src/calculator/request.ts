import { z } from 'zod';
import { calculationReferencesSchema } from '@voltex/shared';
import { quickCalculationInputSchema } from './types.js';

/** Corpo de `POST /calculations/quick`. O servidor recalcula com as regras do tenant (os `thresholds` enviados são ignorados). */
export const createCalculationSchema = z.object({
  title: z.string().trim().max(160).optional(),
  customerName: z.string().trim().max(160).optional(),
  /** Local e tarifa escolhidos no catálogo; o servidor registra o que foi usado e se o usuário alterou os valores. */
  references: calculationReferencesSchema.optional(),
  input: quickCalculationInputSchema,
});
export type CreateCalculationInput = z.input<typeof createCalculationSchema>;

export const createSnapshotSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;
