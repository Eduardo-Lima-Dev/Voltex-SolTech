import { z } from 'zod';

/** Catálogo de eventos de domínio (seção 37 da modelagem). */
export const DomainEvent = {
  // Plataforma
  USER_INVITED: 'UserInvited',
  USER_ACTIVATED: 'UserActivated',
  DOCUMENT_UPLOADED: 'DocumentUploaded',
  /** Uma versão de regra (qualquer chave) passou a valer: projetos que a usam podem precisar de revalidação. */
  RULE_SET_ACTIVATED: 'RuleSetActivated',
  /** Uma fonte vigiada mudou (norma, resolução, lei): o responsável técnico precisa revisar. */
  /** Uma revisão de equipamento foi aprovada (e a anterior aposentada): projetos que usam a antiga ficam desatualizados. */
  EQUIPMENT_REVISION_APPROVED: 'EquipmentRevisionApproved',
  /** Um equipamento foi aposentado. */
  EQUIPMENT_RETIRED: 'EquipmentRetired',
  EXTERNAL_SOURCE_CHANGED: 'ExternalSourceChanged',
  /** Uma proposta da caixa de atualizações foi aprovada ou descartada. */
  UPDATE_PROPOSAL_DECIDED: 'UpdateProposalDecided',
  // Comercial
  LEAD_CREATED: 'LeadCreated',
  LEAD_QUALIFIED: 'LeadQualified',
  ENERGY_BILL_REQUESTED: 'EnergyBillRequested',
  ENERGY_BILL_PARSED: 'EnergyBillParsed',
  ENERGY_BILL_VALIDATED: 'EnergyBillValidated',
  OPPORTUNITY_CREATED: 'OpportunityCreated',
  OPPORTUNITY_STAGE_CHANGED: 'OpportunityStageChanged',
  /** Local, unidade consumidora ou tipo de projeto mudaram: avaliações e cotações dependentes ficam desatualizadas. */
  OPPORTUNITY_PREMISES_CHANGED: 'OpportunityPremisesChanged',
  LEAD_SLA_BREACHED: 'LeadSlaBreached',
  // Project Guard
  PROJECT_GUARD_EVALUATED: 'ProjectGuardEvaluated',
  PROJECT_GUARD_OVERRIDDEN: 'ProjectGuardOverridden',
  PROJECT_CREATED: 'ProjectCreated',
  // Cálculos
  QUICK_CALCULATION_REQUESTED: 'QuickCalculationRequested',
  QUICK_CALCULATION_COMPLETED: 'QuickCalculationCompleted',
  ENGINEERING_REQUESTED: 'EngineeringRequested',
  ENGINEERING_VERSION_APPROVED: 'EngineeringVersionApproved',
  OFFGRID_DESIGN_REQUESTED: 'OffGridDesignRequested',
  OFFGRID_SCENARIO_APPROVED: 'OffGridScenarioApproved',
  // Venda
  QUOTE_CREATED: 'QuoteCreated',
  /** Itens, custos ou preço da cotação mudaram: a triagem e as propostas dependentes ficam desatualizadas. */
  QUOTE_CHANGED: 'QuoteChanged',
  MARGIN_THRESHOLD_VIOLATED: 'MarginThresholdViolated',
  MARGIN_APPROVAL_REQUESTED: 'MarginApprovalRequested',
  MARGIN_APPROVAL_DECIDED: 'MarginApprovalDecided',
  PROPOSAL_GENERATED: 'ProposalGenerated',
  PROPOSAL_SENT: 'ProposalSent',
  PROPOSAL_VIEWED: 'ProposalViewed',
  PROPOSAL_ACCEPTED: 'ProposalAccepted',
  CONTRACT_GENERATED: 'ContractGenerated',
  PRIVACY_ERASURE_COMPLETED: 'PrivacyErasureCompleted',
  CONTRACT_SIGNED: 'ContractSigned',
  DEAL_WON: 'DealWon',
  // Execução
  HOMOLOGATION_STARTED: 'HomologationStarted',
  HOMOLOGATION_PENDING: 'HomologationPending',
  HOMOLOGATION_APPROVED: 'HomologationApproved',
  MATERIALS_READY: 'MaterialsReady',
  INSTALLATION_SCHEDULED: 'InstallationScheduled',
  INSTALLATION_COMPLETED: 'InstallationCompleted',
  COMMISSIONING_COMPLETED: 'CommissioningCompleted',
  CUSTOMER_ACCEPTED: 'CustomerAccepted',
  // Lifecycle
  PLANT_ACTIVATED: 'PlantActivated',
  MONITORING_ALERT_RECEIVED: 'MonitoringAlertReceived',
  MAINTENANCE_TICKET_CREATED: 'MaintenanceTicketCreated',
  WARRANTY_EXPIRING: 'WarrantyExpiring',
  OM_RENEWAL_DUE: 'OMRenewalDue',
  UPSELL_OPPORTUNITY_DETECTED: 'UpsellOpportunityDetected',
} as const;
export type DomainEventType = (typeof DomainEvent)[keyof typeof DomainEvent];

export const DOMAIN_EVENT_TYPES = Object.values(DomainEvent) as [
  DomainEventType,
  ...DomainEventType[],
];

/** Envelope comum de todos os eventos. O payload é específico de cada evento. */
export const domainEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.enum(DOMAIN_EVENT_TYPES),
  occurredAt: z.coerce.date(),
  tenantId: z.string(),
  actorId: z.string().nullable(),
  /** Project ID global (Digital Thread), quando já existir. */
  projectCode: z.string().nullable().default(null),
  schemaVersion: z.number().int().min(1).default(1),
  payload: z.record(z.string(), z.unknown()),
});
export type DomainEventEnvelope = z.infer<typeof domainEventEnvelopeSchema>;
