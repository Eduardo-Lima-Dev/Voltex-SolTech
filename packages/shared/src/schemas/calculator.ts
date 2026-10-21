import { z } from 'zod';
import { CustomerGroup, PhaseSystem } from '../enums/index.js';
import { isoDateTimeSchema, paginationQuerySchema } from './common.js';

/**
 * Limites e parâmetros do Solar Calculator. São DADOS (Rules Engine), não constantes: cada valor tem origem
 * em `DEFAULT_CALCULATOR_RULE_SOURCES` e pode ser sobrescrito por uma versão ativa de regra do tenant.
 */
export const thresholdsSchema = z.object({
  performanceRatioMin: z.number().default(0.6),
  performanceRatioMax: z.number().default(0.9),
  hspMin: z.number().default(2),
  hspMax: z.number().default(8),
  /** Fração máxima de geração sobre o consumo antes de alertar sobredimensionamento. */
  maxGenerationToConsumptionRatio: z.number().default(1.3),
  /** PR usado quando nem o PR nem as perdas são informados. Hipótese de engenharia, sem fonte validada (EF-G01). */
  defaultPerformanceRatio: z.number().default(0.8),
  /** Faixa típica de HSP no Brasil (EnergIF EF-M01, p. 16): fora dela só avisa. */
  typicalHspMin: z.number().default(4),
  typicalHspMax: z.number().default(6.5),
  /** Inclinação mínima recomendada (EnergIF EF-M03, p. 18). */
  minRecommendedTiltDegrees: z.number().default(10),
  /** Desvio tolerado da orientação ideal antes de avisar. Hipótese do produto (o livro só diz "sempre que possível"). */
  orientationToleranceDegrees: z.number().default(45),
  /** Limites de classe da geração (EnergIF EF-M06, p. 67), em kW. A confirmar com a regulação vigente. */
  microgenerationMaxKw: z.number().default(75),
  minigenerationMaxKw: z.number().default(5000),
});
export type Thresholds = z.infer<typeof thresholdsSchema>;

// ---------------------------------------------------------------------------------------------------------
// Rules Engine (base): regras versionadas, com fonte, vigência e responsável pela revisão (RN-012)
// ---------------------------------------------------------------------------------------------------------

export const CALCULATOR_RULESET_KEY = 'calculator.rules';
export const RULESET_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type RuleSetStatus = (typeof RULESET_STATUSES)[number];

