import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

/**
 * Projeto de engenharia (Fase 9D, ADR-0015): a versão guarda o **desenho como documento JSON** validado aqui, e os
 * resultados recalculados em outro campo. Novos assuntos (strings, proteções, simulação...) entram como chaves
 * opcionais do documento nas fases seguintes, sem quebrar versões antigas.
 */

export const ENGINEERING_DESIGN_SCHEMA_VERSION = 1;

const idSchema = z.string().trim().min(1).max(60);
const azimuthSchema = z.number().min(0).lt(360);

/** Obstáculo próximo que projeta sombra (caixa d'água, platibanda, árvore, prédio vizinho). */
export const obstacleSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  /** Direção do obstáculo vista do arranjo (0° = Norte, 90° = Leste). */
  azimuthDegrees: azimuthSchema,
  /** Distância horizontal do arranjo ao obstáculo (m). */
  distanceM: z.number().min(0.1).max(500),
  /** Altura do topo do obstáculo acima da base do arranjo (m). Zero ou negativo não sombreia. */
  heightM: z.number().min(-50).max(200),
  /** Largura do obstáculo vista do arranjo (m). */
  widthM: z.number().min(0.05).max(500),
});
export type Obstacle = z.infer<typeof obstacleSchema>;

export const SURFACE_KINDS = ['PITCHED', 'FLAT_RACK'] as const;
export const MODULE_ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const;

const setbackSchema = z.object({
  left: z.number().min(0).max(10).default(0.3),
  right: z.number().min(0).max(10).default(0.3),
  top: z.number().min(0).max(10).default(0.3),
  bottom: z.number().min(0).max(10).default(0.3),
});

/**
 * Superfície de instalação. `PITCHED` é telhado inclinado com os módulos no plano do telhado; `FLAT_RACK` é laje ou solo
 * com estrutura inclinada (as fileiras se sombreiam, e o espaçamento entra no cálculo).
 */
export const surfaceSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(SURFACE_KINDS).default('PITCHED'),
  /** Para onde a face aponta (0° = Norte, 90° = Leste, 180° = Sul). */
  azimuthDegrees: azimuthSchema,
  tiltDegrees: z.number().min(0).max(90),
  /** Largura (ao longo do beiral, na horizontal) e profundidade (PITCHED: ao longo da água; FLAT_RACK: na horizontal). */
  widthM: z.number().min(0.5).max(500),
  depthM: z.number().min(0.5).max(500),
  setbackM: setbackSchema.default({ left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 }),
  moduleOrientation: z.enum(MODULE_ORIENTATIONS).default('PORTRAIT'),
  moduleGapM: z.number().min(0).max(0.2).default(0.02),
  /** Espaçamento entre fileiras (FLAT_RACK). Vazio = o mínimo calculado para o inverno. */
  rowSpacingM: z.number().min(0).max(20).optional(),
  /** Módulo desta superfície (catálogo aprovado). Vazio = o módulo padrão do projeto. */
  moduleId: z.uuid().optional(),
  /** Limita a quantidade (menor que o máximo que cabe). */
  moduleCount: z.number().int().min(1).max(5000).optional(),
  obstacles: z.array(obstacleSchema).max(30).default([]),
  /** Perda por sombra informada à mão, quando não há dados para calcular. Exige a fonte. */
  shadingLossOverride: z
    .object({ pct: z.number().min(0).max(100), source: z.string().trim().min(3).max(200) })
    .optional(),
});
export type Surface = z.infer<typeof surfaceSchema>;

const monthly = z.array(z.number().nullable()).length(12);

export const siteDesignSchema = z.object({
  name: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().length(2).toUpperCase().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevationM: z.number().min(-500).max(9000).optional(),
  /** Temperatura mínima de projeto (°C) para o Voc frio: definida pelo responsável técnico, com a fonte. */
  designTminC: z.number().min(-60).max(30).nullable().default(null),
  designTmaxAmbientC: z.number().min(0).max(60).nullable().default(null),
  designTemperatureSource: z.string().trim().max(200).optional(),
  /** Clima trazido da Central de Dados (resumo mensal e origem). */
  climate: z
    .object({
      source: z.enum(['nasa-power', 'pvgis']),
      period: z.string().max(40),
      fetchedAt: z.string().max(40),
      ghiKwhM2Day: monthly,
      tempMeanC: monthly,
      tempMinC: monthly,
      tempMaxC: monthly,
      attribution: z.string().max(300).optional(),
    })
    .nullable()
    .default(null),
  /** Perfil de horizonte (sombreamento distante). */
  horizon: z
    .object({
      source: z.literal('pvgis'),
      fetchedAt: z.string().max(40),
      points: z
        .array(
          z.object({
            azimuthDegrees: z.number().min(0).max(360),
            heightDegrees: z.number().min(0).max(90),
          }),
        )
        .min(4)
        .max(400),
    })
    .nullable()
    .default(null),
});
export type SiteDesign = z.infer<typeof siteDesignSchema>;

