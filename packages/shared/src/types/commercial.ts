import type {
  ApprovalStatus,
  GuardCheckSource,
  MarginStatus,
  ProjectType,
  ProposalStatus,
  TrafficLight,
} from '../enums/index.js';

/** Contratos JSON da triagem, margem e proposta (Fase 7B). Datas em ISO 8601, dinheiro em centavos. */

export interface GuardCheckDto {
  code: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  message: string;
  source: GuardCheckSource;
}

export interface GuardOverrideDto {
  id: string;
  justification: string;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: string;
}

export interface GuardEvaluationDto {
  id: string;
  opportunityId: string;
  /** Contador por oportunidade: cada reavaliação gera a próxima versão; as anteriores permanecem. */
  version: number;
  status: TrafficLight;
  checks: GuardCheckDto[];
  missingFields: string[];
  needsHumanReview: boolean;
  needsEngineeringReview: boolean;
  algorithmVersion: string;
  ruleSetRef: string;
  /** O que foi avaliado: permite saber exatamente em cima de quê a triagem foi feita. */
  inputs: { billSnapshotId: string | null; calculationSessionId: string | null };
  /** Premissas ou cotação mudaram depois desta avaliação (invalidada, ou detectada ao consultar). */
  stale: boolean;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  override: GuardOverrideDto | null;
  /** Verde, ou amarelo/vermelho liberado por quem tem permissão. */
  releasedForQuote: boolean;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface GuardOverviewDto {
  /** Avaliação vigente (a mais recente); `null` se nunca foi avaliada. */
  current: GuardEvaluationDto | null;
  history: GuardEvaluationDto[];
}

export interface MarginPolicyDto {
  id: string;
  name: string;
  minMarginRate: number;
  projectType: ProjectType | null;
  teamId: string | null;
  active: boolean;
  createdAt: string;
}

export type QuoteApprovalStatus = 'NONE' | ApprovalStatus;

export interface QuoteDto {
  id: string;
  opportunityId: string;
  version: number;
  title: string | null;
  calculationSessionId: string | null;
  /** Snapshot técnico aprovado de onde os materiais foram importados, se houver. */
  engineeringSnapshotId: string | null;
  items: {
    category: string;
    description: string;
    quantity: number;
    unitCostCents: number;
  }[];
  costs: {
    freightCents: number;
    installationCents: number;
    travelCents: number;
    otherCostsCents: number;
    commissionRate: number;
    taxRate: number;
    financingRate: number;
    contingencyRate: number;
  };
  priceCents: number;
  margin: {
    materialsCents: number;
    directCostsCents: number;
    contingencyCents: number;
    commissionCents: number;
    taxesCents: number;
    financingCents: number;
    totalCostsCents: number;
    contributionMarginCents: number;
    marginRate: number;
    markupRate: number | null;
  };
  marginStatus: MarginStatus;
  minMarginRate: number | null;
  policyId: string | null;
  /** Menor preço que atinge a margem mínima (ajuda a corrigir uma cotação abaixo da política). */
  minPriceCents: number | null;
  approvalStatus: QuoteApprovalStatus;
  /** Margem dentro da política, ou abaixo mas aprovada: pode entrar em uma proposta. */
  releasedForProposal: boolean;
  /** Já foi usada em uma proposta: não se edita mais (crie uma nova versão). */
  locked: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDto {
  id: string;
  type: 'MARGIN';
  status: ApprovalStatus;
  quoteId: string;
  quoteVersion: number;
  opportunityId: string;
  opportunityTitle: string;
  projectCode: string;
  accountName: string;
  marginRate: number;
  minMarginRate: number;
  priceCents: number;
  justification: string;
  requestedById: string | null;
  requestedByName: string | null;
  decisionJustification: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ProposalScenarioDto {
  label: string;
  quoteId: string;
  quoteVersion: number;
  installedPowerKwp: number;
  priceCents: number;
}

export interface ProposalDto {
  id: string;
  opportunityId: string;
  version: number;
  status: ProposalStatus;
  scenarios: ProposalScenarioDto[];
  validUntil: string;
  /** Vencida: o link público deixa de aceitar. */
  expired: boolean;
  sentAt: string | null;
  firstViewedAt: string | null;
  viewCount: number;
  acceptedAt: string | null;
  acceptedByName: string | null;
  snapshotId: string;
  pdfDocumentId: string | null;
  /** Só vem na criação/envio: o link não é guardado em claro. */
  publicUrl?: string;
  createdById: string | null;
  createdAt: string;
}

export interface PublicProposalScenarioDto {
  label: string;
  installedPowerKwp: number;
  moduleCount: number;
  estimatedAreaM2: number;
  annualGenerationKwh: number;
  monthlyGenerationKwh: number[];
  averageMonthlyConsumptionKwh: number;
  compensationRatio: number;
  priceCents: number;
  firstYearSavingsCents: number;
  accumulatedSavingsCents: number;
  simplePaybackYears: number | null;
  horizonYears: number;
  cashFlow: { year: number; cumulativeCents: number }[];
}

/** O que o cliente vê: nunca custos, margem, comissão nem a triagem interna. */
export interface PublicProposalDto {
  status: ProposalStatus;
  version: number;
  tenantName: string;
  brand: { primaryColor: string | null; hasLogo: boolean };
  title: string;
  customerName: string;
  projectCode: string;
  scenarios: PublicProposalScenarioDto[];
  conditions: { paymentTerms: string | null; notes: string | null };
  validUntil: string;
  expired: boolean;
  acceptedAt: string | null;
  acceptedByName: string | null;
  disclaimer: string;
}
