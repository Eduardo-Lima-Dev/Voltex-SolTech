import { z } from 'zod';
import { Role } from '../enums/index.js';
import { emailSchema, paginationQuerySchema } from './common.js';

const nameSchema = z.string().trim().min(2).max(120);

// ---- Tenant, filiais e times ----
export const updateTenantSchema = z
  .object({
    name: nameSchema,
    document: z.string().trim().max(32).nullable(),
    settings: z.record(z.string(), z.unknown()),
  })
  .partial();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const createBranchSchema = z.object({
  name: nameSchema,
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().length(2).toUpperCase().optional(),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export const updateBranchSchema = createBranchSchema.partial();
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const createTeamSchema = z.object({
  name: nameSchema,
  branchId: z.uuid().optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export const updateTeamSchema = createTeamSchema.partial();
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

// ---- Usuários e convites ----
export const updateUserSchema = z
  .object({
    name: nameSchema,
    role: z.enum(Role),
    isActive: z.boolean(),
    branchId: z.uuid().nullable(),
    teamId: z.uuid().nullable(),
  })
  .partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(Role),
  branchId: z.uuid().optional(),
  teamId: z.uuid().optional(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20),
  name: nameSchema,
  password: z
    .string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres')
    .max(128)
    .regex(/[a-zA-Z]/, 'A senha deve conter letras')
    .regex(/[0-9]/, 'A senha deve conter números'),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  role: z.enum(Role).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// ---- Documentos ----
export const uploadDocumentSchema = z.object({
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  /** Envia uma nova versão de um documento existente. */
  replacesDocumentId: z.uuid().optional(),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().trim().optional(),
  entityId: z.string().trim().optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

// ---- Auditoria ----
/** Data/hora ISO 8601 (ou só a data) recebida como string e convertida em `Date`. Representável no OpenAPI. */
const isoDateTimeSchema = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((value) => new Date(value));

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  entity: z.string().trim().optional(),
  entityId: z.string().trim().optional(),
  actorId: z.uuid().optional(),
  action: z.string().trim().optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