// ---------------------------------------------------------------------------------------------------------
// Inversores, strings e MPPT (Fase 9E)
// ---------------------------------------------------------------------------------------------------------

/** Strings iguais ligadas em paralelo a uma entrada de MPPT: `parallel` strings de `modulesInSeries` módulos cada. */
export const stringGroupSchema = z.object({
  id: idSchema,
  surfaceId: idSchema,
  modulesInSeries: z.number().int().min(1).max(60),
  parallel: z.number().int().min(1).max(20).default(1),
});
export type StringGroup = z.infer<typeof stringGroupSchema>;

export const mpptAllocationSchema = z.object({
  strings: z.array(stringGroupSchema).max(8).default([]),
});

/** Um inversor do projeto (uma unidade física), com o que está ligado em cada MPPT. */
export const inverterEntrySchema = z.object({
  id: idSchema,
  inverterId: z.uuid(),
  name: z.string().trim().max(80).optional(),
  mppts: z.array(mpptAllocationSchema).max(24).default([]),
  /** Microinversor: cada unidade liga `modulesPerUnit` módulos da superfície; `units` unidades iguais. */
  micro: z
    .object({
      surfaceId: idSchema,
      units: z.number().int().min(1).max(500),
      modulesPerUnit: z.number().int().min(1).max(8),
    })
    .optional(),
});
export type InverterEntry = z.infer<typeof inverterEntrySchema>;

// ---------------------------------------------------------------------------------------------------------
// Proteções, cabos e lista de materiais (Fase 9F)
// ---------------------------------------------------------------------------------------------------------

export const CABLE_RUN_KINDS = ['DC_STRING', 'DC_MAIN', 'AC'] as const;

/**
 * Trecho de cabo. `DC_STRING`: cabo de uma string até a string box; `DC_MAIN`: da string box ao inversor (corrente de
 * todas as strings do MPPT); `AC`: do inversor ao quadro. `count` = trechos idênticos.
 */
export const cableRunSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(80),
  kind: z.enum(CABLE_RUN_KINDS),
  inverterEntryId: idSchema,
  /** MPPT (a partir de 0) a que o trecho CC pertence. */
  mpptIndex: z.number().int().min(0).max(23).optional(),
  /** Comprimento de ida (m); o cálculo considera ida e volta. */
  lengthM: z.number().positive().max(1000),
  /** `true` enquanto o comprimento é só uma estimativa: fica pendente e impede a aprovação até ser confirmado. */
  lengthEstimated: z.boolean().default(false),
  count: z.number().int().min(1).max(500).default(1),
  /** Método de instalação, para a tabela de capacidade de condução da regra `engine.cables`. */
  installMethod: z.string().trim().max(40).optional(),
  /** Cabo escolhido no catálogo. Vazio = o sistema sugere o menor que atende. */
  cableId: z.uuid().optional(),
});
export type CableRun = z.infer<typeof cableRunSchema>;

export const PROTECTION_ROLES = [
  'STRING_FUSE',
  'DC_DISCONNECTOR',
  'DC_SURGE',
  'AC_BREAKER',
  'RCD',
] as const;
export type ProtectionRole = (typeof PROTECTION_ROLES)[number];

/** Escolha manual de uma proteção (em vez da sugestão automática): é conferida contra a exigência. */
export const protectionOverrideSchema = z.object({
  id: idSchema,
  role: z.enum(PROTECTION_ROLES),
  inverterEntryId: idSchema,
  mpptIndex: z.number().int().min(0).max(23).optional(),
  equipmentId: z.uuid(),
});
export type ProtectionOverride = z.infer<typeof protectionOverrideSchema>;

export const engineeringDesignSchema = z.object({
  schemaVersion: z
    .literal(ENGINEERING_DESIGN_SCHEMA_VERSION)
    .default(ENGINEERING_DESIGN_SCHEMA_VERSION),
  site: siteDesignSchema,
  /** Módulo padrão do projeto (catálogo aprovado). */
  defaultModuleId: z.uuid().optional(),
  surfaces: z.array(surfaceSchema).max(20).default([]),
  /** Inversores, strings e MPPT. */
  inverters: z.array(inverterEntrySchema).max(30).default([]),
  /** Trechos de cabo (CC e CA). */
  cables: z.array(cableRunSchema).max(200).default([]),
  /** Proteções escolhidas à mão (o resto é sugerido pelo sistema). */
  protectionOverrides: z.array(protectionOverrideSchema).max(200).default([]),
});
export type EngineeringDesign = z.output<typeof engineeringDesignSchema>;
export type EngineeringDesignInput = z.input<typeof engineeringDesignSchema>;

/** Desenho inicial de um projeto novo: só o local, sem superfícies. */
export const newDesign = (
  site: Pick<SiteDesign, 'latitude' | 'longitude'> & Partial<SiteDesign>,
): EngineeringDesign => engineeringDesignSchema.parse({ site, surfaces: [] });

