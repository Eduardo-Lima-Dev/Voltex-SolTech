import { z } from 'zod';

export const DocuSealCredentialSchema = z.object({
  instanceUrl: z.string().url(),
  apiToken: z.string(),
});
export type DocuSealCredential = z.infer<typeof DocuSealCredentialSchema>;

export const DocuSealSignatureRequestSchema = z.object({
  contractId: z.string().uuid(),
  signerEmail: z.string().email(),
  signerName: z.string(),
  documentUrl: z.string().url(),
  templateId: z.string().optional(),
});
export type DocuSealSignatureRequest = z.infer<typeof DocuSealSignatureRequestSchema>;

export const DocuSealSignatureWebhookSchema = z.object({
  event: z.enum(['submission.signed', 'submission.declined']),
  submissionId: z.string(),
  contractId: z.string(),
  status: z.enum(['completed', 'declined']),
  signedDocumentUrl: z.string().url().optional(),
  auditLog: z.record(z.unknown()).optional(),
});
export type DocuSealSignatureWebhook = z.infer<typeof DocuSealSignatureWebhookSchema>;
