import { OpportunityStage } from '../enums/index.js';

const S = OpportunityStage;

/**
 * Máquina de estados da oportunidade (docs/03-diagramas/estados/oportunidade.md).
 * Avanço só para a etapa seguinte do fluxo (sem pular), recuo para refazer um passo e "Perdido" de qualquer etapa
 * aberta. "Ganho" só nasce do contrato assinado; "Perdido" pode ser reaberto.
 */
export const OPPORTUNITY_TRANSITIONS: Record<OpportunityStage, readonly OpportunityStage[]> = {
  [S.NEW_LEAD]: [S.FIRST_CONTACT, S.QUALIFICATION, S.LOST],
  [S.FIRST_CONTACT]: [S.QUALIFICATION, S.LOST],
  [S.QUALIFICATION]: [S.BILL_PENDING, S.PRE_SIZING, S.FIRST_CONTACT, S.LOST],
  [S.BILL_PENDING]: [S.PRE_SIZING, S.QUALIFICATION, S.LOST],
  [S.PRE_SIZING]: [
    S.TECHNICAL_VISIT_REQUIRED,
    S.ENGINEERING_REQUIRED,
    S.QUOTING,
    S.BILL_PENDING,
    S.LOST,
  ],
  [S.TECHNICAL_VISIT_REQUIRED]: [S.PRE_SIZING, S.ENGINEERING_REQUIRED, S.QUOTING, S.LOST],
  [S.ENGINEERING_REQUIRED]: [S.QUOTING, S.PRE_SIZING, S.LOST],
  [S.QUOTING]: [S.PROPOSAL_READY, S.PRE_SIZING, S.ENGINEERING_REQUIRED, S.LOST],
  [S.PROPOSAL_READY]: [S.PROPOSAL_SENT, S.QUOTING, S.LOST],
  [S.PROPOSAL_SENT]: [S.NEGOTIATION, S.CREDIT_FINANCING, S.CONTRACT, S.QUOTING, S.LOST],
  [S.NEGOTIATION]: [S.CREDIT_FINANCING, S.CONTRACT, S.QUOTING, S.PROPOSAL_READY, S.LOST],
  [S.CREDIT_FINANCING]: [S.CONTRACT, S.NEGOTIATION, S.LOST],
  [S.CONTRACT]: [S.WON, S.CREDIT_FINANCING, S.NEGOTIATION, S.LOST],
  [S.WON]: [],
  [S.LOST]: [S.FIRST_CONTACT, S.QUALIFICATION],
};

export const canTransition = (from: OpportunityStage, to: OpportunityStage): boolean =>
  OPPORTUNITY_TRANSITIONS[from].includes(to);

/** Etapas em que a oportunidade ainda está aberta. */
export const OPEN_STAGES: readonly OpportunityStage[] = Object.values(S).filter(
  (stage) => stage !== S.WON && stage !== S.LOST,
);
