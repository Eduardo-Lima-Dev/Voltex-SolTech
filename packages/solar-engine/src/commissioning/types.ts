import type {
  CommissioningExpected,
  CommissioningLevel,
  CommissioningScope,
  CommissioningTestKind,
} from '@voltex/shared';

export const COMMISSIONING_ALGORITHM_VERSION = 'commissioning-1.0.0';

export type CommissioningResult =
  | 'PENDING'
  /** Registrado, mas a regra em vigor não define tolerância nem limite para julgar. */
  | 'PENDING_RULE'
  /** Registrado, mas faltam dados do projeto ou das condições de medição para calcular o esperado. */
  | 'PENDING_DATA'
  | 'PASS'
  | 'FAIL'
  | 'NOT_APPLICABLE';

/** Dados elétricos de uma string, tirados da ficha do módulo e da configuração do projeto. */
export interface StringElectrical {
  modulesInSeries: number;
  vocStcV: number;
  iscStcA: number;
  betaVocPctPerC: number;
  alphaIscPctPerC: number;
}

/** Condições em que a medição foi feita (medidas no local, com instrumento próprio). */
export interface MeasurementConditions {
  irradianceWm2?: number | null;
  /** Temperatura do módulo (usada como temperatura de célula). */
  moduleTempC?: number | null;
  ambientC?: number | null;
}

/** Alvo de um ensaio: o sistema, uma string ou um inversor. */
export interface CommissioningSubject {
  key: string;
  scope: CommissioningScope;
  label: string;
  electrical?: StringElectrical;
}

/** Ensaio concreto: uma linha do modelo aplicada a um alvo. */
export interface CommissioningTestInstance {
  code: string;
  label: string;
  group: string;
  kind: CommissioningTestKind;
  level: CommissioningLevel;
  scope: CommissioningScope;
  unit: string | null;
  expected: CommissioningExpected;
  tolerancePct: number | null;
  min: number | null;
  max: number | null;
  required: boolean;
  source: string;
  subjectKey: string;
  subjectLabel: string;
  electrical: StringElectrical | null;
}

export interface MeasurementInput {
  /** Valor medido (ensaio de medição). */
  value?: number | null;
  /** Conforme (`true`) ou não conforme (`false`) (ensaio de conferência). */
  passed?: boolean | null;
}

export interface Evaluation {
  result: CommissioningResult;
  expectedValue: number | null;
  /** Desvio do medido em relação ao esperado, em %. */
  deviationPct: number | null;
  /** Como o esperado foi calculado (para o relatório). */
  basis: string | null;
  /** Por que o resultado é pendente, ou o que reprovou. */
  reason: string | null;
}
