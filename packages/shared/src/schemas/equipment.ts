import { z } from 'zod';
import { isoDateTimeSchema, paginationQuerySchema } from './common.js';

/**
 * Catálogo técnico por empresa (Fase 9C, ADR-0017). O desenho técnico (`spec`) é validado por tipo de
 * equipamento; a governança (rascunho → aprovado → aposentado) e a proveniência ficam no registro.
 */

export const EQUIPMENT_KINDS = [
  'MODULE',
  'INVERTER',
  'PROTECTION',
  'CABLE',
  'BATTERY',
  'CHARGE_CONTROLLER',
  'OFFGRID_INVERTER',
  'GENERATOR',
] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];
export const EQUIPMENT_STATUSES = ['DRAFT', 'APPROVED', 'RETIRED'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export const EQUIPMENT_ORIGINS = ['MANUAL', 'CSV', 'PAN', 'OND', 'DATASHEET_PDF', 'CEC'] as const;
export type EquipmentOrigin = (typeof EQUIPMENT_ORIGINS)[number];
export const INMETRO_STATUSES = [
  'NOT_VERIFIED',
  'VERIFIED',
  'NOT_FOUND',
  'NOT_APPLICABLE',
] as const;
export type InmetroStatus = (typeof INMETRO_STATUSES)[number];

const positive = z.number().positive();
const optionalPositive = positive.optional();

export const MODULE_TECHNOLOGIES = ['MONO_SI', 'POLY_SI', 'THIN_FILM', 'OTHER'] as const;

/** Módulo fotovoltaico. Coeficientes em %/°C (negativos para Voc, Vmpp e Pmax). */
export const moduleSpecSchema = z.object({
  technology: z.enum(MODULE_TECHNOLOGIES),
  pmaxWp: positive,
  vmppV: positive,
  imppA: positive,
  vocV: positive,
  iscA: positive,
  efficiencyPct: z.number().min(1).max(40).optional(),
  betaVocPctPerC: z.number().min(-2).max(2),
  alphaIscPctPerC: z.number().min(-2).max(2),
  gammaPmaxPctPerC: z.number().min(-2).max(2),
  betaVmppPctPerC: z.number().min(-2).max(2).optional(),
  noctC: z.number().min(20).max(80).optional(),
  maxSystemVoltageV: optionalPositive,
  maxSeriesFuseA: optionalPositive,
  cellsInSeries: z.number().int().positive().optional(),
  lengthMm: positive,
  widthMm: positive,
  thicknessMm: optionalPositive,
  weightKg: optionalPositive,
  bifacial: z.boolean().default(false),
  /** Garantia de potência: anos e % da potência nominal ao final. */
  powerWarrantyYears: z.number().int().positive().optional(),
  powerWarrantyEndPct: z.number().min(1).max(100).optional(),
  firstYearDegradationPct: z.number().min(0).max(10).optional(),
  annualDegradationPct: z.number().min(0).max(5).optional(),
});
export type ModuleSpec = z.output<typeof moduleSpecSchema>;

export const INVERTER_TOPOLOGIES = ['STRING', 'MICRO', 'HYBRID'] as const;

export const inverterSpecSchema = z.object({
  topology: z.enum(INVERTER_TOPOLOGIES),
  pAcNomW: positive,
  pAcMaxW: optionalPositive,
  pDcMaxW: optionalPositive,
  vDcMaxV: positive,
  vStartV: optionalPositive,
  mpptMinV: positive,
  mpptMaxV: positive,
  mpptCount: z.number().int().positive(),
  inputsPerMppt: z.number().int().positive().default(1),
  /** Corrente máxima de entrada e de curto-circuito admissível por MPPT. */
  iMaxPerMpptA: positive,
  iscMaxPerMpptA: optionalPositive,
  vAcV: positive,
  phases: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  iAcMaxA: optionalPositive,
  efficiencyMaxPct: z.number().min(50).max(100).optional(),
  efficiencyEuroPct: z.number().min(50).max(100).optional(),
  /** Aceita limitação de exportação (Grid Zero). */
  exportLimitation: z.boolean().default(false),
});
export type InverterSpec = z.output<typeof inverterSpecSchema>;

export const PROTECTION_KINDS = [
  'FUSE_DC',
  'DISCONNECTOR_DC',
  'SURGE_DC',
  'SURGE_AC',
  'BREAKER_AC',
  'RCD',
  'STRING_BOX',
] as const;

export const protectionSpecSchema = z.object({
  protectionKind: z.enum(PROTECTION_KINDS),
  ratedCurrentA: optionalPositive,
  ratedVoltageV: optionalPositive,
  poles: z.number().int().min(1).max(4).optional(),
  curve: z.string().trim().max(20).optional(),
  breakingCapacityKa: optionalPositive,
  /** Norma do produto (ex.: IEC 60947-3). */
  standard: z.string().trim().max(80).optional(),
  /** Sensibilidade (mA), no DR. */
  sensitivityMa: optionalPositive,
});
export type ProtectionSpec = z.output<typeof protectionSpecSchema>;

export const CABLE_KINDS = ['DC_SOLAR', 'AC'] as const;

export const cableSpecSchema = z.object({
  cableKind: z.enum(CABLE_KINDS),
  crossSectionMm2: positive,
  conductor: z.enum(['CU', 'AL']).default('CU'),
  insulation: z.string().trim().max(40).optional(),
  voltageRatingV: optionalPositive,
  maxConductorTempC: optionalPositive,
  standard: z.string().trim().max(80).optional(),
});
export type CableSpec = z.output<typeof cableSpecSchema>;

export const BATTERY_CHEMISTRIES = [
  'LEAD_FLOODED',
  'LEAD_AGM',
  'LEAD_GEL',
  'OPZS',
  'OPZV',
  'LFP',
  'NMC',
  'OTHER',
] as const;
export type BatteryChemistry = (typeof BATTERY_CHEMISTRIES)[number];

/** Bateria (Fase 10). Capacidade no regime informado (`capacityHours`, ex.: C20 = 20 h). */
export const batterySpecSchema = z.object({
  chemistry: z.enum(BATTERY_CHEMISTRIES),
  nominalVoltageV: positive,
  capacityAh: positive,
  capacityHours: z.number().positive().max(200).default(20),
  /** Profundidade de descarga máxima recomendada pelo fabricante. */
  maxDodPct: z.number().min(5).max(100),
  roundTripEfficiencyPct: z.number().min(40).max(100).optional(),
  /** Vida em ciclos na profundidade `cycleDodPct`. */
  cycleLife: z.number().int().positive().optional(),
  cycleDodPct: z.number().min(5).max(100).optional(),
  calendarLifeYears: optionalPositive,
  maxChargeCurrentA: optionalPositive,
  maxDischargeCurrentA: optionalPositive,
  /** Máximo de unidades em paralelo recomendado pelo fabricante. */
  maxParallel: z.number().int().positive().optional(),
  weightKg: optionalPositive,
  lengthMm: optionalPositive,
  widthMm: optionalPositive,
  heightMm: optionalPositive,
});
export type BatterySpec = z.output<typeof batterySpecSchema>;

export const CONTROLLER_TECHNOLOGIES = ['MPPT', 'PWM'] as const;

/** Controlador de carga. `batteryVoltageV` é a maior tensão nominal de banco aceita (12, 24, 48…). */
export const chargeControllerSpecSchema = z.object({
  technology: z.enum(CONTROLLER_TECHNOLOGIES),
  batteryVoltageV: positive,
  /** Aceita bancos de tensões nominais menores (12/24/48 automático). */
  autoVoltage: z.boolean().default(false),
  ratedChargeCurrentA: positive,
  /** Tensão máxima de circuito aberto do arranjo FV (Voc a frio). */
  pvVocMaxV: positive,
  mpptMinV: optionalPositive,
  mpptMaxV: optionalPositive,
  pvPowerMaxW: optionalPositive,
  pvIscMaxA: optionalPositive,
  efficiencyPct: z.number().min(50).max(100).optional(),
  tempCompensation: z.boolean().default(false),
});
export type ChargeControllerSpec = z.output<typeof chargeControllerSpecSchema>;

export const OFFGRID_INVERTER_TOPOLOGIES = ['OFFGRID', 'HYBRID'] as const;

/** Inversor autônomo ou híbrido (inversor/carregador, com entrada de rede e/ou gerador). */
export const offgridInverterSpecSchema = z.object({
  topology: z.enum(OFFGRID_INVERTER_TOPOLOGIES),
  batteryVoltageV: positive,
  pContinuousW: positive,
  pSurgeW: optionalPositive,
  surgeSeconds: optionalPositive,
  efficiencyPct: z.number().min(50).max(100).optional(),
  standbyW: optionalPositive,
  vAcV: positive,
  phases: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sineWave: z.boolean().default(true),
  /** Carregador de bateria a partir da rede/gerador. */
  chargerCurrentA: optionalPositive,
  gridInput: z.boolean().default(false),
  generatorInput: z.boolean().default(false),
  /** MPPT embutido. */
  mpptBuiltIn: z.boolean().default(false),
  mpptCount: z.number().int().positive().optional(),
  mpptMinV: optionalPositive,
  mpptMaxV: optionalPositive,
  pvVocMaxV: optionalPositive,
  pvPowerMaxW: optionalPositive,
  mpptCurrentA: optionalPositive,
});
export type OffgridInverterSpec = z.output<typeof offgridInverterSpecSchema>;

export const GENERATOR_FUELS = ['DIESEL', 'GASOLINE', 'GAS', 'ETHANOL'] as const;

export const generatorSpecSchema = z.object({
  fuel: z.enum(GENERATOR_FUELS),
  pContinuousW: positive,
  pStandbyW: optionalPositive,
  vAcV: positive,
  phases: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Consumo a 75% de carga. */
  fuelLitersPerHour: optionalPositive,
  minLoadPct: z.number().min(0).max(100).optional(),
  autoStart: z.boolean().default(false),
});
export type GeneratorSpec = z.output<typeof generatorSpecSchema>;

export const SPEC_SCHEMAS = {
  MODULE: moduleSpecSchema,
  INVERTER: inverterSpecSchema,
  PROTECTION: protectionSpecSchema,
  CABLE: cableSpecSchema,
  BATTERY: batterySpecSchema,
  CHARGE_CONTROLLER: chargeControllerSpecSchema,
  OFFGRID_INVERTER: offgridInverterSpecSchema,
  GENERATOR: generatorSpecSchema,
} as const;

export type EquipmentSpec =
  | ModuleSpec
  | InverterSpec
  | ProtectionSpec
  | CableSpec
  | BatterySpec
  | ChargeControllerSpec
  | OffgridInverterSpec
  | GeneratorSpec;

/** Confiança de cada campo lido de arquivo: o que foi lido direto, convertido ou presumido. */
export const FIELD_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type FieldConfidence = (typeof FIELD_CONFIDENCES)[number];
export const fieldConfidenceMapSchema = z.record(z.string(), z.enum(FIELD_CONFIDENCES));

const identity = {
  manufacturer: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(160),
};

const base = {
  ...identity,
  origin: z.enum(EQUIPMENT_ORIGINS).default('MANUAL'),
  fieldConfidence: fieldConfidenceMapSchema.default({}),
  referenceCostCents: z.number().int().min(0).optional(),
  externalRecordId: z.uuid().optional(),
  notes: z.string().trim().max(500).optional(),
};

export const createEquipmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MODULE'), ...base, spec: moduleSpecSchema }),
  z.object({ kind: z.literal('INVERTER'), ...base, spec: inverterSpecSchema }),
  z.object({ kind: z.literal('PROTECTION'), ...base, spec: protectionSpecSchema }),
  z.object({ kind: z.literal('CABLE'), ...base, spec: cableSpecSchema }),
  z.object({ kind: z.literal('BATTERY'), ...base, spec: batterySpecSchema }),
  z.object({ kind: z.literal('CHARGE_CONTROLLER'), ...base, spec: chargeControllerSpecSchema }),
  z.object({ kind: z.literal('OFFGRID_INVERTER'), ...base, spec: offgridInverterSpecSchema }),
  z.object({ kind: z.literal('GENERATOR'), ...base, spec: generatorSpecSchema }),
]);
export type CreateEquipmentInput = z.input<typeof createEquipmentSchema>;
export type CreateEquipmentData = z.output<typeof createEquipmentSchema>;

