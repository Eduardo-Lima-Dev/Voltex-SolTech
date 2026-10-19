import type { AvailabilityCost, RuleSource, Thresholds } from '@voltex/shared';
import type { ParsedQuickCalculationInput, QuickCalculationResult } from './types.js';

/** Contratos JSON da API do Solar Calculator (datas chegam como string ISO 8601). */

/** Referências usadas no cálculo, capturadas pelo servidor (rastreabilidade). */
export interface CalculationReferencesSummary {
  solarResource: {
    id: string;
    name: string;
    state: string | null;
    source: string;
    plane: string;
    overridden: boolean;
  } | null;
  tariff: {
    id: string;
    distributorName: string;
    customerGroup: string;
    energyCentsPerKwh: number;
    validFrom: string;
    source: string;
    overridden: boolean;
  } | null;
}

export interface CalculationSessionDto {
  id: string;
  tenantId: string;
  createdById: string | null;
  title: string | null;
  customerName: string | null;
  input: ParsedQuickCalculationInput;
  result: QuickCalculationResult;
  trafficLight: 'GREEN' | 'YELLOW' | 'RED';
  algorithmVersion: string;
  /** Regra aplicada: `builtin@1` ou `<id>@<versão>`. */
  ruleSetRef: string;
  references: CalculationReferencesSummary;
  opportunityId: string | null;
  createdAt: string;
}

export interface QuickCalculationSnapshotDto extends Omit<
  CalculationSessionDto,
  'title' | 'opportunityId'
> {
  sessionId: string;
  note: string | null;
}

/** Configuração efetiva do Calculator para o tenant (regra ativa ou padrão), usada também no preview do front. */
export interface CalculatorConfigDto {
  ruleSetRef: string;
  thresholds: Thresholds;
  availabilityCostKwh: AvailabilityCost;
  sources: RuleSource[];
}