// ---------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------

export const ENGINEERING_REQUEST_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;

export const listEngineeringRequestsQuerySchema = z.object({
  status: z.enum(ENGINEERING_REQUEST_STATUSES).optional(),
  /** `true`: só os pedidos atribuídos a mim. */
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListEngineeringRequestsQuery = z.infer<typeof listEngineeringRequestsQuerySchema>;

export const cancelEngineeringRequestSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const ENGINEERING_PROJECT_STATUSES = ['IN_PROGRESS', 'APPROVED', 'CANCELLED'] as const;
export const listEngineeringProjectsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ENGINEERING_PROJECT_STATUSES).optional(),
  search: z.string().trim().optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListEngineeringProjectsQuery = z.infer<typeof listEngineeringProjectsQuerySchema>;

export const createEngineeringProjectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  site: siteDesignSchema.pick({ latitude: true, longitude: true }).extend({
    name: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    state: z.string().trim().length(2).toUpperCase().optional(),
  }),
  opportunityId: z.uuid().optional(),
});
export type CreateEngineeringProjectInput = z.input<typeof createEngineeringProjectSchema>;

export const saveDesignSchema = z.object({
  design: engineeringDesignSchema,
});
export type SaveDesignInput = z.input<typeof saveDesignSchema>;

/** Parâmetros da regra `engine.design` que o Engine lê (sem valor padrão: ausente = pendente de regra). */
export const ENGINE_DESIGN_PARAMETERS = {
  /** Faixa da relação potência CC dos módulos ÷ potência CA nominal do inversor. */
  dcAcRatioMin: 'Relação CC/CA mínima',
  dcAcRatioMax: 'Relação CC/CA máxima',
  /** Irradiância (W/m²) para a temperatura máxima da célula (`Tcel = Tamb + (NOCT − 20)/800 × G`). */
  hotCellIrradianceWm2: 'Irradiância para a temperatura máxima da célula (W/m²)',
  /** Até quantas strings em paralelo dispensam fusível em cada string (EnergIF p. 169, exigência do fabricante do módulo). */
  maxParallelStringsWithoutFuse: 'Strings em paralelo sem fusível',
  /** Corrente mínima do fusível de string = fator × Isc do módulo (e no máximo o fusível máximo da ficha). */
  fuseMinFactor: 'Fator mínimo do fusível sobre a Isc',
  /** Corrente mínima da seccionadora CC = fator × Isc × strings em paralelo do MPPT. */
  dcSwitchCurrentFactor: 'Fator da seccionadora CC sobre a Isc',
  /** Corrente mínima do disjuntor CA = fator × corrente CA do inversor. */
  acBreakerFactor: 'Fator do disjuntor CA sobre a corrente do inversor',
  /** Sensibilidade máxima do DR (mA). */
  rcdSensitivityMa: 'Sensibilidade máxima do DR (mA)',
} as const;
export type EngineDesignParameter = keyof typeof ENGINE_DESIGN_PARAMETERS;

export const suggestConfigurationsSchema = z.object({
  surfaceId: idSchema,
  /** Potência-alvo do arranjo desta superfície (kWp). */
  targetKwp: z.number().positive().max(10000),
  moduleIds: z.array(z.uuid()).max(30).optional(),
  inverterIds: z.array(z.uuid()).max(30).optional(),
  maxInverters: z.number().int().min(1).max(8).default(4),
  /** Desenho atual (ainda não salvo). Vazio = o desenho salvo da versão. */
  design: engineeringDesignSchema.optional(),
  limit: z.number().int().min(1).max(30).default(10),
});
export type SuggestConfigurationsInput = z.input<typeof suggestConfigurationsSchema>;

/** Parâmetros da regra `engine.cables` que o Engine lê (sem valor padrão: ausente = pendente de regra). */
export const ENGINE_CABLES_PARAMETERS = {
  maxVoltageDropDcPct: 'Queda de tensão máxima no lado CC (%)',
  maxVoltageDropAcPct: 'Queda de tensão máxima no lado CA (%)',
  /** Temperatura do condutor para a resistividade (°C). */
  conductorTempC: 'Temperatura do condutor (°C)',
  /** Fator sobre a corrente de projeto do cabo CC (aplicado à Isc). */
  cableCurrentFactorDc: 'Fator de corrente do cabo CC',
  /** Fator sobre a corrente de projeto do cabo CA. */
  cableCurrentFactorAc: 'Fator de corrente do cabo CA',
  /** Sobra de cabo na lista de materiais (%). Opcional: ausente = sem sobra. */
  cableSurplusPct: 'Sobra de cabo na lista de materiais (%)',
} as const;
export type EngineCablesParameter = keyof typeof ENGINE_CABLES_PARAMETERS;

/** Tabela de capacidade de condução da regra `engine.cables`: `tables.ampacity` com estas colunas. */
export const AMPACITY_TABLE = 'ampacity';