/** Edição de rascunho: o tipo não muda; o `spec` completo é revalidado pelo tipo do registro no servidor. */
export const updateEquipmentSchema = z.object({
  manufacturer: identity.manufacturer.optional(),
  model: identity.model.optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
  referenceCostCents: z.number().int().min(0).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;

export const listEquipmentQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(EQUIPMENT_KINDS).optional(),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  search: z.string().trim().optional(),
});
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema>;

export const inmetroCheckSchema = z.object({
  status: z.enum(INMETRO_STATUSES),
  registration: z.string().trim().max(60).optional(),
  /** Data da conferência na consulta oficial. Padrão: hoje. */
  checkedAt: isoDateTimeSchema.optional(),
});
export type InmetroCheckInput = z.input<typeof inmetroCheckSchema>;
export type InmetroCheckData = z.output<typeof inmetroCheckSchema>;

export const attachDatasheetSchema = z.object({ documentId: z.uuid() });

/** Importação em duas etapas: `preview` lê e valida (nada é gravado); `commit` grava rascunhos. */
export const IMPORT_FORMATS = ['csv', 'pan', 'ond', 'datasheet-pdf'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const importPreviewQuerySchema = z.object({
  format: z.enum(IMPORT_FORMATS),
  /** Obrigatório no CSV (cada modelo de planilha é de um tipo); nos demais formatos o tipo vem do arquivo. */
  kind: z.enum(EQUIPMENT_KINDS).optional(),
});
export type ImportPreviewQuery = z.infer<typeof importPreviewQuerySchema>;

export const importCommitSchema = z.object({
  items: z.array(createEquipmentSchema).min(1).max(500),
});
export type ImportCommitInput = z.input<typeof importCommitSchema>;

export const listReferencesQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(['MODULE', 'INVERTER']).optional(),
  search: z.string().trim().optional(),
});
export type ListReferencesQuery = z.infer<typeof listReferencesQuerySchema>;

