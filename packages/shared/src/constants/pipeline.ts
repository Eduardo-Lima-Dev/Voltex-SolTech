import { OpportunityStage } from '../enums/index.js';

export interface PipelineStageDefinition {
  key: OpportunityStage;
  name: string;
  order: number;
  /** Etapas terminais encerram a oportunidade. */
  terminal: boolean;
}

/** Pipeline padrão sugerido (seção 8.5). Cada tenant pode personalizar nomes e ordem. */
export const DEFAULT_PIPELINE_STAGES: readonly PipelineStageDefinition[] = [
  { key: OpportunityStage.NEW_LEAD, name: 'Novo lead', order: 1, terminal: false },
  { key: OpportunityStage.FIRST_CONTACT, name: 'Primeiro contato', order: 2, terminal: false },
  { key: OpportunityStage.QUALIFICATION, name: 'Qualificação', order: 3, terminal: false },
  { key: OpportunityStage.BILL_PENDING, name: 'Fatura pendente', order: 4, terminal: false },
  { key: OpportunityStage.PRE_SIZING, name: 'Pré-dimensionamento', order: 5, terminal: false },
  {
    key: OpportunityStage.TECHNICAL_VISIT_REQUIRED,
    name: 'Visita técnica necessária',
    order: 6,
    terminal: false,
  },
  {
    key: OpportunityStage.ENGINEERING_REQUIRED,
    name: 'Engenharia necessária',
    order: 7,
    terminal: false,
  },
  { key: OpportunityStage.QUOTING, name: 'Cotação', order: 8, terminal: false },
  { key: OpportunityStage.PROPOSAL_READY, name: 'Proposta pronta', order: 9, terminal: false },
  { key: OpportunityStage.PROPOSAL_SENT, name: 'Proposta enviada', order: 10, terminal: false },
  { key: OpportunityStage.NEGOTIATION, name: 'Negociação', order: 11, terminal: false },
  {
    key: OpportunityStage.CREDIT_FINANCING,
    name: 'Crédito/financiamento',
    order: 12,
    terminal: false,
  },
  { key: OpportunityStage.CONTRACT, name: 'Contrato', order: 13, terminal: false },
  { key: OpportunityStage.WON, name: 'Ganho', order: 14, terminal: true },
  { key: OpportunityStage.LOST, name: 'Perdido', order: 15, terminal: true },
];
