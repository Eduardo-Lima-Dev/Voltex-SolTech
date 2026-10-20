/**
 * Enums de domínio. Usamos objetos `as const` + tipo derivado (em vez de `enum` do TS)
 * para que funcionem igual em runtime, em tipos e em `z.enum(...)`.
 */

export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  SALES_MANAGER: 'SALES_MANAGER',
  SDR: 'SDR',
  SALESPERSON: 'SALESPERSON',
  ENGINEERING: 'ENGINEERING',
  TECHNICAL_LEAD: 'TECHNICAL_LEAD',
  OPERATIONS: 'OPERATIONS',
  INSTALLER: 'INSTALLER',
  FINANCE: 'FINANCE',
  OM: 'OM',
  PARTNER: 'PARTNER',
  CUSTOMER: 'CUSTOMER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const TenantStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

/** Classe da geração distribuída por potência instalada (EnergIF EF-M06; limites parametrizados no Rules Engine). */
export const GenerationClass = {
  MICRO: 'MICRO',
  MINI: 'MINI',
  UTILITY: 'UTILITY',
} as const;
export type GenerationClass = (typeof GenerationClass)[keyof typeof GenerationClass];

export const Product = {
  CRM: 'CRM',
  CALCULATOR: 'CALCULATOR',
  ENGINE: 'ENGINE',
  OFFGRID: 'OFFGRID',
} as const;
export type Product = (typeof Product)[keyof typeof Product];

