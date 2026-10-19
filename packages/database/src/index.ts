export { PrismaClient, Prisma } from './generated/client';
export * from './generated/enums';
/** Tipos das linhas de cada modelo (ex.: `Lead`, `Opportunity`). */
export type {
  CalculationSession,
  QuickCalculationSnapshot,
  Distributor,
  Tariff,
  SolarResource,
  Lead,
  Account,
  Contact,
  Site,
  ConsumerUnit,
  PipelineStage,
  Opportunity,
  TimelineEvent,
  Task,
  EnergyBill,
  EnergyBillSnapshot,
  EngineeringRequest,
  Tenant,
  Branch,
  Team,
  User,
  RefreshToken,
  AuditLog,
  OutboxEvent,
  Invitation,
  Document,
  RuleSet,
} from './generated/client';
export type * from './generated/models';
export { createPrismaClient, type CreatePrismaClientOptions } from './client';
export { TENANT_SCOPED_MODELS, isTenantScopedModel, type TenantScopedModel } from './tenant-scope';
