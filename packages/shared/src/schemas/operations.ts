import { z } from 'zod';
import type { InstallationStatus } from '../enums/index.js';

/** Operação (Fase 11B, ADR-0020): instalação, materiais, equipes e ordens de serviço. */

export const INSTALLATION_STATUSES = [
  'AWAITING_ENGINEERING',
  'AWAITING_MATERIAL',
  'MATERIAL_READY',
  'SCHEDULING',
  'CREW_ASSIGNED',
  'IN_PROGRESS',
  'FIELD_ISSUE',
  'INSTALLED',
  'COMMISSIONING',
  'CUSTOMER_ACCEPTANCE',
  'DONE',
  'CANCELLED',
] as const;
/** Conferido com o enum em tempo de compilação: as duas listas não podem divergir. */
const _statusesMatchEnum: readonly InstallationStatus[] = INSTALLATION_STATUSES;
void _statusesMatchEnum;

export const MATERIAL_ITEM_STATUSES = [
  'PENDING',
  'ORDERED',
  'RECEIVED',
  'SEPARATED',
  'CANCELLED',
] as const;
export type MaterialItemStatus = (typeof MATERIAL_ITEM_STATUSES)[number];

export const WORK_ORDER_TYPES = [
  'VISIT',
  'SURVEY',
  'INSTALLATION',
  'COMMISSIONING',
  'MAINTENANCE',
  'CLEANING',
] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export const WORK_ORDER_STATUSES = [
  'PENDING',
  'SCHEDULED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const FIELD_ISSUE_TYPES = [
  'MATERIAL',
  'ACCESS',
  'SAFETY',
  'TECHNICAL',
  'CUSTOMER',
  'OTHER',
] as const;
export type FieldIssueType = (typeof FIELD_ISSUE_TYPES)[number];

const isoDateTime = z.iso.datetime({ offset: true });

export const changeInstallationStatusSchema = z.object({
  status: z.enum(INSTALLATION_STATUSES),
  /** Obrigatório para voltar uma etapa ou cancelar. */
  reason: z.string().trim().min(3).max(500).optional(),
});
export type ChangeInstallationStatusInput = z.infer<typeof changeInstallationStatusSchema>;

export const updateInstallationSchema = z.object({
  responsibleId: z.uuid().nullable().optional(),
});
export type UpdateInstallationInput = z.infer<typeof updateInstallationSchema>;

export const listInstallationsQuerySchema = z.object({
  status: z.enum(INSTALLATION_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListInstallationsQuery = z.infer<typeof listInstallationsQuerySchema>;

export const createMaterialItemSchema = z.object({
  category: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(12),
  unitCostCents: z.number().int().min(0).nullable().optional(),
  equipmentId: z.uuid().nullable().optional(),
  note: z.string().trim().max(500).optional(),
});
export type CreateMaterialItemInput = z.infer<typeof createMaterialItemSchema>;

export const updateMaterialItemSchema = createMaterialItemSchema.partial();
export type UpdateMaterialItemInput = z.infer<typeof updateMaterialItemSchema>;

/** Registra o pedido de compra (só registro: o sistema não compra nada). */
export const orderMaterialItemSchema = z.object({
  supplier: z.string().trim().min(1).max(160),
  purchaseOrder: z.string().trim().max(60).optional(),
  /** Valor realmente pago no pedido, em centavos. */
  orderedCents: z.number().int().min(0).optional(),
  expectedAt: isoDateTime.optional(),
});
export type OrderMaterialItemInput = z.infer<typeof orderMaterialItemSchema>;

export const createCrewSchema = z.object({
  name: z.string().trim().min(2).max(80),
  memberIds: z.array(z.uuid()).max(30).default([]),
});
export type CreateCrewInput = z.infer<typeof createCrewSchema>;

export const updateCrewSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  active: z.boolean().optional(),
  memberIds: z.array(z.uuid()).max(30).optional(),
});
export type UpdateCrewInput = z.infer<typeof updateCrewSchema>;

export const createWorkOrderSchema = z.object({
  installationId: z.uuid().optional(),
  type: z.enum(WORK_ORDER_TYPES),
  title: z.string().trim().min(3).max(160),
  notes: z.string().trim().max(2000).optional(),
  crewId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  scheduledStart: isoDateTime.nullable().optional(),
  scheduledEnd: isoDateTime.nullable().optional(),
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

export const updateWorkOrderSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  crewId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  scheduledStart: isoDateTime.nullable().optional(),
  scheduledEnd: isoDateTime.nullable().optional(),
});
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;

export const cancelWorkOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type CancelWorkOrderInput = z.infer<typeof cancelWorkOrderSchema>;

export const completeWorkOrderSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderSchema>;

export const listWorkOrdersQuerySchema = z.object({
  installationId: z.uuid().optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  type: z.enum(WORK_ORDER_TYPES).optional(),
  crewId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListWorkOrdersQuery = z.infer<typeof listWorkOrdersQuerySchema>;

export const agendaQuerySchema = z.object({
  from: isoDateTime,
  to: isoDateTime,
  crewId: z.uuid().optional(),
});
export type AgendaQuery = z.infer<typeof agendaQuerySchema>;

export const createFieldIssueSchema = z.object({
  type: z.enum(FIELD_ISSUE_TYPES),
  description: z.string().trim().min(3).max(1000),
  /** Bloqueia a instalação até ser resolvida. */
  blocking: z.boolean().default(true),
  workOrderId: z.uuid().optional(),
});
export type CreateFieldIssueInput = z.infer<typeof createFieldIssueSchema>;

export const resolveFieldIssueSchema = z.object({
  resolution: z.string().trim().min(3).max(1000),
});
export type ResolveFieldIssueInput = z.infer<typeof resolveFieldIssueSchema>;
