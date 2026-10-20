import type { SurveyData } from '../schemas/engineering-management.js';
import type { EngineeringRequestListItemDto } from './engineering.js';

/** Item da linha do tempo do pedido ou do projeto. */
export interface EngineeringEventDto {
  id: string;
  type:
    | 'COMMENT'
    | 'STATUS'
    | 'ASSIGNED'
    | 'INFO_REQUEST'
    | 'INFO_ANSWER'
    | 'PRIORITY'
    | 'SURVEY'
    | 'DOCUMENT'
    | 'PROJECT';
  text: string | null;
  data: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

/** Tudo que a engenharia precisa saber da oportunidade sem sair do pedido. */
export interface EngineeringRequestContextDto {
  account: { id: string; name: string } | null;
  site: {
    id: string;
    name: string;
    city: string;
    state: string;
    latitude: number | null;
    longitude: number | null;
    intake: Record<string, unknown>;
  } | null;
  consumerUnit: {
    id: string;
    number: string;
    customerGroup: string;
    phaseSystem: string | null;
    distributorName: string | null;
  } | null;
  /** Último cálculo preliminar do CRM. */
  calculation: {
    id: string;
    createdAt: string;
    systemKwp: number | null;
    generationKwhYear: number | null;
    alerts: { severity: string; message: string }[];
  } | null;
  /** Histórico de consumo da fatura validada (kWh por mês). */
  consumptionHistory: { month: string; kwh: number }[];
  seller: { id: string; name: string } | null;
}

export interface EngineeringRequestDetailDto extends EngineeringRequestListItemDto {
  context: EngineeringRequestContextDto;
  events: EngineeringEventDto[];
  /** Estados para os quais o pedido pode ir agora. */
  allowedTransitions: EngineeringRequestListItemDto['status'][];
}

export interface EngineeringSurveyDto {
  status: 'DRAFT' | 'COMPLETED';
  data: SurveyData;
  /** O que falta para concluir o levantamento. */
  missing: string[];
  completedAt: string | null;
  updatedAt: string | null;
}

export interface LoadAnalysisDto {
  /** Consumo mensal da fatura (kWh). */
  monthly: { month: string; kwh: number }[];
  averageKwh: number | null;
  maxKwh: number | null;
  /** Cargas levantadas na visita (kWh/mês) e a soma. */
  loads: { id: string; name: string; monthlyKwh: number }[];
  loadsMonthlyKwh: number;
  /** Rendimento anual por kWp, vindo do cálculo preliminar do CRM, quando houver. */
  annualYieldKwhPerKwp: number | null;
  /** Potência (kWp) para cobrir o consumo médio com esse rendimento; sugestão, não regra. */
  suggestedKwp: number | null;
  notes: string[];
}

export interface ProjectDocumentItemDto {
  id: string;
  code: string;
  title: string;
  description: string | null;
  required: boolean;
  position: number;
  status: 'PENDING' | 'READY' | 'NOT_APPLICABLE';
  documentId: string | null;
  note: string | null;
  source: string;
  /** O que o próprio sistema já tem para este item (ex.: unifilar gerado na versão aprovada). */
  suggestion: string | null;
}

export interface EngineeringDashboardDto {
  byStatus: Record<string, number>;
  open: number;
  overdue: number;
  unassigned: number;
  urgent: number;
  /** Tempo médio, em dias, entre abrir e encerrar os pedidos concluídos. */
  avgResolutionDays: number | null;
  byAssignee: { id: string | null; name: string; open: number }[];
  projects: { inProgress: number; approved: number; cancelled: number };
  /** Pedidos abertos com prazo mais próximo. */
  upcoming: {
    id: string;
    projectCode: string;
    customerName: string | null;
    dueAt: string;
    priority: string;
  }[];
}
