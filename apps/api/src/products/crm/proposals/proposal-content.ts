import type { PublicProposalDto, PublicProposalScenarioDto } from '@voltex/shared';

export const PROPOSAL_DISCLAIMER =
  'Estimativa preliminar de pré-viabilidade, baseada nas premissas informadas e no consumo do cliente. ' +
  'Não substitui o projeto executivo, a vistoria técnica nem a análise e a aprovação da distribuidora de energia. ' +
  'A geração real varia com o clima, a instalação e o consumo.';

export interface ProposalScenarioContent extends PublicProposalScenarioDto {
  quoteId: string;
  quoteVersion: number;
  calculationSessionId: string;
  ruleSetRef: string;
  algorithmVersion: string;
}

/**
 * Conteúdo congelado da proposta (`ProposalSnapshot`). Parte é interna (triagem, regra, versões) e NUNCA vai ao
 * cliente: custos, margem e comissão nem entram aqui.
 */
export interface ProposalContent {
  version: number;
  tenantName: string;
  brand: { primaryColor: string | null; logoDocumentId: string | null };
  title: string;
  customerName: string;
  projectCode: string;
  scenarios: ProposalScenarioContent[];
  conditions: { paymentTerms: string | null; notes: string | null; validityDays: number };
  validUntil: string;
  guard: { evaluationId: string; version: number; status: string; overridden: boolean } | null;
  billSnapshotId: string | null;
  generatedAt: string;
  disclaimer: string;
}

/** O que o cliente vê: o conteúdo sem os campos internos. */
export function toPublicScenario(s: ProposalScenarioContent): PublicProposalScenarioDto {
  return {
    label: s.label,
    installedPowerKwp: s.installedPowerKwp,
    moduleCount: s.moduleCount,
    estimatedAreaM2: s.estimatedAreaM2,
    annualGenerationKwh: s.annualGenerationKwh,
    monthlyGenerationKwh: s.monthlyGenerationKwh,
    averageMonthlyConsumptionKwh: s.averageMonthlyConsumptionKwh,
    compensationRatio: s.compensationRatio,
    priceCents: s.priceCents,
    firstYearSavingsCents: s.firstYearSavingsCents,
    accumulatedSavingsCents: s.accumulatedSavingsCents,
    simplePaybackYears: s.simplePaybackYears,
    horizonYears: s.horizonYears,
    cashFlow: s.cashFlow,
  };
}

export function toPublicProposal(
  content: ProposalContent,
  state: {
    status: PublicProposalDto['status'];
    expired: boolean;
    acceptedAt: Date | null;
    acceptedByName: string | null;
  },
): PublicProposalDto {
  return {
    status: state.status,
    version: content.version,
    tenantName: content.tenantName,
    brand: {
      primaryColor: content.brand.primaryColor,
      hasLogo: content.brand.logoDocumentId !== null,
    },
    title: content.title,
    customerName: content.customerName,
    projectCode: content.projectCode,
    scenarios: content.scenarios.map(toPublicScenario),
    conditions: { paymentTerms: content.conditions.paymentTerms, notes: content.conditions.notes },
    validUntil: content.validUntil,
    expired: state.expired,
    acceptedAt: state.acceptedAt?.toISOString() ?? null,
    acceptedByName: state.acceptedByName,
    disclaimer: content.disclaimer,
  };
}
