import type {
  CommissioningExpected,
  CommissioningLevel,
  CommissioningScope,
  CommissioningTestKind,
} from '../schemas/rules.js';
import type {
  CommissioningResultValue,
  CommissioningStatus,
  MeasurementConditionsInput,
} from '../schemas/commissioning.js';

/** Contratos JSON do comissionamento (Fase 11D). */

export interface StringElectricalDto {
  modulesInSeries: number;
  vocStcV: number;
  iscStcA: number;
  betaVocPctPerC: number;
  alphaIscPctPerC: number;
}

export interface CommissioningTestDto {
  id: string;
  position: number;
  code: string;
  label: string;
  group: string;
  kind: CommissioningTestKind;
  level: CommissioningLevel;
  scope: CommissioningScope;
  unit: string | null;
  expectedKind: CommissioningExpected;
  tolerancePct: number | null;
  min: number | null;
  max: number | null;
  required: boolean;
  source: string;
  subjectKey: string;
  subjectLabel: string;
  electrical: StringElectricalDto | null;
  result: CommissioningResultValue;
  measuredValue: number | null;
  passed: boolean | null;
  expectedValue: number | null;
  deviationPct: number | null;
  basis: string | null;
  reason: string | null;
  note: string | null;
  conditions: MeasurementConditionsInput | null;
  measuredAt: string | null;
  measuredById: string | null;
  evidencePhotoIds: string[];
}

export interface CommissioningSummaryDto {
  total: number;
  counts: Record<CommissioningResultValue, number>;
  requiredPending: number;
  failed: number;
  unjudged: number;
}

export interface CommissioningRecordDto {
  id: string;
  installationId: string;
  attempt: number;
  status: CommissioningStatus;
  level: CommissioningLevel;
  ruleRef: string;
  /** `true`: sem regra ativa e revisada, vale o modelo-base e a aprovação fica travada. */
  provisional: boolean;
  ruleNote: string | null;
  ruleReviewedBy: string | null;
  internalTestRule: boolean;
  conditions: MeasurementConditionsInput;
  skipped: { code: string; reason: string }[];
  notes: string[];
  startedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  decisionNote: string | null;
  hasReport: boolean;
  summary: CommissioningSummaryDto;
  /** O que impede aprovar agora (lista vazia = pode aprovar). */
  blockers: string[];
  tests: CommissioningTestDto[];
}

export interface AcceptanceDto {
  acceptedAt: string;
  acceptedByName: string;
  channel: string;
  note: string | null;
  hasSignature: boolean;
}

/** Cópia do que o técnico precisa dos ensaios de uma ordem de comissionamento (guardada para uso sem internet). */
export interface FieldCommissioningDto {
  recordId: string;
  status: CommissioningStatus;
  level: CommissioningLevel;
  provisional: boolean;
  ruleNote: string | null;
  conditions: MeasurementConditionsInput;
  tests: CommissioningTestDto[];
}
