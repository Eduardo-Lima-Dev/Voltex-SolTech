import { z } from 'zod';
import {
  AccountType,
  CustomerGroup,
  CustomerSegment,
  LeadSource,
  LeadStatus,
  OpportunityStage,
  OpportunityStatus,
  PhaseSystem,
  ProjectType,
  RoofType,
  ShadingLevel,
  TaskStatus,
} from '../enums/index.js';
import { emailSchema, isoDateTimeSchema, paginationQuerySchema, phoneSchema } from './common.js';

const nameSchema = z.string().trim().min(2).max(160);
const stateSchema = z.string().trim().length(2).toUpperCase();
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const utmSchema = z.object({
  source: z.string().optional(),
  medium: z.string().optional(),
  campaign: z.string().optional(),
  term: z.string().optional(),
  content: z.string().optional(),
});
export type Utm = z.infer<typeof utmSchema>;

// ---------------------------------------------------------------------------------------------------------
// Leads (RF-CRM-001..005)
// ---------------------------------------------------------------------------------------------------------

export const createLeadSchema = z.object({
  name: nameSchema,
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  document: z.string().trim().optional(),
  source: z.enum(LeadSource).default(LeadSource.MANUAL),
  segment: z.enum(CustomerSegment).optional(),
  preliminaryGroup: z.enum(CustomerGroup).optional(),
  city: z.string().trim().optional(),
  state: stateSchema.optional(),
  notes: z.string().max(2000).optional(),
  utm: utmSchema.optional(),
  ownerId: z.uuid().optional(),
});
export type CreateLeadInput = z.input<typeof createLeadSchema>;
export type CreateLeadData = z.output<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema
  .omit({ source: true })
  .partial()
  .extend({
    status: z.enum(LeadStatus).optional(),
    /** Obrigatório ao desqualificar. */
    disqualifiedReason: z.string().trim().min(3).max(300).optional(),
  })
  .refine((v) => v.status !== LeadStatus.DISQUALIFIED || !!v.disqualifiedReason, {
    path: ['disqualifiedReason'],
    message: 'Informe o motivo da desqualificação',
  })
  .refine((v) => v.status !== LeadStatus.CONVERTED, {
    path: ['status'],
    message: 'Use a conversão do lead para criar conta e oportunidade',
  });
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;

export const listLeadsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  status: z.enum(LeadStatus).optional(),
  source: z.enum(LeadSource).optional(),
  segment: z.enum(CustomerSegment).optional(),
  ownerId: z.uuid().optional(),
  /** `true`: só leads com o primeiro contato atrasado (SLA estourado). */
  slaBreached: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListLeadsQuery = z.output<typeof listLeadsQuerySchema>;

export const MAX_LEAD_IMPORT_ROWS = 500;
export const importLeadsSchema = z.object({
  rows: z.array(createLeadSchema).min(1).max(MAX_LEAD_IMPORT_ROWS),
});
export type ImportLeadsInput = z.input<typeof importLeadsSchema>;

export interface ImportLeadsResult {
  created: number;
  duplicates: number;
  /** Linhas ignoradas por duplicidade: posição (a partir de 1) e com quem coincidiram. */
  duplicateRows: { row: number; name: string; matchedLeadId: string; matchedBy: string[] }[];
}

/** Captação pública (formulário/landing): exige contato e o consentimento do titular (LGPD). */
export const publicLeadSchema = z
  .object({
    name: nameSchema,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    segment: z.enum(CustomerSegment).optional(),
    city: z.string().trim().max(120).optional(),
    state: stateSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
    utm: utmSchema.optional(),
    consent: z.literal(true, { error: 'É necessário aceitar o contato' }),
    /** Isca para robôs: campo escondido que pessoas não preenchem. */
    website: z.string().max(0).optional(),
  })
  .refine((v) => !!v.email || !!v.phone, {
    path: ['phone'],
    message: 'Informe telefone ou e-mail',
  });
export type PublicLeadInput = z.input<typeof publicLeadSchema>;

export const convertLeadSchema = z.object({
  accountType: z.enum(AccountType).default(AccountType.PERSON),
  createOpportunity: z.boolean().default(true),
  projectType: z.enum(ProjectType).default(ProjectType.ON_GRID),
  opportunityTitle: z.string().trim().min(2).max(160).optional(),
});
export type ConvertLeadInput = z.input<typeof convertLeadSchema>;

