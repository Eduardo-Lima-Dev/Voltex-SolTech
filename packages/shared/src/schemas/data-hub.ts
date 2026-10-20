import { z } from 'zod';

/** Central de Dados Externos (Fase 9B, ADR-0018): contratos de entrada da API. */

export const DATA_SOURCE_KEYS = ['pvgis', 'nasa-power', 'aneel-tariffs', 'cec-library'] as const;
export type DataSourceKey = (typeof DATA_SOURCE_KEYS)[number];

/** Fontes de clima que a Central sabe consultar. */
export const WEATHER_SOURCE_KEYS = ['nasa-power', 'pvgis'] as const;
export type WeatherSourceKey = (typeof WEATHER_SOURCE_KEYS)[number];

export const WATCH_KINDS = ['NORM', 'LAW', 'OTHER'] as const;
export const UPDATE_PROPOSAL_TYPES = [
  'TARIFF',
  'WATCH_CHANGE',
  'CATALOG_ITEM',
  'SOLAR_RESOURCE',
  'RULE_REVIEW',
] as const;
export type UpdateProposalType = (typeof UPDATE_PROPOSAL_TYPES)[number];
export const UPDATE_PROPOSAL_STATUSES = ['PENDING', 'APPROVED', 'DISCARDED'] as const;
export type UpdateProposalStatus = (typeof UPDATE_PROPOSAL_STATUSES)[number];

/** Primeiro ano com série completa que o PVGIS e a NASA oferecem para o Brasil (limite conservador). */
const MIN_YEAR = 2005;

export const weatherQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    source: z.enum(WEATHER_SOURCE_KEYS).default('nasa-power'),
    /** `climatology`: 12 meses (leve). `hourly`: série horária de um ano (pesada, guardada em cache). */
    kind: z.enum(['climatology', 'hourly']).default('climatology'),
    /** Ano da série horária. Obrigatório quando `kind=hourly`. */
    year: z.coerce.number().int().min(MIN_YEAR).max(2100).optional(),
    /** Ignora o cache e busca de novo. */
    refresh: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .refine((q) => q.kind !== 'hourly' || q.year !== undefined, {
    path: ['year'],
    message: 'Informe o ano da série horária',
  });
export type WeatherQuery = z.output<typeof weatherQuerySchema>;

export const horizonQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});
export type HorizonQuery = z.output<typeof horizonQuerySchema>;

export const createSourceWatchSchema = z.object({
  label: z.string().trim().min(2).max(160),
  url: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .transform((value) => value.trim()),
  kind: z.enum(WATCH_KINDS).default('NORM'),
});
export type CreateSourceWatchInput = z.input<typeof createSourceWatchSchema>;

/** Atualização parcial sem reaplicar o padrão de `kind` (armadilha do `.partial()` com `.default()`). */
export const updateSourceWatchSchema = z.object({
  label: z.string().trim().min(2).max(160).optional(),
  kind: z.enum(WATCH_KINDS).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateSourceWatchInput = z.infer<typeof updateSourceWatchSchema>;

export const listProposalsQuerySchema = z.object({
  status: z.enum(UPDATE_PROPOSAL_STATUSES).optional(),
  type: z.enum(UPDATE_PROPOSAL_TYPES).optional(),
});
export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;

export const decideProposalSchema = z
  .object({
    decision: z.enum(['APPROVE', 'DISCARD']),
    /** Obrigatório ao descartar: a decisão fica no histórico. */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((d) => d.decision === 'APPROVE' || d.reason !== undefined, {
    path: ['reason'],
    message: 'Informe o motivo do descarte',
  });
export type DecideProposalInput = z.infer<typeof decideProposalSchema>;

/** Pede uma proposta de recurso solar (HSP e temperaturas) para um local, a partir da NASA POWER. */
export const proposeSolarResourceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  state: z.string().trim().length(2).toUpperCase().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Busca de novo na fonte, ignorando o cache. */
  refresh: z.boolean().optional(),
});
export type ProposeSolarResourceInput = z.infer<typeof proposeSolarResourceSchema>;
