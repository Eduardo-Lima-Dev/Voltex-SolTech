import { z } from 'zod';
import { PrivacySubjectType } from '../enums/index.js';
import { RETENTION_FLOORS } from '../constants/retention.js';

/** Política de retenção da empresa (`tenant.settings.retention`). `null` = não eliminar sozinho. */
export const retentionPolicySchema = z.object({
  unconvertedLeadsMonths: z.number().int().min(1).max(240).nullable(),
  lostOpportunitiesMonths: z.number().int().min(1).max(240).nullable(),
  /** Fotos de campo (instalação e comissionamento); `null` = não eliminar sozinho. */
  fieldPhotosMonths: z.number().int().min(1).max(240).nullable(),
  /** Pontos de geolocalização do app de campo; `null` = não eliminar sozinho. */
  geolocationMonths: z.number().int().min(1).max(240).nullable(),
  signedContractsMonths: z
    .number()
    .int()
    .min(
      RETENTION_FLOORS.signedContractsMonths,
      `O mínimo é ${RETENTION_FLOORS.signedContractsMonths} meses (5 anos)`,
    )
    .max(240),
});
export type RetentionPolicyInput = z.infer<typeof retentionPolicySchema>;

/** Pedido de eliminação dos dados pessoais de uma pessoa (lead ou conta). */
export const createErasureSchema = z.object({
  subjectType: z.enum(PrivacySubjectType),
  subjectId: z.uuid(),
  /** Quem pediu e por quê (fica no registro). */
  reason: z.string().trim().min(5, 'Explique o pedido').max(300),
});
export type CreateErasureInput = z.infer<typeof createErasureSchema>;
