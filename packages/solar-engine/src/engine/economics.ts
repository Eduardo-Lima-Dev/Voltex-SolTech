import { roundTo } from '../units/index.js';

/** ENG-F23: fluxo econômico reproduzível. Regras determinam compensação/Fio B; não há premissa regulatória embutida. */
export const ECONOMICS_ALGORITHM_VERSION = 'economics-1.1.0';

export interface EconomicsInput {
  capexCents: number;
  annualGenerationKwh: number;
  monthlyConsumptionKwh: number;
  tariffCentsPerKwh: number;
  tariffEscalationPct: number;
  degradationPctPerYear: number;
  opexPctOfCapex: number;
  discountRatePct: number;
  compensationFactor: number;
  horizonYears?: number;
}

export interface EconomicsYear {
  year: number;
  generationKwh: number;
  compensatedKwh: number;
  savingsCents: number;
  opexCents: number;
  netCashFlowCents: number;
  discountedCashFlowCents: number;
  cumulativeCents: number;
}

export interface EconomicsResult {
  years: EconomicsYear[];
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  npvCents: number;
  irrPct: number | null;
  lcoeCentsPerKwh: number | null;
  algorithmVersion: string;
}

const payback = (initial: number, flows: readonly number[]): number | null => {
  let cumulative = -initial;
  for (let index = 0; index < flows.length; index++) {
    const flow = flows[index] ?? 0;
    if (cumulative + flow >= 0)
      return flow > 0 ? roundTo(index + -cumulative / flow, 2) : index + 1;
    cumulative += flow;
  }
  return null;
};

/** TIR anual por bisseção: `null` quando não há mudança de sinal ou a raiz não está no intervalo econômico. */
const irr = (initial: number, flows: readonly number[]): number | null => {
  const npvAt = (rate: number) =>
    -initial + flows.reduce((sum, flow, index) => sum + flow / (1 + rate) ** (index + 1), 0);
  let low = -0.999;
  let high = 10;
  if (npvAt(low) * npvAt(high) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const middle = (low + high) / 2;
    if (npvAt(low) * npvAt(middle) <= 0) high = middle;
    else low = middle;
  }
  return roundTo(((low + high) / 2) * 100, 3);
};