/** Etapas do pipeline padrão (seção 8.5 da modelagem). O pipeline é personalizável por tenant. */
export const OpportunityStage = {
  NEW_LEAD: 'NEW_LEAD',
  FIRST_CONTACT: 'FIRST_CONTACT',
  QUALIFICATION: 'QUALIFICATION',
  BILL_PENDING: 'BILL_PENDING',
  PRE_SIZING: 'PRE_SIZING',
  TECHNICAL_VISIT_REQUIRED: 'TECHNICAL_VISIT_REQUIRED',
  ENGINEERING_REQUIRED: 'ENGINEERING_REQUIRED',
  QUOTING: 'QUOTING',
  PROPOSAL_READY: 'PROPOSAL_READY',
  PROPOSAL_SENT: 'PROPOSAL_SENT',
  NEGOTIATION: 'NEGOTIATION',
  CREDIT_FINANCING: 'CREDIT_FINANCING',
  CONTRACT: 'CONTRACT',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type OpportunityStage = (typeof OpportunityStage)[keyof typeof OpportunityStage];

export const LeadSource = {
  FORM: 'FORM',
  LANDING_PAGE: 'LANDING_PAGE',
  WHATSAPP: 'WHATSAPP',
  API: 'API',
  REFERRAL: 'REFERRAL',
  CSV_IMPORT: 'CSV_IMPORT',
  MARKETPLACE: 'MARKETPLACE',
  CAMPAIGN: 'CAMPAIGN',
  MANUAL: 'MANUAL',
  PARTNER_PORTAL: 'PARTNER_PORTAL',
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const CustomerSegment = {
  RESIDENTIAL: 'RESIDENTIAL',
  RURAL: 'RURAL',
  COMMERCIAL: 'COMMERCIAL',
  INDUSTRIAL: 'INDUSTRIAL',
} as const;
export type CustomerSegment = (typeof CustomerSegment)[keyof typeof CustomerSegment];

/** Grupo tarifário: A (média/alta tensão, com demanda) ou B (baixa tensão). */
export const CustomerGroup = {
  A: 'A',
  B: 'B',
} as const;
export type CustomerGroup = (typeof CustomerGroup)[keyof typeof CustomerGroup];

export const PhaseSystem = {
  SINGLE_PHASE: 'SINGLE_PHASE',
  TWO_PHASE: 'TWO_PHASE',
  THREE_PHASE: 'THREE_PHASE',
} as const;
export type PhaseSystem = (typeof PhaseSystem)[keyof typeof PhaseSystem];

export const ProjectType = {
  ON_GRID: 'ON_GRID',
  HYBRID: 'HYBRID',
  OFF_GRID: 'OFF_GRID',
} as const;
export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];

/** Semáforo de pré-viabilidade do Solar Calculator (seção 14). */
export const TrafficLight = {
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED',
} as const;
export type TrafficLight = (typeof TrafficLight)[keyof typeof TrafficLight];

export const AlertSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  BLOCKING: 'BLOCKING',
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

/** Resultado do Compatibility Engine (seção 17.7). */
export const CompatibilityStatus = {
  VALID: 'VALID',
  VALID_WITH_WARNINGS: 'VALID_WITH_WARNINGS',
  INVALID: 'INVALID',
} as const;
export type CompatibilityStatus = (typeof CompatibilityStatus)[keyof typeof CompatibilityStatus];

export const SnapshotType = {
  QUICK_CALCULATION: 'QUICK_CALCULATION',
  ENGINEERING: 'ENGINEERING',
  OFF_GRID: 'OFF_GRID',
  QUOTE: 'QUOTE',
  PROPOSAL: 'PROPOSAL',
} as const;
export type SnapshotType = (typeof SnapshotType)[keyof typeof SnapshotType];

export const EnergyBillStatus = {
  UPLOADED: 'UPLOADED',
  PARSED: 'PARSED',
  VALIDATED: 'VALIDATED',
  REJECTED: 'REJECTED',
} as const;
export type EnergyBillStatus = (typeof EnergyBillStatus)[keyof typeof EnergyBillStatus];

export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

/** Etapas da instalação (seção 8.15). */
export const InstallationStatus = {
  AWAITING_ENGINEERING: 'AWAITING_ENGINEERING',
  AWAITING_MATERIAL: 'AWAITING_MATERIAL',
  MATERIAL_SEPARATED: 'MATERIAL_SEPARATED',
  SCHEDULING: 'SCHEDULING',
  CREW_ASSIGNED: 'CREW_ASSIGNED',
  IN_INSTALLATION: 'IN_INSTALLATION',
  FIELD_ISSUE: 'FIELD_ISSUE',
  INSTALLATION_DONE: 'INSTALLATION_DONE',
  COMMISSIONING: 'COMMISSIONING',
  CUSTOMER_ACCEPTANCE: 'CUSTOMER_ACCEPTANCE',
  FINISHED: 'FINISHED',
} as const;
export type InstallationStatus = (typeof InstallationStatus)[keyof typeof InstallationStatus];

// ---- CRM (Fase 7A) ----

export const LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  QUALIFIED: 'QUALIFIED',
  DISQUALIFIED: 'DISQUALIFIED',
  CONVERTED: 'CONVERTED',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const AccountType = {
  PERSON: 'PERSON',
  COMPANY: 'COMPANY',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

/** Situação da oportunidade, independente da etapa do pipeline. */
export const OpportunityStatus = {
  OPEN: 'OPEN',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type OpportunityStatus = (typeof OpportunityStatus)[keyof typeof OpportunityStatus];

export const TaskStatus = {
  OPEN: 'OPEN',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** Sombreamento no local (EnergIF EF-M05): informado no intake técnico. */
export const ShadingLevel = {
  NONE: 'NONE',
  LOW: 'LOW',
  RELEVANT: 'RELEVANT',
} as const;
export type ShadingLevel = (typeof ShadingLevel)[keyof typeof ShadingLevel];

export const RoofType = {
  CERAMIC: 'CERAMIC',
  METAL: 'METAL',
  FIBROCEMENT: 'FIBROCEMENT',
  SLAB: 'SLAB',
  GROUND: 'GROUND',
  OTHER: 'OTHER',
} as const;
export type RoofType = (typeof RoofType)[keyof typeof RoofType];

/** Tipos de registro da linha do tempo da oportunidade. */
export const TimelineEventType = {
  CREATED: 'CREATED',
  NOTE: 'NOTE',
  STAGE_CHANGED: 'STAGE_CHANGED',
  TASK_CREATED: 'TASK_CREATED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  BILL_UPLOADED: 'BILL_UPLOADED',
  BILL_VALIDATED: 'BILL_VALIDATED',
  CALCULATION_LINKED: 'CALCULATION_LINKED',
  ENGINEERING_REQUESTED: 'ENGINEERING_REQUESTED',
  ENGINEERING_STARTED: 'ENGINEERING_STARTED',
  ENGINEERING_APPROVED: 'ENGINEERING_APPROVED',
  ENGINEERING_REJECTED: 'ENGINEERING_REJECTED',
  GUARD_EVALUATED: 'GUARD_EVALUATED',
  GUARD_OVERRIDDEN: 'GUARD_OVERRIDDEN',
  QUOTE_CREATED: 'QUOTE_CREATED',
  MARGIN_APPROVAL_REQUESTED: 'MARGIN_APPROVAL_REQUESTED',
  MARGIN_APPROVAL_DECIDED: 'MARGIN_APPROVAL_DECIDED',
  PROPOSAL_GENERATED: 'PROPOSAL_GENERATED',
  PROPOSAL_SENT: 'PROPOSAL_SENT',
  PROPOSAL_VIEWED: 'PROPOSAL_VIEWED',
  PROPOSAL_ACCEPTED: 'PROPOSAL_ACCEPTED',
  CONTRACT_GENERATED: 'CONTRACT_GENERATED',
  CONTRACT_SIGNED: 'CONTRACT_SIGNED',
  PROJECT_CREATED: 'PROJECT_CREATED',
  PROJECT_STATUS_CHANGED: 'PROJECT_STATUS_CHANGED',
} as const;
export type TimelineEventType = (typeof TimelineEventType)[keyof typeof TimelineEventType];

// ---- Triagem, cotação e proposta (Fase 7B) ----

/** Situação da margem de uma cotação frente à política. */
export const MarginStatus = {
  WITHIN_POLICY: 'WITHIN_POLICY',
  BELOW_POLICY: 'BELOW_POLICY',
  NO_POLICY: 'NO_POLICY',
} as const;
export type MarginStatus = (typeof MarginStatus)[keyof typeof MarginStatus];

export const ProposalStatus = {
  GENERATED: 'GENERATED',
  SENT: 'SENT',
  VIEWED: 'VIEWED',
  ACCEPTED: 'ACCEPTED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

/** Alerta/verificação da triagem (Project Guard): cada código tem origem e severidade. */
export const GuardCheckSource = {
  CALCULATOR: 'CALCULATOR',
  INTAKE: 'INTAKE',
  BILL: 'BILL',
  ENGINEERING: 'ENGINEERING',
  CONSISTENCY: 'CONSISTENCY',
  FRESHNESS: 'FRESHNESS',
} as const;
export type GuardCheckSource = (typeof GuardCheckSource)[keyof typeof GuardCheckSource];

// ---- Contrato, projeto e homologação (Fase 7C) ----

export const ContractStatus = {
  DRAFT: 'DRAFT',
  SIGNED: 'SIGNED',
  CANCELLED: 'CANCELLED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

/** Situação do projeto na homologação (solicitação de acesso à distribuidora). */
export const ProjectStatus = {
  DOCUMENTATION: 'DOCUMENTATION',
  SUBMITTED: 'SUBMITTED',
  INSPECTION: 'INSPECTION',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const ChecklistItemStatus = {
  PENDING: 'PENDING',
  DONE: 'DONE',
  WAIVED: 'WAIVED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type ChecklistItemStatus = (typeof ChecklistItemStatus)[keyof typeof ChecklistItemStatus];

// ---- Privacidade (LGPD) ----

export const PrivacySubjectType = {
  LEAD: 'LEAD',
  ACCOUNT: 'ACCOUNT',
} as const;
export type PrivacySubjectType = (typeof PrivacySubjectType)[keyof typeof PrivacySubjectType];

export const PrivacyRequestStatus = {
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
} as const;
export type PrivacyRequestStatus = (typeof PrivacyRequestStatus)[keyof typeof PrivacyRequestStatus];