// ---------------------------------------------------------------------------------------------------------
// Contas, contatos, imóveis e unidades consumidoras (RF-CRM-010..012, RF-CRM-078)
// ---------------------------------------------------------------------------------------------------------

export const createAccountSchema = z.object({
  type: z.enum(AccountType).default(AccountType.PERSON),
  name: nameSchema,
  document: z.string().trim().optional(),
  segment: z.enum(CustomerSegment).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateAccountInput = z.input<typeof createAccountSchema>;
export const updateAccountSchema = createAccountSchema.partial();
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

export const listAccountsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
});
export type ListAccountsQuery = z.output<typeof listAccountsQuerySchema>;

export const createContactSchema = z.object({
  name: nameSchema,
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  roleTitle: optionalText(80),
  isPrimary: z.boolean().default(false),
});
export type CreateContactInput = z.input<typeof createContactSchema>;
export const updateContactSchema = createContactSchema.partial();
export type UpdateContactInput = z.input<typeof updateContactSchema>;

/**
 * Intake técnico do local (EnergIF EF-M02, M03, M05, R05, R09): o mínimo que a triagem precisa saber antes de
 * dimensionar. Tudo é opcional; o Project Guard avisa o que falta.
 */
export const siteIntakeSchema = z.object({
  roofType: z.enum(RoofType).optional(),
  /** Azimute da face do telhado (0° = Norte, 90° = Leste, 180° = Sul, 270° = Oeste). */
  roofAzimuthDegrees: z.number().min(0).lt(360).optional(),
  tiltDegrees: z.number().min(0).max(90).optional(),
  shading: z.enum(ShadingLevel).optional(),
  availableAreaM2: z.number().positive().optional(),
  /** Disjuntor geral do padrão de entrada (A). */
  entryBreakerAmps: z.number().positive().optional(),
  groundingAdequate: z.boolean().optional(),
  technicalVisitRequired: z.boolean().optional(),
  technicalVisitDone: z.boolean().optional(),
  notes: optionalText(1000),
});
export type SiteIntake = z.infer<typeof siteIntakeSchema>;

export const createSiteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  street: optionalText(160),
  number: optionalText(20),
  district: optionalText(80),
  city: z.string().trim().min(2).max(120),
  state: stateSchema,
  zip: optionalText(12),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  intake: siteIntakeSchema.default({}),
});
export type CreateSiteInput = z.input<typeof createSiteSchema>;
export const updateSiteSchema = createSiteSchema.partial();
export type UpdateSiteInput = z.input<typeof updateSiteSchema>;

export const createConsumerUnitSchema = z.object({
  siteId: z.uuid().optional(),
  /** Número da UC na fatura. */
  number: z.string().trim().min(3).max(40),
  distributorId: z.uuid().optional(),
  customerGroup: z.enum(CustomerGroup).default(CustomerGroup.B),
  phaseSystem: z.enum(PhaseSystem).optional(),
  /** Classe de consumo como aparece na fatura (ex.: "Residencial"). */
  consumerClass: optionalText(60),
});
export type CreateConsumerUnitInput = z.input<typeof createConsumerUnitSchema>;
export const updateConsumerUnitSchema = createConsumerUnitSchema.partial();
export type UpdateConsumerUnitInput = z.input<typeof updateConsumerUnitSchema>;

// ---------------------------------------------------------------------------------------------------------
// Pipeline e oportunidades (RF-CRM-020..025)
// ---------------------------------------------------------------------------------------------------------

export const updatePipelineStageSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  order: z.number().int().min(1).max(99).optional(),
});
export type UpdatePipelineStageInput = z.input<typeof updatePipelineStageSchema>;

export const createOpportunitySchema = z.object({
  accountId: z.uuid(),
  siteId: z.uuid().optional(),
  consumerUnitId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  projectType: z.enum(ProjectType).default(ProjectType.ON_GRID),
  title: z.string().trim().min(2).max(160).optional(),
  ownerId: z.uuid().optional(),
  expectedCloseDate: isoDateTimeSchema.optional(),
});
export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;
export type CreateOpportunityData = z.output<typeof createOpportunitySchema>;