export function evaluateEconomics(input: EconomicsInput): EconomicsResult {
  const horizon = input.horizonYears ?? 25;
  if (
    horizon < 1 ||
    input.capexCents < 0 ||
    input.annualGenerationKwh < 0 ||
    input.monthlyConsumptionKwh < 0
  )
    throw new RangeError('Entradas econômicas inválidas');
  const rates = [
    input.tariffEscalationPct,
    input.degradationPctPerYear,
    input.opexPctOfCapex,
    input.discountRatePct,
  ];
  if (
    rates.some((rate) => !Number.isFinite(rate) || rate < 0) ||
    input.tariffCentsPerKwh < 0 ||
    input.compensationFactor < 0
  )
    throw new RangeError('Taxas econômicas inválidas');
  const years: EconomicsYear[] = [];
  let cumulative = -input.capexCents;
  for (let year = 1; year <= horizon; year++) {
    const generationKwh =
      input.annualGenerationKwh * (1 - input.degradationPctPerYear / 100) ** (year - 1);
    const compensatedKwh =
      Math.min(generationKwh, input.monthlyConsumptionKwh * 12) * input.compensationFactor;
    const tariff = input.tariffCentsPerKwh * (1 + input.tariffEscalationPct / 100) ** (year - 1);
    const savingsCents = Math.round(compensatedKwh * tariff);
    const opexCents = Math.round(input.capexCents * (input.opexPctOfCapex / 100));
    const netCashFlowCents = savingsCents - opexCents;
    const discountedCashFlowCents = netCashFlowCents / (1 + input.discountRatePct / 100) ** year;
    cumulative += netCashFlowCents;
    years.push({
      year,
      generationKwh: roundTo(generationKwh, 2),
      compensatedKwh: roundTo(compensatedKwh, 2),
      savingsCents,
      opexCents,
      netCashFlowCents,
      discountedCashFlowCents: Math.round(discountedCashFlowCents),
      cumulativeCents: cumulative,
    });
  }
  const flows = years.map((year) => year.netCashFlowCents);
  const discounted = years.map((year) => year.discountedCashFlowCents);
  const discountedEnergy = years.reduce(
    (sum, year) => sum + year.generationKwh / (1 + input.discountRatePct / 100) ** year.year,
    0,
  );
  return {
    years,
    simplePaybackYears: payback(input.capexCents, flows),
    discountedPaybackYears: payback(input.capexCents, discounted),
    npvCents: Math.round(-input.capexCents + discounted.reduce((sum, flow) => sum + flow, 0)),
    irrPct: irr(input.capexCents, flows),
    lcoeCentsPerKwh: discountedEnergy > 0 ? roundTo(input.capexCents / discountedEnergy, 3) : null,
    algorithmVersion: ECONOMICS_ALGORITHM_VERSION,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Financiamento (Price e SAC), cenários e sensibilidade
// ---------------------------------------------------------------------------------------------------------

export interface FinancingInput {
  /** Percentual do CAPEX pago à vista (entrada). */
  downPaymentPct: number;
  annualRatePct: number;
  termMonths: number;
  system: 'PRICE' | 'SAC';
}

export interface FinancingResult {
  system: 'PRICE' | 'SAC';
  principalCents: number;
  downPaymentCents: number;
  firstInstallmentCents: number;
  lastInstallmentCents: number;
  totalPaidCents: number;
  totalInterestCents: number;
  /** Parcelas somadas por ano do projeto (centavos). */
  annualInstallmentsCents: number[];
  /** Fluxo de quem financia: economia − O&M − parcelas, com a entrada no ano 0. */
  npvCents: number;
  simplePaybackYears: number | null;
  irrPct: number | null;
}

/** Taxa mensal equivalente à taxa anual efetiva. */
const monthlyRate = (annualPct: number): number => (1 + annualPct / 100) ** (1 / 12) - 1;

/**
 * Parcelas do financiamento. Price: parcela constante `P·i/(1−(1+i)^−n)`. SAC: amortização constante `P/n` mais juros
 * sobre o saldo. Juros compostos pela taxa efetiva anual convertida em mensal. Não inclui tarifas, seguros ou IOF.
 */
export function financingSchedule(
  principalCents: number,
  annualRatePct: number,
  termMonths: number,
  system: 'PRICE' | 'SAC',
): number[] {
  if (principalCents < 0 || annualRatePct < 0 || !Number.isInteger(termMonths) || termMonths < 1)
    throw new RangeError('Financiamento inválido');
  const i = monthlyRate(annualRatePct);
  const installments: number[] = [];
  let balance = principalCents;
  const price =
    i === 0 ? principalCents / termMonths : (principalCents * i) / (1 - (1 + i) ** -termMonths);
  for (let month = 1; month <= termMonths; month++) {
    const interest = balance * i;
    const amortization = system === 'PRICE' ? price - interest : principalCents / termMonths;
    installments.push(Math.round(amortization + interest));
    balance -= amortization;
  }
  return installments;
}

export function evaluateFinancing(
  capexCents: number,
  financing: FinancingInput,
  base: EconomicsResult,
  discountRatePct: number,
): FinancingResult {
  const downPaymentCents = Math.round((capexCents * financing.downPaymentPct) / 100);
  const principalCents = capexCents - downPaymentCents;
  const installments = financingSchedule(
    principalCents,
    financing.annualRatePct,
    financing.termMonths,
    financing.system,
  );
  const annual = base.years.map((_, index) =>
    installments.slice(index * 12, index * 12 + 12).reduce((sum, v) => sum + v, 0),
  );
  const flows = base.years.map((year, index) => year.netCashFlowCents - (annual[index] ?? 0));
  const npv =
    -downPaymentCents +
    flows.reduce((sum, flow, index) => sum + flow / (1 + discountRatePct / 100) ** (index + 1), 0);
  const totalPaid = installments.reduce((sum, v) => sum + v, 0);
  return {
    system: financing.system,
    principalCents,
    downPaymentCents,
    firstInstallmentCents: installments[0] ?? 0,
    lastInstallmentCents: installments[installments.length - 1] ?? 0,
    totalPaidCents: totalPaid,
    totalInterestCents: totalPaid - principalCents,
    annualInstallmentsCents: annual,
    npvCents: Math.round(npv),
    simplePaybackYears: payback(downPaymentCents, flows),
    irrPct: irr(downPaymentCents, flows),
  };
}

export interface ScenarioOverride {
  name: string;
  tariffEscalationPct?: number | undefined;
  discountRatePct?: number | undefined;
  /** Multiplica a geração anual (ex.: 0,95 = 5% a menos). */
  generationFactor?: number | undefined;
  /** Multiplica o CAPEX. */
  capexFactor?: number | undefined;
}

export interface ScenarioResult {
  name: string;
  simplePaybackYears: number | null;
  npvCents: number;
  irrPct: number | null;
  lcoeCentsPerKwh: number | null;
}

export const MAX_SCENARIOS = 3;

export function evaluateScenarios(
  base: EconomicsInput,
  scenarios: readonly ScenarioOverride[],
): ScenarioResult[] {
  if (scenarios.length > MAX_SCENARIOS) throw new RangeError(`No máximo ${MAX_SCENARIOS} cenários`);
  return scenarios.map((scenario) => {
    const result = evaluateEconomics({
      ...base,
      capexCents: Math.round(base.capexCents * (scenario.capexFactor ?? 1)),
      annualGenerationKwh: base.annualGenerationKwh * (scenario.generationFactor ?? 1),
      tariffEscalationPct: scenario.tariffEscalationPct ?? base.tariffEscalationPct,
      discountRatePct: scenario.discountRatePct ?? base.discountRatePct,
    });
    return {
      name: scenario.name,
      simplePaybackYears: result.simplePaybackYears,
      npvCents: result.npvCents,
      irrPct: result.irrPct,
      lcoeCentsPerKwh: result.lcoeCentsPerKwh,
    };
  });
}

export interface SensitivityItem {
  variable: 'GENERATION' | 'CAPEX' | 'TARIFF' | 'TARIFF_ESCALATION' | 'DISCOUNT_RATE' | 'OPEX';
  label: string;
  /** VPL com a variável reduzida e aumentada em `variationPct`. */
  lowNpvCents: number;
  highNpvCents: number;
  /** Amplitude |alto − baixo|: ordena o tornado. */
  swingCents: number;
}

const SENSITIVITY_LABELS: Record<SensitivityItem['variable'], string> = {
  GENERATION: 'Geração anual',
  CAPEX: 'Investimento (CAPEX)',
  TARIFF: 'Tarifa de energia',
  TARIFF_ESCALATION: 'Reajuste anual da tarifa',
  DISCOUNT_RATE: 'Taxa de desconto',
  OPEX: 'Custo de O&M',
};

/** Tornado: varia cada premissa em ±`variationPct` (relativo) e mede o efeito no VPL; ordenado do maior efeito ao menor. */
export function evaluateSensitivity(base: EconomicsInput, variationPct = 10): SensitivityItem[] {
  const npv = (patch: Partial<EconomicsInput>) => evaluateEconomics({ ...base, ...patch }).npvCents;
  const scale = (value: number, direction: 1 | -1) =>
    value * (1 + (direction * variationPct) / 100);
  const items: SensitivityItem[] = (
    [
      ['GENERATION', (d: 1 | -1) => ({ annualGenerationKwh: scale(base.annualGenerationKwh, d) })],
      ['CAPEX', (d: 1 | -1) => ({ capexCents: Math.round(scale(base.capexCents, d)) })],
      ['TARIFF', (d: 1 | -1) => ({ tariffCentsPerKwh: scale(base.tariffCentsPerKwh, d) })],
      [
        'TARIFF_ESCALATION',
        (d: 1 | -1) => ({ tariffEscalationPct: scale(base.tariffEscalationPct, d) }),
      ],
      ['DISCOUNT_RATE', (d: 1 | -1) => ({ discountRatePct: scale(base.discountRatePct, d) })],
      ['OPEX', (d: 1 | -1) => ({ opexPctOfCapex: scale(base.opexPctOfCapex, d) })],
    ] as const
  ).map(([variable, patch]) => {
    const lowNpvCents = npv(patch(-1));
    const highNpvCents = npv(patch(1));
    return {
      variable,
      label: SENSITIVITY_LABELS[variable],
      lowNpvCents,
      highNpvCents,
      swingCents: Math.abs(highNpvCents - lowNpvCents),
    };
  });
  return items.sort((a, b) => b.swingCents - a.swingCents);
}
