import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/index.js';

export const idSchema = z.string().min(1);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), meta: paginationMetaSchema });

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Dinheiro sempre em centavos (inteiro). */
export const centsSchema = z.number().int();

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9()\-\s]{8,20}$/, 'Telefone inválido');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'));
