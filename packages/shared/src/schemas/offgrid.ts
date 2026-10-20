import { z } from 'zod';
import { paginationQuerySchema } from './common.js';
import { simulationDesignSchema, siteDesignSchema } from './engineering.js';

/**
 * Off-Grid Designer (Fase 10): sistemas isolados e híbridos (rede + bateria, **sem injeção na rede**). A versão guarda
 * o desenho como documento JSON validado aqui; os resultados são recalculados pelo motor puro (`solar-engine/offgrid`).
 * Física no código, regra em dado: perdas, DoD por química, autonomia mínima e reservas vêm da regra `offgrid.design`.
 */

export const OFFGRID_DESIGN_SCHEMA_VERSION = 1;

const idSchema = z.string().trim().min(1).max(60);
const hour = z.number().int().min(0).max(23);

export const OFFGRID_SYSTEM_TYPES = ['OFFGRID', 'HYBRID'] as const;
export type OffgridSystemType = (typeof OFFGRID_SYSTEM_TYPES)[number];

export const SYSTEM_VOLTAGES = [12, 24, 48] as const;

/**
 * Carga do sistema. Energia diária = potência × quantidade × horas por dia, distribuída na janela de uso. A janela
 * pode atravessar a meia-noite (início maior que o fim). `surgeFactor` multiplica a potência na partida (motores).
 */
export const offgridLoadSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().max(60).optional(),
  powerW: z.number().positive().max(1_000_000),
  quantity: z.number().int().min(1).max(10_000).default(1),
  kind: z.enum(['AC', 'DC']).default('AC'),
  hoursPerDay: z.number().min(0).max(24),
  /** Janela de uso na hora local: do início (inclusive) ao fim (exclusive). Padrão: o dia todo. */
  windowStartHour: hour.default(0),
  windowEndHour: z.number().int().min(1).max(24).default(24),
  /** Dias da semana em uso (0 = domingo). Padrão: todos. */
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0, 1, 2, 3, 4, 5, 6]),
  /** Fator mensal de uso (jan a dez); 1 = uso normal. Sazonalidade (casa de praia, bomba de irrigação). */
  seasonality: z.array(z.number().min(0).max(5)).length(12).default(Array<number>(12).fill(1)),
  surgeFactor: z.number().min(1).max(12).default(1),
  /** Fração de unidades ligadas ao mesmo tempo no pico (simultaneidade). */
  simultaneity: z.number().min(0).max(1).default(1),
  /** Carga crítica: mantida mesmo em modo de economia / reserva. */
  critical: z.boolean().default(false),
});
export type OffgridLoad = z.output<typeof offgridLoadSchema>;

export const offgridArraySchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  moduleId: z.uuid().optional(),
  modulesInSeries: z.number().int().min(1).max(40).default(1),
  parallelStrings: z.number().int().min(1).max(50).default(1),
  azimuthDegrees: z.number().min(0).lt(360).default(0),
  tiltDegrees: z.number().min(0).max(90).default(15),
  /** Perda por sombra informada, com a fonte. */
  shadingLossPct: z.number().min(0).max(100).default(0),
  /** Cabo/estrutura: distância do arranjo ao controlador (m), para a queda CC. */
  cableLengthM: z.number().min(0).max(500).optional(),
});
export type OffgridArray = z.output<typeof offgridArraySchema>;

export const offgridBankSchema = z.object({
  batteryId: z.uuid().optional(),
  seriesCount: z.number().int().min(1).max(40).default(1),
  parallelCount: z.number().int().min(1).max(20).default(1),
  /** Profundidade de descarga de projeto (%); vazio = a máxima da ficha, limitada pela regra. */
  designDodPct: z.number().min(5).max(100).optional(),
  /** Temperatura média do local das baterias (°C): afeta capacidade e vida. */
  temperatureC: z.number().min(-20).max(60).default(25),
});

export const offgridGeneratorSchema = z.object({
  enabled: z.boolean().default(false),
  generatorId: z.uuid().optional(),
  /** Liga ao descer a este SOC e desliga ao atingir o SOC de parada. */
  startSocPct: z.number().min(0).max(100).default(30),
  stopSocPct: z.number().min(0).max(100).default(80),
  minRunHours: z.number().min(0).max(24).default(1),
  /** Horas do dia em que o gerador pode funcionar (silêncio noturno). Vazio = o dia todo. */
  allowedFromHour: hour.default(0),
  allowedToHour: z.number().int().min(1).max(24).default(24),
  fuelPriceCentsPerLiter: z.number().min(0).max(100_000).default(0),
});

export const GRID_MODES = ['BACKUP', 'SELF_CONSUMPTION'] as const;

/**
 * Rede (sistema híbrido). Nunca há injeção. `BACKUP`: a rede alimenta as cargas e a bateria fica de reserva para as
 * quedas; `SELF_CONSUMPTION`: a bateria é usada todo dia e a rede cobre só o que falta.
 */
