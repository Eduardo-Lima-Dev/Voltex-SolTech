import type { EngineeringDesign } from '../schemas/engineering.js';
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

export interface EngineeringResults {
  /** Versões dos algoritmos que produziram estes resultados. */
  algorithmVersions: Record<string, string>;
  layout: SurfaceLayoutResult[];
  shading: SurfaceShadingResult[];
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
  /** Módulos do catálogo usados no desenho (ficha para o cálculo no navegador). */
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