export const ruleSourceSchema = z.object({
  type: z.enum(['REGULATION', 'STANDARD', 'BOOK', 'INTERNAL_POLICY']),
  /** Ex.: "Lei 14.300/2022, art. 1º" ou "EnergIF 2023, p. 67 (EF-M06)". */
  reference: z.string().trim().min(2).max(300),
  url: z.url().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type RuleSource = z.infer<typeof ruleSourceSchema>;

/** Custo de disponibilidade por tipo de ligação (kWh/mês). Sem valor padrão: depende da regulação vigente. */
export const availabilityCostSchema = z
  .object({
    [PhaseSystem.SINGLE_PHASE]: z.number().min(0),
    [PhaseSystem.TWO_PHASE]: z.number().min(0),
    [PhaseSystem.THREE_PHASE]: z.number().min(0),
  })
  .partial();
export type AvailabilityCost = z.infer<typeof availabilityCostSchema>;

export const calculatorRulesDefinitionSchema = z.object({
  thresholds: thresholdsSchema.partial().default({}),
  availabilityCostKwh: availabilityCostSchema.default({}),
});
export type CalculatorRulesDefinition = z.input<typeof calculatorRulesDefinitionSchema>;

/** Valores que vêm do EnergIF e do produto, usados enquanto o tenant não ativa uma versão própria. */
export const DEFAULT_CALCULATOR_RULE_SOURCES: RuleSource[] = [
  {
    type: 'BOOK',
    reference: 'EnergIF 2023, p. 16 (EF-M01): faixa típica de HSP 4 a 6,5',
    notes: 'Alerta informativo; limites bloqueantes 2 a 8 são julgamento de engenharia.',
  },
  { type: 'BOOK', reference: 'EnergIF 2023, p. 18 (EF-M03): inclinação mínima de 10°' },
  {
    type: 'BOOK',
    reference: 'EnergIF 2023, p. 67 (EF-M06): micro ≤ 75 kW, mini ≤ 5 MW',
    notes: 'Pendente de confirmação com a regulação vigente (Lei 14.300/2022).',
  },
  {
    type: 'INTERNAL_POLICY',
    reference:
      'PR padrão 0,80, tolerância de orientação de 45° e demais limites: hipóteses do produto, sem fonte validada (EF-G01).',
  },
];

export const DEFAULT_CALCULATOR_RULES = {
  /** Referência gravada nos snapshots quando não há regra ativa do tenant. */
  ref: 'builtin@1',
  definition: { thresholds: {}, availabilityCostKwh: {} } as CalculatorRulesDefinition,
  sources: DEFAULT_CALCULATOR_RULE_SOURCES,
} as const;

// ---------------------------------------------------------------------------------------------------------
// Concessionárias, tarifas e irradiação (dados de referência do tenant)
// ---------------------------------------------------------------------------------------------------------

const nameSchema = z.string().trim().min(2).max(160);
const stateSchema = z.string().trim().length(2).toUpperCase();

export const createDistributorSchema = z.object({
  name: nameSchema,
  state: stateSchema.optional(),
});
export type CreateDistributorInput = z.infer<typeof createDistributorSchema>;
export const updateDistributorSchema = createDistributorSchema.partial();
export type UpdateDistributorInput = z.infer<typeof updateDistributorSchema>;

export const createTariffSchema = z.object({
  distributorId: z.uuid(),
  customerGroup: z.enum(CustomerGroup),
  /** Ex.: "Convencional", "Branca". */
  modality: z.string().trim().max(60).optional(),
  /** Tarifa de energia em centavos por kWh (admite fração de centavo). */
  energyCentsPerKwh: z.number().positive(),
  validFrom: isoDateTimeSchema,
  validTo: isoDateTimeSchema.optional(),
  /** De onde veio o valor (ex.: "Resolução homologatória nº 3.xxx/2026", "fatura do cliente"). */
  source: z.string().trim().min(2).max(300),
});
export type CreateTariffInput = z.input<typeof createTariffSchema>;
export type CreateTariffData = z.output<typeof createTariffSchema>;

export const listTariffsQuerySchema = z.object({
  distributorId: z.uuid().optional(),
  customerGroup: z.enum(CustomerGroup).optional(),
});

const hspMonthlySchema = z
  .array(z.number().positive().max(12))
  .length(12, 'Informe os 12 meses (jan a dez)');

export const createSolarResourceSchema = z.object({
  /** Local (cidade ou ponto): ex.: "Fortaleza". */
  name: nameSchema,
  state: stateSchema.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** HSP médio mensal (kWh/m²·dia), de janeiro a dezembro, no plano indicado em `plane`. */
  hspMonthly: hspMonthlySchema,
  /** Ex.: "CRESESB SunData", "Atlas Brasileiro de Energia Solar 2017". Obrigatório: nenhum dado sem origem. */
  source: z.string().trim().min(2).max(200),
  plane: z.string().trim().max(80).default('Plano horizontal'),
});
export type CreateSolarResourceInput = z.input<typeof createSolarResourceSchema>;
export type CreateSolarResourceData = z.output<typeof createSolarResourceSchema>;
/** Atualização parcial: sem reaplicar o padrão de `plane` (um `.partial()` direto o repõe e apaga o valor existente). */
export const updateSolarResourceSchema = createSolarResourceSchema
  .omit({ plane: true })
  .partial()
  .extend({ plane: z.string().trim().max(80).optional() });

export const importSolarResourcesSchema = z.object({
  rows: z.array(createSolarResourceSchema).min(1).max(500),
});
export type ImportSolarResourcesInput = z.input<typeof importSolarResourcesSchema>;
export type ImportSolarResourcesData = z.output<typeof importSolarResourcesSchema>;

export const listSolarResourcesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
});

// ---------------------------------------------------------------------------------------------------------
// Sessões de cálculo
// ---------------------------------------------------------------------------------------------------------

export const calculationReferencesSchema = z.object({
  solarResourceId: z.uuid().optional(),
  tariffId: z.uuid().optional(),
});
export type CalculationReferences = z.infer<typeof calculationReferencesSchema>;

export const listCalculationsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().optional(),
  trafficLight: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
});
export type ListCalculationsQuery = z.infer<typeof listCalculationsQuerySchema>;
