import { z } from 'zod';

/** Central de Dados Externos (Fase 9B, ADR-0018): contratos de entrada da API. */

export const DATA_SOURCE_KEYS = [
  'pvgis',
  'nasa-power',
  'aneel-tariffs',
  'cec-library',
  'techlux',
] as const;
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
export const WEATHER_SERIES_FIRST_YEAR = 2005;
export const WEATHER_SERIES_LAST_YEAR = 2100;

export const weatherQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    source: z.enum(WEATHER_SOURCE_KEYS).default('nasa-power'),
    /** `climatology`: 12 meses (leve). `hourly`: série horária de um ano (pesada, guardada em cache). */
    kind: z.enum(['climatology', 'hourly']).default('climatology'),
    /** Ano da série horária. Obrigatório quando `kind=hourly`. */
    year: z.coerce
      .number()
      .int()
      .min(WEATHER_SERIES_FIRST_YEAR)
      .max(WEATHER_SERIES_LAST_YEAR)
      .optional(),
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

// ---------------------------------------------------------------------------------------------------------
// Catálogo de fontes oficiais sugeridas (plano do módulo de inteligência regulatória)
// ---------------------------------------------------------------------------------------------------------

export const SOURCE_DOMAINS = ['REGULATION', 'TARIFF', 'EQUIPMENT', 'SOLAR_RESOURCE'] as const;
export type SourceDomain = (typeof SOURCE_DOMAINS)[number];

/**
 * Como a fonte entra no sistema:
 * `INTEGRATED` já tem conector próprio; `WATCH` a página pode ser vigiada (mudança vira proposta para revisão humana);
 * `MANUAL` só consulta manual (sem API aberta confirmada); `BLOCKED` não usar antes de resolver a licença.
 */
export const SOURCE_MODES = ['INTEGRATED', 'WATCH', 'MANUAL', 'BLOCKED'] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

export interface SuggestedSource {
  id: string;
  label: string;
  url: string;
  domain: SourceDomain;
  mode: SourceMode;
  /** Tipo da vigilância quando `mode = WATCH`. */
  watchKind?: (typeof WATCH_KINDS)[number];
  /** Política proposta de verificação (não é a frequência de publicação da fonte). */
  cadence: string;
  /** Restrições e cuidados de uso. */
  caution: string;
  priority: 'P0' | 'P1' | 'P2';
}

