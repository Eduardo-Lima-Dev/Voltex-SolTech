import type {
  ChecklistItemStatus,
  ContractStatus,
  GenerationClass,
  LeadSource,
  OpportunityStage,
  ProjectStatus,
} from '../enums/index.js';
import type { HomologationRules } from '../constants/homologation.js';

/** Contratos JSON de contrato, projeto, homologação e painel (Fase 7C). Datas em ISO 8601, dinheiro em centavos. */

export interface ContractTemplateDto {
  /** `null` = modelo-base do sistema (sem revisão jurídica). */
  version: number | null;
  name: string;
  body: string;
  isDefault: boolean;
  /** `DOCX` = a empresa enviou um modelo em Word; `TEXT` = texto editado no sistema. */
  kind: 'TEXT' | 'DOCX';
  fileName: string | null;
  variables: { key: string; label: string }[];
  createdAt: string | null;
}

export interface ContractDto {
  id: string;
  opportunityId: string;
  proposalId: string;
  proposalVersion: number;
  scenarioLabel: string;
  version: number;
  status: ContractStatus;
  templateVersion: number | null;
  templateIsDefault: boolean;
  /** Texto final já com as variáveis preenchidas. */
  body: string;
  /** Variáveis que ficaram sem valor no texto (aparecem como "(não informado)"). */
  missingVariables: string[];
  valueCents: number;
  /** Arquivo gerado: PDF (modelo em texto) ou Word (modelo enviado em .docx). */
  pdfDocumentId: string | null;
  fileKind: 'PDF' | 'DOCX';
  signedDocumentId: string | null;
  signedAt: string | null;
  signedByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  projectId: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface ProjectChecklistItemDto {
  id: string;
  code: string;
  title: string;
  description: string | null;
  required: boolean;
  status: ChecklistItemStatus;
  note: string | null;
  dueAt: string | null;
  completedAt: string | null;
  completedByName: string | null;
  documentId: string | null;
  source: string;
}

export interface ProjectDeadlineSuggestionDto {
  code: 'ACCESS_OPINION' | 'INSPECTION' | 'POST_APPROVAL_EXECUTION';
  label: string;
  days: number;
  source: string;
  /** Data sugerida a partir de hoje (ou da data-base do passo), para o usuário confirmar. */
  suggestedDueAt: string;
}

export interface ProjectDto {
  id: string;
  opportunityId: string;
  projectCode: string;
  title: string;
  accountId: string;
  accountName: string;
  contractId: string;
  distributorId: string | null;
  distributorName: string | null;
  status: ProjectStatus;
  valueCents: number;
  generationClass: GenerationClass | null;
  responsibleId: string | null;
  responsibleName: string | null;
  /** Regra do checklist usada (versão e fonte), para rastrear de onde veio cada exigência. */
  rules: Pick<HomologationRules, 'ref' | 'scope' | 'source' | 'reviewedBy' | 'notes'>;
  checklist: ProjectChecklistItemDto[];
  /** Itens obrigatórios ainda pendentes (aplicáveis e não concluídos nem dispensados). */
  pendingRequired: number;
  protocolNumber: string | null;
  submittedAt: string | null;
  accessOpinionDueAt: string | null;
  accessOpinionDueSource: string | null;
  inspectionRequestedAt: string | null;
  inspectionDueAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  /** Prazos sugeridos pela regra vigente, para o passo seguinte. */
  deadlineSuggestions: ProjectDeadlineSuggestionDto[];
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummaryDto {
  id: string;
  opportunityId: string;
  projectCode: string;
  title: string;
  accountName: string;
  distributorName: string | null;
  status: ProjectStatus;
  responsibleName: string | null;
  valueCents: number;
  pendingRequired: number;
  overdue: boolean;
  createdAt: string;
}

export interface HomologationChecklistDto extends HomologationRules {
  id: string | null;
  distributorId: string | null;
  distributorName: string | null;
  createdAt: string | null;
}

export interface CommercialDashboardDto {
  from: string;
  to: string;
  leadsBySource: { source: LeadSource; count: number }[];
  totalLeads: number;
  /** Quantas oportunidades chegaram a cada etapa no período e a conversão sobre a etapa anterior do funil. */
  funnel: {
    stage: OpportunityStage;
    reached: number;
    conversionFromPrevious: number | null;
  }[];
  proposals: { generated: number; sent: number; viewed: number; accepted: number };
  won: { count: number; totalCents: number; averageTicketCents: number | null };
  /** Previsão simples: pipeline aberto por mês de fechamento esperado. Sem pesos inventados. */
  forecast: {
    openCount: number;
    openTotalCents: number;
    withoutValueCount: number;
    byMonth: { month: string; count: number; totalCents: number }[];
    withoutExpectedDateCount: number;
    /** Só quando a empresa definiu os pesos por etapa; caso contrário, `null`. */
    weightedTotalCents: number | null;
  };
}