export const offgridGridSchema = z.object({
  mode: z.enum(GRID_MODES).default('BACKUP'),
  /** Janela diária sem rede (hora local) e dias seguidos de queda prolongada. */
  dailyOutageStartHour: hour.default(0),
  dailyOutageHours: z.number().min(0).max(24).default(0),
  extendedOutages: z
    .array(
      z.object({
        startDayOfYear: z.number().int().min(1).max(365),
        days: z.number().int().min(1).max(30),
      }),
    )
    .max(10)
    .default([]),
  /** SOC mínimo guardado para quedas, em BACKUP. */
  reserveSocPct: z.number().min(0).max(100).default(50),
  /** A rede recarrega a bateria quando o SOC cai abaixo deste valor (0 = nunca). */
  gridChargeBelowSocPct: z.number().min(0).max(100).default(0),
  tariffCentsPerKwh: z.number().min(0).max(100_000).default(0),
});

export const offgridEconomicsSchema = z.object({
  horizonYears: z.number().int().min(1).max(40).default(20),
  discountRatePct: z.number().min(0).max(100).default(8),
  maintenancePctPerYear: z.number().min(0).max(30).default(1),
  /** Custos fixos além dos equipamentos do catálogo (estrutura, instalação, projeto, frete). */
  installationCostCents: z.number().int().min(0).default(0),
  otherCostCents: z.number().int().min(0).default(0),
  /** Custo evitado (para comparar): gerador a diesel, extensão de rede ou kWh da concessionária. */
  avoidedCostCentsPerKwh: z.number().min(0).max(100_000).default(0),
});

export const offgridScenarioSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(60),
  bank: offgridBankSchema.partial().optional(),
  /** Substitui as strings em paralelo do primeiro arranjo. */
  parallelStrings: z.number().int().min(1).max(50).optional(),
  generatorEnabled: z.boolean().optional(),
  autonomyDays: z.number().min(0.5).max(14).optional(),
});
export type OffgridScenario = z.output<typeof offgridScenarioSchema>;

export const offgridStressSchema = z.object({
  enabled: z.boolean().default(true),
  /** Dias seguidos nublados no mês crítico. */
  cloudyDays: z.number().int().min(1).max(14).default(3),
  /** Fração da irradiação normal nos dias nublados. */
  irradianceFactor: z.number().min(0).max(1).default(0.3),
  /** Crescimento de carga a testar (%). */
  loadGrowthPct: z.number().min(0).max(200).default(20),
});

export const offgridDesignSchema = z.object({
  schemaVersion: z.literal(OFFGRID_DESIGN_SCHEMA_VERSION).default(OFFGRID_DESIGN_SCHEMA_VERSION),
  systemType: z.enum(OFFGRID_SYSTEM_TYPES).default('OFFGRID'),
  site: siteDesignSchema,
  loads: z.array(offgridLoadSchema).max(200).default([]),
  /** Tensão do barramento CC (banco). */
  systemVoltageV: z.union([z.literal(12), z.literal(24), z.literal(48)]).default(48),
  /** Dias de autonomia de projeto (a regra define o mínimo). */
  autonomyDays: z.number().min(0.5).max(14).default(2),
  /** Redutores do dimensionamento do FV (CRESESB): `red1` temperatura/sujeira/mismatch e `red2` cabos/controlador. */
  red1: z.number().min(0.3).max(1).optional(),
  red2: z.number().min(0.3).max(1).optional(),
  /** Eficiência do banco e do inversor usadas na energia a gerar. */
  batteryEfficiency: z.number().min(0.5).max(1).optional(),
  inverterEfficiency: z.number().min(0.5).max(1).optional(),
  albedo: z.number().min(0).max(1).optional(),
  arrays: z.array(offgridArraySchema).max(8).default([]),
  bank: offgridBankSchema.default({ seriesCount: 1, parallelCount: 1, temperatureC: 25 }),
  controllerId: z.uuid().optional(),
  controllerCount: z.number().int().min(1).max(20).default(1),
  inverterId: z.uuid().optional(),
  inverterCount: z.number().int().min(1).max(10).default(1),
  generator: offgridGeneratorSchema.default({
    enabled: false,
    startSocPct: 30,
    stopSocPct: 80,
    minRunHours: 1,
    allowedFromHour: 0,
    allowedToHour: 24,
    fuelPriceCentsPerLiter: 0,
  }),
  grid: offgridGridSchema.optional(),
  /** Série horária da Central: sem ela, o motor usa a climatologia mensal do local. */
  simulation: simulationDesignSchema.pick({ source: true, year: true }).optional(),
  economics: offgridEconomicsSchema.default({
    horizonYears: 20,
    discountRatePct: 8,
    maintenancePctPerYear: 1,
    installationCostCents: 0,
    otherCostCents: 0,
    avoidedCostCentsPerKwh: 0,
  }),
  scenarios: z.array(offgridScenarioSchema).max(3).default([]),
  stress: offgridStressSchema.default({
    enabled: true,
    cloudyDays: 3,
    irradianceFactor: 0.3,
    loadGrowthPct: 20,
  }),
});
export type OffgridDesign = z.output<typeof offgridDesignSchema>;
export type OffgridDesignInput = z.input<typeof offgridDesignSchema>;

