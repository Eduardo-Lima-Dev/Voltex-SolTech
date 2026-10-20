import type { CompatibilityStatus } from '../enums/index.js';
import type { EngineeringDesign, InverterEntry } from '../schemas/engineering.js';
import type { SpecIssue } from './equipment.js';

/** Contratos JSON do Solar Engine Studio (datas em ISO 8601). */

export type EngineeringVersionStatus =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
export type EngineeringProjectStatus = 'IN_PROGRESS' | 'APPROVED' | 'CANCELLED';

export interface EngineeringRequestListItemDto {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  projectCode: string;
  customerName: string | null;
  calculationSessionId: string | null;
  reason: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  assigneeId: string | null;
  assigneeName: string | null;
  projectId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface EngineeringProjectDto {
  id: string;
  code: string;
  name: string;
  status: EngineeringProjectStatus;
  opportunityId: string | null;
  requestId: string | null;
  responsibleId: string | null;
  responsibleName: string | null;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  latestVersionStatus: EngineeringVersionStatus | null;
  approvedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Layout calculado de uma superfície (retângulos em metros, na vista da própria superfície). */
export interface SurfaceLayoutResult {
  surfaceId: string;
  moduleId: string | null;
  /** Módulos que cabem e módulos usados (o menor entre o que cabe e o limite informado). */
  fitCount: number;
  moduleCount: number;
  rows: number;
  columns: number;
  usableWidthM: number;
  usableDepthM: number;
  /** Espaçamento entre fileiras (m) usado e o mínimo calculado (FLAT_RACK). */
  rowSpacingM: number | null;
  minRowSpacingM: number | null;
  powerKwp: number | null;
  moduleAreaM2: number | null;
  /** Retângulos dos módulos usados (x, y a partir do canto superior esquerdo da área útil, em m). */
  rects: { x: number; y: number; w: number; h: number }[];
  warnings: string[];
}

export interface SunPathPoint {
  azimuthDegrees: number;
  elevationDegrees: number;
  shaded: boolean;
}

export interface SurfaceShadingResult {
  surfaceId: string;
  /** Perda mensal estimada (%, jan a dez) e anual ponderada pela radiação direta. */
  monthlyLossPct: number[];
  annualLossPct: number;
  /** `true` quando a perda veio de valor informado à mão (com fonte), não do cálculo. */
  overridden: boolean;
  overrideSource: string | null;
  /** Trajetórias do sol (uma por mês, no dia 15) para a carta solar. */
  sunPaths: { month: number; points: SunPathPoint[] }[];
  /** Silhueta que bloqueia o sol: horizonte e obstáculos (azimute central, meia-largura, altura do topo). */
  obstacles: {
    name: string;
    azimuthDegrees: number;
    halfWidthDegrees: number;
    topElevationDegrees: number;
  }[];
  warnings: string[];
}

export interface CompatibilityCheck {
  /** Código estável (ex.: `VOC_COLD_EXCEEDS_MAX`). */
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  /** `PASS` passou; `FAIL` falhou; `PENDING` não pôde ser verificada (falta dado ou regra). */
  outcome: 'PASS' | 'FAIL' | 'PENDING';
  message: string;
  /** Fórmula e fonte, para a explicação na tela. */
  formula: string;
  source: string;
  value: number | null;
  limit: number | null;
  unit: string;
  /** Onde se aplica (id do MPPT ou da string). */
  scope: string;
}

export interface InverterCompatibility {
  entryId: string;
  inverterId: string;
  status: CompatibilityStatus;
  checks: CompatibilityCheck[];
  /** Grandezas derivadas para mostrar na tela. */
  metrics: {
    dcPowerKwp: number;
    acPowerKw: number;
    dcAcRatio: number | null;
    modulesConnected: number;
    mpptUsed: number;
    mpptAvailable: number;
  };
}

export interface CompatibilityResult {
  status: CompatibilityStatus;
  inverters: InverterCompatibility[];
  /** Módulos ligados × módulos do layout, por superfície. */
  allocation: CompatibilityCheck[];
  /** O que impede concluir: dado do projeto ou regra `engine.design` que falta. */
  pending: { code: string; kind: 'DATA' | 'RULE'; message: string }[];
  /** Grandezas por módulo usado: Voc frio, Vmpp quente/frio. */
  thermal: {
    moduleId: string;
    vocColdV: number | null;
    vmppColdV: number | null;
    vmppHotV: number | null;
    cellHotC: number | null;
    betaVmppSource: 'BETA_VMPP' | 'BETA_VOC_ASSUMED';
    noctSource: 'DATASHEET' | 'KT_DEFAULT';
  }[];
  algorithmVersion: string;
}

export type ProtectionOutcome = 'OK' | 'NONE_AVAILABLE' | 'PENDING' | 'OVERRIDE_FAILS';

/** Uma proteção exigida pelo projeto, com a escolha do catálogo (sugerida ou manual) e a justificativa. */
export interface ProtectionItem {
  id: string;
  role: 'STRING_FUSE' | 'DC_DISCONNECTOR' | 'DC_SURGE' | 'AC_BREAKER' | 'RCD';
  inverterEntryId: string;
  mpptIndex: number | null;
  quantity: number;
  /** Exigência em texto (ex.: "In de 20,98 A a 25 A; tensão ≥ 628 V"). */
  requirement: string;
  currentMinA: number | null;
  currentMaxA: number | null;
  voltageMinV: number | null;
  sensitivityMaxMa: number | null;
  chosen: {
    equipmentId: string;
    label: string;
    ratedCurrentA: number | null;
    ratedVoltageV: number | null;
    sensitivityMa: number | null;
    costCents: number | null;
  } | null;
  /** `true` quando a pessoa escolheu o item (e não o sistema). */
  manual: boolean;
  outcome: ProtectionOutcome;
  justification: string;
  source: string;
}

export interface ProtectionResult {
  status: CompatibilityStatus;
  items: ProtectionItem[];
  pending: { code: string; kind: 'DATA' | 'RULE'; message: string }[];
  algorithmVersion: string;
}

export interface CableRunResult {
  runId: string;
  label: string;
  kind: 'DC_STRING' | 'DC_MAIN' | 'AC';
  lengthM: number;
  count: number;
  /** Corrente de operação (A) e corrente de projeto (com o fator da regra), quando conhecida. */
  currentA: number | null;
  designCurrentA: number | null;
  /** Tensão de referência para a queda percentual (V). */
  referenceVoltageV: number | null;
  resistivityOhmMm2PerM: number | null;
  /** Seção mínima só pela queda de tensão (mm²) e seção usada na verificação. */
  minSectionByDropMm2: number | null;
  sectionMm2: number | null;
  voltageDropV: number | null;
  voltageDropPct: number | null;
  limitPct: number | null;
  ampacityA: number | null;
  chosen: {
    equipmentId: string;
    label: string;
    crossSectionMm2: number;
    costCents: number | null;
  } | null;
  manual: boolean;
  checks: CompatibilityCheck[];
  status: CompatibilityStatus;
}

export interface CableResult {
  status: CompatibilityStatus;
  runs: CableRunResult[];
  pending: { code: string; kind: 'DATA' | 'RULE'; message: string }[];
  algorithmVersion: string;
}

export interface BomLine {
  category: 'MODULE' | 'INVERTER' | 'PROTECTION' | 'CABLE';
  equipmentId: string | null;
  description: string;
  quantity: number;
  unit: 'un' | 'm';
  unitCostCents: number | null;
  totalCents: number | null;
  priceSource: 'PRICE_LIST' | 'REFERENCE' | 'NONE';
  note: string | null;
}

export interface BillOfMaterials {
  lines: BomLine[];
  /** Soma das linhas com preço; nulo se nenhuma linha tem preço. */
  totalCents: number | null;
  /** Linhas sem preço (bloqueiam a cotação desse item). */
  unpricedCount: number;
  algorithmVersion: string;
}

export interface EngineeringResults {
  /** Versões dos algoritmos que produziram estes resultados. */
  algorithmVersions: Record<string, string>;
  layout: SurfaceLayoutResult[];
  shading: SurfaceShadingResult[];
  /** Compatibilidade módulo × inversor × strings (9E). */
  compatibility: CompatibilityResult;
  /** Proteções exigidas e escolhidas (9F). */
  protection: ProtectionResult;
  /** Cabos: queda de tensão, capacidade de condução e seção (9F). */
  cables: CableResult;
  /** Lista de materiais com preço vigente (9F). */
  bom: BillOfMaterials;
  totals: { moduleCount: number; powerKwp: number | null; moduleAreaM2: number | null };
  /** Pendências que impedem concluir (módulo não escolhido, local sem coordenadas...). */
  pending: { code: string; message: string }[];
}

export interface EngineeringVersionDto {
  id: string;
  projectId: string;
  number: number;
  status: EngineeringVersionStatus;
  design: EngineeringDesign;
  results: EngineeringResults | null;
  fingerprint: string | null;
  stale: boolean;
  staleReasons: string[];
  ruleRefs: string[];
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngineeringProjectDetailDto extends EngineeringProjectDto {
  versions: Pick<
    EngineeringVersionDto,
    'id' | 'number' | 'status' | 'stale' | 'createdAt' | 'decidedAt'
  >[];
  /** Quem acompanha o projeto no CRM (dados da oportunidade, quando houver). */
  opportunity: {
    id: string;
    title: string;
    projectCode: string;
    customerName: string | null;
  } | null;
  /** Pré-cálculo do CRM que originou o pedido (para comparar), quando houver. */
  calculation: {
    id: string;
    generationKwhYear: number | null;
    systemKwp: number | null;
    createdAt: string;
  } | null;
}

export interface EngineeringVersionDetailDto extends EngineeringVersionDto {
  project: EngineeringProjectDto;
  /** Regras em vigor que o cálculo usa (o navegador recalcula com os mesmos parâmetros). */
  rules: {
    engineDesign: { ref: string | null; parameters: Record<string, number> };
    engineCables: {
      ref: string | null;
      parameters: Record<string, number>;
      /** Tabelas da regra (ex.: `ampacity`). */
      tables: Record<string, Record<string, number | string | null>[]>;
    };
  };
  /** Equipamentos do catálogo usados no desenho (ficha para o cálculo no navegador). */
  equipment: {
    id: string;
    kind: string;
    manufacturer: string;
    model: string;
    status: string;
    spec: Record<string, unknown>;
    issues: SpecIssue[];
  }[];
}

export interface SuggestedConfiguration {
  moduleId: string;
  inverterId: string;
  inverterCount: number;
  modulesInSeries: number;
  totalStrings: number;
  moduleCount: number;
  powerKwp: number;
  dcAcRatio: number | null;
  /** Folga entre o Voc frio e a tensão máxima do inversor (%). */
  vocMarginPct: number;
  /** Custo estimado em centavos (módulos + inversores), ou nulo se algum item não tem preço. */
  costCents: number | null;
  unpriced: string[];
  /** Entradas prontas para o desenho. */
  entries: InverterEntry[];
  status: CompatibilityStatus;
  warnings: string[];
}

export interface SuggestConfigurationsResult {
  configurations: SuggestedConfiguration[];
  /** Por que combinações foram descartadas (para a explicação quando não há nenhuma). */
  discarded: { moduleId: string; inverterId: string; reason: string }[];
  pending: CompatibilityResult['pending'];
}