export const updateOpportunitySchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  siteId: z.uuid().nullable().optional(),
  consumerUnitId: z.uuid().nullable().optional(),
  ownerId: z.uuid().optional(),
  projectType: z.enum(ProjectType).optional(),
  expectedCloseDate: isoDateTimeSchema.nullable().optional(),
});
export type UpdateOpportunityInput = z.input<typeof updateOpportunitySchema>;

export const changeStageSchema = z
  .object({
    stage: z.enum(OpportunityStage),
    lostReason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((v) => v.stage !== OpportunityStage.LOST || !!v.lostReason, {
    path: ['lostReason'],
    message: 'O motivo da perda é obrigatório',
  });
export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const listOpportunitiesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  stage: z.enum(OpportunityStage).optional(),
  status: z.enum(OpportunityStatus).optional(),
  ownerId: z.uuid().optional(),
  /** `true`: só oportunidades abertas sem tarefa em aberto (RF-CRM-026). */
  withoutNextTask: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListOpportunitiesQuery = z.output<typeof listOpportunitiesQuerySchema>;

export const createNoteSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

// ---------------------------------------------------------------------------------------------------------
// Tarefas (RF-CRM-026)
// ---------------------------------------------------------------------------------------------------------

export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: optionalText(1000),
  dueAt: isoDateTimeSchema,
  assigneeId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  accountId: z.uuid().optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: optionalText(1000),
  dueAt: isoDateTimeSchema.optional(),
  assigneeId: z.uuid().optional(),
  status: z.enum(TaskStatus).optional(),
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TaskStatus).optional(),
  assigneeId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListTasksQuery = z.output<typeof listTasksQuerySchema>;

// ---------------------------------------------------------------------------------------------------------
// Fatura de energia (RF-CRM-030..033)
// ---------------------------------------------------------------------------------------------------------

export const billMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use AAAA-MM');

export const consumptionPointSchema = z.object({
  month: billMonthSchema,
  kwh: z.number().min(0).max(1_000_000),
});
export type ConsumptionPoint = z.infer<typeof consumptionPointSchema>;

/** Campos que a leitura da fatura tenta preencher e que a pessoa revisa. */
export const ENERGY_BILL_FIELDS = [
  'distributorName',
  'ucNumber',
  'customerName',
  'referenceMonth',
  'consumptionHistory',
  'tariffCentsPerKwh',
  'totalAmountCents',
  'dueDate',
  'customerGroup',
  'phaseSystem',
] as const;
export type EnergyBillField = (typeof ENERGY_BILL_FIELDS)[number];

export const energyBillFieldsSchema = z.object({
  distributorName: optionalText(120),
  ucNumber: optionalText(40),
  customerName: optionalText(160),
  referenceMonth: billMonthSchema.optional(),
  consumptionHistory: z.array(consumptionPointSchema).max(24).optional(),
  /** Tarifa praticada na fatura, em centavos por kWh (com impostos, como o cliente paga). */
  tariffCentsPerKwh: z.number().positive().optional(),
  totalAmountCents: z.number().int().min(0).optional(),
  dueDate: z.iso.date().optional(),
  customerGroup: z.enum(CustomerGroup).optional(),
  phaseSystem: z.enum(PhaseSystem).optional(),
});
export type EnergyBillFields = z.infer<typeof energyBillFieldsSchema>;

/** O que o cálculo precisa: histórico de consumo e a UC. */
export const validateEnergyBillSchema = z.object({
  fields: energyBillFieldsSchema
    .extend({
      consumptionHistory: z
        .array(consumptionPointSchema)
        .min(1, 'Informe o consumo de pelo menos um mês')
        .max(24),
    })
    .refine((v) => !!v.ucNumber, { path: ['ucNumber'], message: 'Informe o número da UC' }),
  note: optionalText(500),
});
export type ValidateEnergyBillInput = z.input<typeof validateEnergyBillSchema>;

export const rejectEnergyBillSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type RejectEnergyBillInput = z.infer<typeof rejectEnergyBillSchema>;

export const listEnergyBillsQuerySchema = z.object({
  opportunityId: z.uuid().optional(),
  consumerUnitId: z.uuid().optional(),
});