export const priceImportQuerySchema = z.object({
  /** `true` só confere as linhas, sem gravar. */
  dryRun: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/** Fontes de catálogo na internet (listagens públicas de fichas técnicas). */
export const CATALOG_SITE_SOURCE_KEYS = ['techlux'] as const;

export const listSourceDocumentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  /** `Datasheet`, `Manual`... como o site rotula. */
  docType: z.string().trim().max(40).optional(),
  equipment: z.enum(['MODULE', 'INVERTER', 'OTHER']).optional(),
});
export type ListSourceDocumentsQuery = z.infer<typeof listSourceDocumentsQuerySchema>;

export const createCatalogSourceLinkSchema = z.object({
  /** Página com links de downloads ou o endereço direto de um arquivo (PDF, CSV, PAN, OND). */
  url: z.url().max(2000),
  label: z.string().trim().max(120).optional(),
});
export type CreateCatalogSourceLinkInput = z.input<typeof createCatalogSourceLinkSchema>;

export const catalogSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  kind: z.enum(EQUIPMENT_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(40).default(15),
});
export type CatalogSearchQuery = z.infer<typeof catalogSearchQuerySchema>;

export const listLinkDocumentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  equipment: z
    .enum([
      'MODULE',
      'INVERTER',
      'PROTECTION',
      'CABLE',
      'BATTERY',
      'CHARGE_CONTROLLER',
      'GENERATOR',
      'OTHER',
    ])
    .optional(),
  fileType: z.enum(['pdf', 'csv', 'pan', 'ond']).optional(),
});
export type ListLinkDocumentsQuery = z.infer<typeof listLinkDocumentsQuerySchema>;
