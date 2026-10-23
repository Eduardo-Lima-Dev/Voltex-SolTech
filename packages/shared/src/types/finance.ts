import type {
  CommissionBase,
  CostCategory,
  CreditStatus,
  ReceivableStatus,
} from '../schemas/finance.js';

export interface ReceivableDto {
  id: string;
  projectId: string;
  referenceId: string;
  order: number;
  amountCents: number;
  dueOn: string;
  paidOn: string | null;
  paymentMethod: string | null;
  /** Já considera o vencimento: parcela aberta e vencida aparece como `OVERDUE`. */
  status: ReceivableStatus;
  /** Dias de atraso (0 quando não está vencida). */
  daysOverdue: number;
  notes: string | null;
  createdAt: string;
}

export interface ProjectCostEntryDto {
  id: string;
  category: CostCategory;
  description: string;
  estimatedCents: number | null;
  actualCents: number;
  supplier: string | null;
  recordedAt: string;
}

export interface CreditApplicationDto {
  id: string;
  projectId: string;
  institution: string;
  status: CreditStatus;
  annualRatePct: number | null;
  termMonths: number | null;
  amountCents: number;
  /** Montante com juros simples: só quando taxa e prazo foram informados. */
  totalCents: number | null;
  pendencies: string[];
  notes: string | null;
  appliedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface CommissionPolicyDto {
  id: string;
  base: CommissionBase;
  weights: Record<string, number>;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CommissionDto {
  id: string;
  policyId: string;
  userId: string | null;
  userName: string | null;
  projectId: string | null;
  amountCents: number;
  calculatedAt: string;
  paidAt: string | null;
}

export interface ProjectFinancialSummaryDto {
  projectId: string;
  /** Valor do contrato. */
  valueCents: number;
  totalReceivedCents: number;
  /** Parcelas abertas ou vencidas (ainda a receber). */
  totalOpenCents: number;
  totalOverdueCents: number;
  totalCostsCents: number;
  /** Soma dos custos previstos (só dos lançamentos que informaram previsão). */
  totalEstimatedCostsCents: number;
  totalCommissionsCents: number;
  /** Recebido − custos reais − comissões. */
  marginCents: number;
  /** Margem sobre o valor recebido; `null` enquanto nada foi recebido. */
  marginPct: number | null;
  /** Desvio dos custos reais sobre a previsão (%); `null` sem previsão. */
  costDeviationPct: number | null;
  receivablesCount: number;
  receivablesPaidCount: number;
  overdueCount: number;
  receivables: ReceivableDto[];
  costEntries: ProjectCostEntryDto[];
  creditApplications: CreditApplicationDto[];
  commissions: CommissionDto[];
}

export interface FinanceOverviewDto {
  totalOpenCents: number;
  totalOverdueCents: number;
  /** Recebido nos últimos 30 dias. */
  receivedLast30DaysCents: number;
  /** Comissões calculadas e ainda não pagas. */
  commissionsPendingCents: number;
  overdue: Array<
    ReceivableDto & {
      projectCode: string;
      accountName: string | null;
    }
  >;
}
