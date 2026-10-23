import { z } from 'zod';

export const MfaSetupResponseSchema = z.object({
  qrCode: z.string(),
  secret: z.string(),
  backupCodes: z.array(z.string()),
});
export type MfaSetupResponse = z.infer<typeof MfaSetupResponseSchema>;

export const MfaVerifyRequestSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
});
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const MfaStatusSchema = z.object({
  enabled: z.boolean(),
  backupCodesCount: z.number(),
});
export type MfaStatus = z.infer<typeof MfaStatusSchema>;

export const MfaLoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  mfaCode: z.string().length(6).regex(/^\d+$/).optional(),
});
export type MfaLogin = z.infer<typeof MfaLoginSchema>;