/** Fontes oficiais e gratuitas do plano (§2). A escolha de usar cada uma é sempre da empresa. */
export const SUGGESTED_SOURCES: readonly SuggestedSource[] = [
  {
    id: 'ANEEL_LEGISLATION',
    label: 'ANEEL: legislação (resoluções, alterações e revogações)',
    url: 'https://legislacao.aneel.gov.br/',
    domain: 'REGULATION',
    mode: 'WATCH',
    watchKind: 'NORM',
    cadence: 'Diária',
    caution:
      'Não há API oficial confirmada: o sistema só compara a página. Consulta pública não é norma vigente.',
    priority: 'P0',
  },
  {
    id: 'PRODIST',
    label: 'PRODIST (ANEEL): procedimentos de distribuição, módulo 3 em especial',
    url: 'https://www.gov.br/aneel/pt-br/centrais-de-conteudos/procedimentos-regulatorios/prodist',
    domain: 'REGULATION',
    mode: 'WATCH',
    watchKind: 'NORM',
    cadence: 'Diária',
    caution:
      'Guardar a indicação oficial de versão vigente; versões anteriores continuam valendo para projetos antigos.',
    priority: 'P0',
  },
  {
    id: 'PRORET',
    label: 'PRORET (ANEEL): procedimentos de regulação tarifária',
    url: 'https://www.gov.br/aneel/pt-br/centrais-de-conteudos/procedimentos-regulatorios/proret',
    domain: 'REGULATION',
    mode: 'WATCH',
    watchKind: 'NORM',
    cadence: 'Diária',
    caution: 'A vigência pode ser futura mesmo quando a página indica uma nova versão.',
    priority: 'P0',
  },
  {
    id: 'PLANALTO_14300',
    label: 'Lei 14.300/2022 (Planalto): geração distribuída',
    url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2022/lei/l14300.htm',
    domain: 'REGULATION',
    mode: 'WATCH',
    watchKind: 'LAW',
    cadence: 'Diária',
    caution: 'O texto consolidado exige conferir alterações e vigência.',
    priority: 'P0',
  },
  {
    id: 'ENEL_CE',
    label: 'Enel Ceará: normas de conexão, manuais e formulários de geração distribuída',
    url: 'https://www.enel.com.br/pt-ceara/Corporativo_e_Governo/geracao-distribuida.html',
    domain: 'REGULATION',
    mode: 'WATCH',
    watchKind: 'NORM',
    cadence: 'Diária',
    caution:
      'Páginas podem manter referências antigas: confira o documento vigente e respeite os termos do site.',
    priority: 'P0',
  },
  {
    id: 'ANEEL_OPEN_TARIFF',
    label: 'ANEEL Dados Abertos: tarifas das distribuidoras',
    url: 'https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica',
    domain: 'TARIFF',
    mode: 'INTEGRATED',
    cadence: 'Semanal (metadados)',
    caution: 'ODbL: registrar licença e créditos. Tarifa nova vira proposta, nunca entra sozinha.',
    priority: 'P0',
  },
  {
    id: 'ANEEL_OPEN_MMGD',
    label: 'ANEEL Dados Abertos: relação de empreendimentos de geração distribuída',
    url: 'https://dadosabertos.aneel.gov.br/dataset/relacao-de-empreendimentos-de-geracao-distribuida',
    domain: 'REGULATION',
    mode: 'WATCH',
    watchKind: 'OTHER',
    cadence: 'Semanal',
    caution: 'Dados históricos não equivalem à capacidade atual de conexão.',
    priority: 'P1',
  },
  {
    id: 'ANEEL_OPEN_CONSULT',
    label: 'ANEEL: audiências e consultas públicas',
    url: 'https://dadosabertos.aneel.gov.br/dataset/audiencias-e-consultas-publicas',
    domain: 'REGULATION',
    mode: 'WATCH',
    watchKind: 'OTHER',
    cadence: 'Semanal',
    caution: 'Consulta pública NÃO é norma vigente: nunca vira regra sem revisão.',
    priority: 'P1',
  },
  {
    id: 'NASA_POWER',
    label: 'NASA POWER: radiação e meteorologia',
    url: 'https://power.larc.nasa.gov/docs/services/api/',
    domain: 'SOLAR_RESOURCE',
    mode: 'INTEGRATED',
    cadence: 'Sob demanda, com cache',
    caution: 'Respeitar limites e atribuição; sempre pelo servidor.',
    priority: 'P1',
  },
  {
    id: 'PVGIS',
    label: 'PVGIS (Comissão Europeia): irradiação e simulação',
    url: 'https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en',
    domain: 'SOLAR_RESOURCE',
    mode: 'INTEGRATED',
    cadence: 'Sob demanda, com cache',
    caution: 'Limite documentado de 30 chamadas por segundo por IP; sempre pelo servidor.',
    priority: 'P1',
  },
  {
    id: 'INLABS',
    label: 'DOU / INLABS: publicações oficiais em XML e PDF',
    url: 'https://inlabs.in.gov.br/acessar.php',
    domain: 'REGULATION',
    mode: 'MANUAL',
    cadence: 'Diária (dias de publicação)',
    caution: 'Exige cadastro e autorização. O XML não substitui a publicação certificada.',
    priority: 'P1',
  },
  {
    id: 'INMETRO',
    label: 'INMETRO: consulta de registros de equipamentos',
    url: 'https://registro.inmetro.gov.br/consulta/',
    domain: 'EQUIPMENT',
    mode: 'MANUAL',
    cadence: 'Por demanda',
    caution:
      'Não há API pública confirmada: consulta assistida, sem contornar CAPTCHA ou autenticação.',
    priority: 'P2',
  },
  {
    id: 'INPE_LABREN',
    label: 'INPE LABREN: Atlas Brasileiro de Energia Solar',
    url: 'https://labren.ccst.inpe.br/atlas_2017.html',
    domain: 'SOLAR_RESOURCE',
    mode: 'BLOCKED',
    cadence: 'Mensal (acompanhamento)',
    caution:
      'Acesso gratuito não é autorização de copiar para uso comercial: bloqueada até a licença ser validada.',
    priority: 'P2',
  },
];
