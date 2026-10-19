import { z } from 'zod';
import { quoteCostsBase, quoteCostsSchema, quoteItemSchema } from './margin.js';

/** Corpo de `POST /opportunities/:id/quotes` e `PATCH /quotes/:id`. O servidor recalcula a margem. */
export const saveQuoteSchema = z.object({
  title: z.string().trim().max(120).optional(),
  /** Cálculo que dimensiona este cenário (opcional; a proposta mostra os números dele). */
  calculationSessionId: z.uuid().optional(),
  items: z.array(quoteItemSchema).min(1, 'Informe ao menos um item da lista de materiais').max(100),
  costs: quoteCostsSchema.default(() => quoteCostsSchema.parse({})),
  /** Preço de venda em centavos. */
  priceCents: z.number().int().positive('Informe o preço de venda'),
});
export type SaveQuoteInput = z.input<typeof saveQuoteSchema>;
export type SaveQuoteData = z.output<typeof saveQuoteSchema>;

/** Atualização: parte dos mesmos campos, todos opcionais e sem reaplicar padrões. */
export const updateQuoteSchema = z.object({
  title: z.string().trim().max(120).optional(),
  calculationSessionId: z.uuid().nullable().optional(),
  items: z.array(quoteItemSchema).min(1).max(100).optional(),
  costs: quoteCostsBase.partial().optional(),
  priceCents: z.number().int().positive().optional(),
});
export type UpdateQuoteInput = z.input<typeof updateQuoteSchema>;
export type UpdateQuoteData = z.output<typeof updateQuoteSchema>;
