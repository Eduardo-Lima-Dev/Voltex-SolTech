export { PrismaClient, Prisma } from './generated/client';
export * from './generated/enums';
export type * from './generated/models';
export { createPrismaClient, type CreatePrismaClientOptions } from './client';
export { TENANT_SCOPED_MODELS, isTenantScopedModel, type TenantScopedModel } from './tenant-scope';
