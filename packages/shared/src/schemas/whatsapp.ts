import { z } from 'zod';

export const WhatsAppMessageSchema = z.object({
  phoneE164: z.string().regex(/^\+\d{1,3}\d{4,14}$/),
  message: z.string().max(1024),
  entityType: z.enum(['proposal', 'portal', 'schedule', 'receivable']),
  entityId: z.string().uuid(),
});
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;

export const WhatsAppLinkSchema = z.object({
  phoneE164: z.string().regex(/^\+\d{1,3}\d{4,14}$/),
  message: z.string(),
  previewUrl: z.string(),
});
export type WhatsAppLink = z.infer<typeof WhatsAppLinkSchema>;

export const CommunicationLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  channel: z.enum(['EMAIL', 'WHATSAPP_LINK', 'COPY_LINK']),
  recipient: z.string(),
  templateKey: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  sentBy: z.string().uuid(),
  sentAt: z.coerce.date(),
  openedAt: z.coerce.date().optional(),
  clickedAt: z.coerce.date().optional(),
});
export type CommunicationLog = z.infer<typeof CommunicationLogSchema>;
