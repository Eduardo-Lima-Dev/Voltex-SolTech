import { z } from 'zod';
import { Role } from '../enums/index.js';

/** Autenticação em dois fatores por aplicativo (TOTP), RNF-SEG-011. */

export const MFA_CHALLENGE_TTL_SECONDS = 300;

const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Informe os 6 dígitos do aplicativo');
/** TOTP (6 dígitos) ou código de recuperação (`XXXXX-XXXXX`). */
const totpOrRecovery = z.string().trim().min(6).max(20);

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(20).max(2000),
  code: totpOrRecovery,
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaLoginSetupSchema = z.object({ mfaToken: z.string().min(20).max(2000) });
export type MfaLoginSetupInput = z.infer<typeof mfaLoginSetupSchema>;

export const mfaLoginConfirmSchema = z.object({
  mfaToken: z.string().min(20).max(2000),
  code: totpCode,
});
export type MfaLoginConfirmInput = z.infer<typeof mfaLoginConfirmSchema>;

export const mfaConfirmSchema = z.object({ code: totpCode });
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(200),
  code: totpOrRecovery,
});
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

/** Política da empresa: quem precisa usar o segundo fator. `roles` vazio com `required` = todos os perfis. */
export const mfaPolicySchema = z.object({
  required: z.boolean(),
  roles: z.array(z.enum(Role)).max(20).default([]),
});
export type MfaPolicyInput = z.input<typeof mfaPolicySchema>;
export type MfaPolicy = z.output<typeof mfaPolicySchema>;

export interface MfaChallengeDto {
  status: 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';
  /** Vale 5 minutos e só serve para as rotas do segundo fator. */
  mfaToken: string;
  expiresIn: number;
}

export interface MfaSetupDto {
  /** Para digitar no aplicativo quando não dá para ler o QR. */
  secret: string;
  otpauthUri: string;
}

export interface MfaStatusDto {
  enabled: boolean;
  /** A empresa exige o segundo fator para o perfil deste usuário. */
  required: boolean;
  recoveryCodesLeft: number;
}

export interface MfaRecoveryDto {
  /** Mostrados uma única vez. Cada código vale uma vez. */
  recoveryCodes: string[];
}
