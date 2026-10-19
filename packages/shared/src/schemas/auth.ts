import { z } from 'zod';
import { Role } from '../enums/index.js';
import { emailSchema } from './common.js';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const currentUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(Role),
  tenantId: z.string(),
  tenantName: z.string(),
  permissions: z.array(z.string()),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  role: z.enum(Role),
  branchId: z.string().optional(),
  teamId: z.string().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