export const newOffgridDesign = (
  site: Pick<z.infer<typeof siteDesignSchema>, 'latitude' | 'longitude'> &
    Partial<z.infer<typeof siteDesignSchema>>,
  systemType: OffgridSystemType = 'OFFGRID',
): OffgridDesign => offgridDesignSchema.parse({ site, systemType });

/** Parâmetros da regra `offgrid.design` que o motor lê (sem valor padrão: ausente = pendente de regra). */
export const OFFGRID_DESIGN_PARAMETERS = {
  red1Default: 'Redutor 1 padrão do FV (temperatura, sujeira, mismatch)',
  red2Default: 'Redutor 2 padrão do FV (cabos e controlador)',
  batteryEfficiencyDefault: 'Eficiência do banco de baterias',
  inverterEfficiencyMin: 'Eficiência mínima do inversor',
  autonomyMinDays: 'Autonomia mínima (dias)',
  dodMaxLeadFlooded: 'DoD máxima chumbo aberto (%)',
  dodMaxLeadVrla: 'DoD máxima chumbo AGM/gel (%)',
  dodMaxStationary: 'DoD máxima OPzS/OPzV (%)',
  dodMaxLithium: 'DoD máxima lítio (%)',
  controllerCurrentFactor: 'Fator de corrente do controlador sobre a Isc',
  vocColdFactor: 'Fator de segurança da Voc a frio',
  inverterSurgeMargin: 'Margem de potência do inversor sobre o pico',
  maxBatteriesParallel: 'Máximo de baterias em paralelo',
  maxChargeCRate: 'Corrente de carga máxima (C)',
  lolpMaxPct: 'Perda de carga máxima aceita (%)',
  chargeVoltageFactor: 'Fator da tensão de carga sobre a nominal do banco',
  pvOtherLossFactor: 'Fator de sujeira e mismatch do FV',
} as const;
export type OffgridDesignParameter = keyof typeof OFFGRID_DESIGN_PARAMETERS;

// ---------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------

export const createOffgridRequestSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
  systemType: z.enum(OFFGRID_SYSTEM_TYPES).default('OFFGRID'),
  opportunityId: z.uuid().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  dueAt: z.string().max(40).optional(),
});
export type CreateOffgridRequestInput = z.input<typeof createOffgridRequestSchema>;

export const listOffgridRequestsQuerySchema = z.object({
  status: z
    .enum([
      'PENDING',
      'IN_PROGRESS',
      'WAITING_VISIT',
      'WAITING_INFO',
      'IN_REVIEW',
      'DONE',
      'CANCELLED',
    ])
    .optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListOffgridRequestsQuery = z.infer<typeof listOffgridRequestsQuerySchema>;

export const changeOffgridRequestSchema = z.object({
  status: z
    .enum(['IN_PROGRESS', 'WAITING_VISIT', 'WAITING_INFO', 'IN_REVIEW', 'CANCELLED'])
    .optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueAt: z.string().max(40).nullable().optional(),
  note: z.string().trim().max(1000).optional(),
});
export type ChangeOffgridRequestInput = z.infer<typeof changeOffgridRequestSchema>;

export const offgridCommentSchema = z.object({ text: z.string().trim().min(1).max(2000) });

export const listOffgridProjectsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['IN_PROGRESS', 'APPROVED', 'CANCELLED']).optional(),
  search: z.string().trim().optional(),
});
export type ListOffgridProjectsQuery = z.infer<typeof listOffgridProjectsQuerySchema>;

export const createOffgridProjectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  systemType: z.enum(OFFGRID_SYSTEM_TYPES).default('OFFGRID'),
  site: siteDesignSchema.pick({ latitude: true, longitude: true }).extend({
    name: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    state: z.string().trim().length(2).toUpperCase().optional(),
  }),
  opportunityId: z.uuid().optional(),
  /** Atende este pedido (ele passa a EM ANDAMENTO e aponta para o projeto). */
  requestId: z.uuid().optional(),
});
export type CreateOffgridProjectInput = z.input<typeof createOffgridProjectSchema>;

export const updateOffgridProjectSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  responsibleId: z.uuid().nullable().optional(),
  artType: z.enum(['ART', 'TRT', 'RRT']).nullable().optional(),
  artNumber: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateOffgridProjectInput = z.infer<typeof updateOffgridProjectSchema>;

export const saveOffgridDesignSchema = z.object({ design: offgridDesignSchema });
export type SaveOffgridDesignInput = z.input<typeof saveOffgridDesignSchema>;

/** Sugestão automática de dimensionamento a partir do catálogo aprovado. */
export const suggestOffgridSchema = z.object({
  design: offgridDesignSchema.optional(),
  limit: z.number().int().min(1).max(10).default(5),
});
export type SuggestOffgridInput = z.input<typeof suggestOffgridSchema>;
