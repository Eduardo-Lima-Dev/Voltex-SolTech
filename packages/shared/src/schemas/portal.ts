import { z } from 'zod';

/** Portal do cliente por link mágico (11H, ADR-0027). */

/** Link mágico: vale 30 minutos e só pode ser usado uma vez. A sessão dura 12 horas. */
export const PORTAL_LINK_TTL_MINUTES = 30;
export const PORTAL_SESSION_TTL_HOURS = 12;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(200));

export const requestPortalLinkSchema = z.object({ email: emailSchema });
export type RequestPortalLinkInput = z.infer<typeof requestPortalLinkSchema>;

export const exchangePortalTokenSchema = z.object({ token: z.string().trim().min(20).max(200) });
export type ExchangePortalTokenInput = z.infer<typeof exchangePortalTokenSchema>;

export const createPortalAccessSchema = z.object({
  accountId: z.uuid(),
  email: emailSchema,
});
export type CreatePortalAccessInput = z.infer<typeof createPortalAccessSchema>;

export const createPortalTicketSchema = z.object({
  plantId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
});
export type CreatePortalTicketInput = z.infer<typeof createPortalTicketSchema>;

export const addPortalTicketCommentSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export type AddPortalTicketCommentInput = z.infer<typeof addPortalTicketCommentSchema>;

export const portalAcceptanceSchema = z.object({
  acceptedByName: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
});
export type PortalAcceptanceInput = z.infer<typeof portalAcceptanceSchema>;

export const portalUploadNoteSchema = z.object({ note: z.string().trim().max(300).optional() });
export type PortalUploadNoteInput = z.infer<typeof portalUploadNoteSchema>;

export const reviewPortalUploadSchema = z.object({
  accept: z.boolean(),
  note: z.string().trim().max(300).optional(),
});
export type ReviewPortalUploadInput = z.infer<typeof reviewPortalUploadSchema>;
