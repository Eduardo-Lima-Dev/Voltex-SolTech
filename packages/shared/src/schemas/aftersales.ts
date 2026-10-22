import { z } from 'zod';

/** Pós-venda e O&M (Fase 11E, ADR-0023). */

export const PLANT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PlantStatus = (typeof PLANT_STATUSES)[number];

export const ASSET_CATEGORIES = [
  'MODULE',
  'INVERTER',
  'BATTERY',
  'PROTECTION',
  'CABLE',
  'OTHER',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_STATUSES = ['ACTIVE', 'REPLACED', 'REMOVED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const WARRANTY_KINDS = ['PRODUCT', 'PERFORMANCE'] as const;
export type WarrantyKind = (typeof WARRANTY_KINDS)[number];

export const TICKET_TYPES = ['CORRECTIVE', 'PREVENTIVE', 'REQUEST', 'PERFORMANCE_ALERT'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_ORIGINS = ['USER', 'CUSTOMER', 'SYSTEM'] as const;
export type TicketOrigin = (typeof TICKET_ORIGINS)[number];

export const MAINTENANCE_KINDS = ['PREVENTIVE', 'CLEANING', 'INSPECTION'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const OM_CONTRACT_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELLED'] as const;
export type OmContractStatus = (typeof OM_CONTRACT_STATUSES)[number];

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

// ---- Planta e ativos ----

export const listPlantsQuerySchema = z.object({
  status: z.enum(PLANT_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListPlantsQuery = z.infer<typeof listPlantsQuerySchema>;

export const updatePlantSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(PLANT_STATUSES).optional(),
});
export type UpdatePlantInput = z.infer<typeof updatePlantSchema>;

const serialsSchema = z.array(z.string().trim().min(1).max(80)).max(1000);

export const createAssetSchema = z.object({
  category: z.enum(ASSET_CATEGORIES),
  manufacturer: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(160),
  quantity: z.number().int().min(1).max(100_000).default(1),
  serials: serialsSchema.default([]),
  equipmentId: z.uuid().nullable().optional(),
  installedAt: isoDate.optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateAssetInput = z.input<typeof createAssetSchema>;

export const updateAssetSchema = z.object({
  manufacturer: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  /** Troca a lista de números de série. */
  serials: serialsSchema.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  status: z.enum(['ACTIVE', 'REMOVED']).optional(),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const replaceAssetSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  manufacturer: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  serials: serialsSchema.default([]),
  equipmentId: z.uuid().nullable().optional(),
});
export type ReplaceAssetInput = z.input<typeof replaceAssetSchema>;

// ---- Garantias ----

export const createWarrantyTermSchema = z
  .object({
    manufacturer: z.string().trim().min(1).max(120),
    category: z.enum(ASSET_CATEGORIES),
    productYears: z.number().positive().max(50).optional(),
    performanceYears: z.number().positive().max(50).optional(),
    /** Desempenho garantido ao fim do prazo, em % da potência original. */
    performanceEndPct: z.number().positive().max(100).optional(),
    conditions: z.string().trim().max(1000).optional(),
    /** Documento do termo (PDF do fabricante) já enviado pela tela de documentos. */
    documentId: z.uuid().optional(),
    /** De onde vem o prazo (documento, página, link). Obrigatória: termo sem fonte não vale. */
    source: z.string().trim().min(3).max(300),
    reviewedBy: z.string().trim().min(2).max(160).optional(),
    validFrom: isoDate.optional(),
  })
  .refine((v) => v.productYears !== undefined || v.performanceYears !== undefined, {
    path: ['productYears'],
    message: 'Informe o prazo do produto e/ou o de desempenho',
  })
  .refine((v) => v.performanceEndPct === undefined || v.performanceYears !== undefined, {
    path: ['performanceEndPct'],
    message: 'O desempenho final só vale com o prazo de desempenho',
  });
export type CreateWarrantyTermInput = z.infer<typeof createWarrantyTermSchema>;

export const createManualWarrantySchema = z
  .object({
    kind: z.enum(WARRANTY_KINDS),
    startsOn: isoDate,
    endsOn: isoDate,
    performanceEndPct: z.number().positive().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endsOn > v.startsOn, {
    path: ['endsOn'],
    message: 'O fim deve ser depois do início',
  });
export type CreateManualWarrantyInput = z.infer<typeof createManualWarrantySchema>;

export const listWarrantiesQuerySchema = z.object({
  /** Só as que vencem nos próximos N dias (e ainda não venceram). */
  expiringInDays: z.coerce.number().int().min(1).max(3650).optional(),
  status: z.enum(['ACTIVE', 'EXPIRED']).optional(),
  plantId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListWarrantiesQuery = z.infer<typeof listWarrantiesQuerySchema>;

// ---- Chamados ----

export const createTicketSchema = z.object({
  plantId: z.uuid(),
  type: z.enum(TICKET_TYPES).default('CORRECTIVE'),
  priority: z.enum(TICKET_PRIORITIES).default('NORMAL'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  assetId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const updateTicketSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assigneeId: z.uuid().nullable().optional(),
  assetId: z.uuid().nullable().optional(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const changeTicketStatusSchema = z
  .object({
    status: z.enum(TICKET_STATUSES),
    resolution: z.string().trim().min(3).max(2000).optional(),
  })
  .refine((v) => v.status !== 'RESOLVED' || !!v.resolution, {
    path: ['resolution'],
    message: 'Descreva como o chamado foi resolvido',
  });
export type ChangeTicketStatusInput = z.infer<typeof changeTicketStatusSchema>;

export const addTicketCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  /** Comentário interno não aparece para o cliente. */
  internal: z.boolean().default(true),
});
export type AddTicketCommentInput = z.input<typeof addTicketCommentSchema>;

export const listTicketsQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  /** Atalho: só os em aberto (abertos, em andamento, aguardando o cliente). */
  open: z.enum(['true', 'false']).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  plantId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

export const createTicketWorkOrderSchema = z.object({
  crewId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  scheduledStart: isoDateTime.nullable().optional(),
  scheduledEnd: isoDateTime.nullable().optional(),
});
export type CreateTicketWorkOrderInput = z.infer<typeof createTicketWorkOrderSchema>;

// ---- Manutenção e contratos ----

export const createMaintenancePlanSchema = z.object({
  plantId: z.uuid(),
  title: z.string().trim().min(3).max(160),
  kind: z.enum(MAINTENANCE_KINDS).default('PREVENTIVE'),
  /** Periodicidade em meses: definida pela empresa. */
  everyMonths: z.number().int().min(1).max(240),
  firstDueOn: isoDate,
  notes: z.string().trim().max(1000).optional(),
});
export type CreateMaintenancePlanInput = z.input<typeof createMaintenancePlanSchema>;

export const updateMaintenancePlanSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  everyMonths: z.number().int().min(1).max(240).optional(),
  nextDueAt: isoDate.optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateMaintenancePlanInput = z.infer<typeof updateMaintenancePlanSchema>;

export const createOmContractSchema = z
  .object({
    plantId: z.uuid(),
    title: z.string().trim().min(3).max(160),
    startsOn: isoDate,
    endsOn: isoDate,
    /** Valor mensal equivalente, em centavos (informado à mão). */
    monthlyCents: z.number().int().min(0).max(1_000_000_000),
    billing: z.string().trim().max(160).optional(),
    autoRenew: z.boolean().default(false),
    notes: z.string().trim().max(1000).optional(),
    documentId: z.uuid().optional(),
  })
  .refine((v) => v.endsOn > v.startsOn, {
    path: ['endsOn'],
    message: 'O fim deve ser depois do início',
  });
export type CreateOmContractInput = z.input<typeof createOmContractSchema>;

export const updateOmContractSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  endsOn: isoDate.optional(),
  monthlyCents: z.number().int().min(0).max(1_000_000_000).optional(),
  billing: z.string().trim().max(160).nullable().optional(),
  autoRenew: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(OM_CONTRACT_STATUSES).optional(),
});
export type UpdateOmContractInput = z.infer<typeof updateOmContractSchema>;

// ---- Configurações da empresa (prazos e gatilhos: nada é presumido) ----

/** Cada campo é opcional; `null` limpa. Sem valor, o recurso correspondente fica desligado. */
export const operationsSettingsSchema = z.object({
  /** Avisar garantias que vencem em até N dias. */
  warrantyAlertDays: z.number().int().min(1).max(3650).nullable().optional(),
  /** Avisar contratos de O&M que terminam em até N dias. */
  renewalNoticeDays: z.number().int().min(1).max(3650).nullable().optional(),
  /** Abrir o chamado de manutenção preventiva N dias antes do vencimento (0 = no dia). */
  maintenanceLeadDays: z.number().int().min(0).max(365).nullable().optional(),
  /** Prazo de atendimento por prioridade, em horas (prioridade sem prazo fica sem SLA). */
  slaHours: z
    .object({
      LOW: z.number().positive().max(10_000).nullable().optional(),
      NORMAL: z.number().positive().max(10_000).nullable().optional(),
      HIGH: z.number().positive().max(10_000).nullable().optional(),
      URGENT: z.number().positive().max(10_000).nullable().optional(),
    })
    .optional(),
  /** Gatilho de expansão: consumo médio da rede (kWh/mês) acima deste valor nas últimas faturas validadas. */
  upsellGridKwh: z.number().positive().max(1_000_000).nullable().optional(),
  /** Quantas faturas validadas (as mais recentes) entram na média do gatilho de expansão. */
  upsellMinBills: z.number().int().min(1).max(12).nullable().optional(),
});
export type OperationsSettingsInput = z.infer<typeof operationsSettingsSchema>;
