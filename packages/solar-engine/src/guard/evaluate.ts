import type {
  AlertSeverity,
  CustomerGroup,
  GuardCheckSource,
  PhaseSystem,
  ProjectType,
  ShadingLevel,
  SiteIntake,
  TrafficLight,
} from '@voltex/shared';

/**
 * Project Guard: triagem técnico-comercial (ADR-0014). **Não é homologação nem aprovação técnica.**
 * Orquestra o que já existe (cálculo, fatura validada, intake do local, pedidos de engenharia) e devolve o
 * semáforo da triagem, os alertas e o que falta. Só verificações **não regulatórias**: regra por distribuidora
 * entra quando houver fonte oficial vigente (RN-012, RN-017).
 */
export const GUARD_ALGORITHM_VERSION = 'guard-1.0.0';

export interface GuardCheck {
  /** Código estável (ex.: `NO_CALCULATION`, `CALC_MINIGENERATION_CLASS`). */
  code: string;
  severity: AlertSeverity;
  message: string;
  source: GuardCheckSource;
}

export interface GuardCalculationInput {
  id: string;
  createdAt: Date;
  trafficLight: TrafficLight;
  requiresEngineering: boolean;
  alerts: { code: string; severity: AlertSeverity; message: string }[];
  averageMonthlyConsumptionKwh: number;
  /** Premissas do local usadas no cálculo, para detectar se mudaram depois. */
  premises: {
    projectType: ProjectType;
    customerGroup: CustomerGroup;
    latitude: number | null;
    roofAzimuthDegrees: number | null;
    tiltDegrees: number | null;
    availableAreaM2: number | null;
    shadingRelevant: boolean;
  };
  tariffSource: string | null;
  overridden: { solarResource: boolean; tariff: boolean };
}

export interface GuardInputs {
  opportunity: { projectType: ProjectType };
  site: { latitude: number | null; intake: SiteIntake } | null;
  unit: {
    distributorId: string | null;
    customerGroup: CustomerGroup;
    phaseSystem: PhaseSystem | null;
  } | null;
  bill: { createdAt: Date; averageMonthlyKwh: number } | null;
  calculation: GuardCalculationInput | null;
  engineeringRequests: { status: string }[];
}

export interface GuardResult {
  algorithmVersion: string;
  status: TrafficLight;
  checks: GuardCheck[];
  /** Campos que faltam para uma triagem confiável, no formato `local.azimute`. */
  missingFields: string[];
  needsHumanReview: boolean;
  needsEngineeringReview: boolean;
}

const CONSUMPTION_TOLERANCE = 0.3;
const COORDINATE_TOLERANCE = 0.01;
const ANGLE_TOLERANCE = 0.5;
const AREA_TOLERANCE = 0.5;

const differs = (a: number | null, b: number | undefined, tolerance: number) =>
  a !== null && b !== undefined && Math.abs(a - b) > tolerance;

const shadingRelevant = (shading: ShadingLevel | undefined) => shading === 'RELEVANT';

/** O que mudou no local, na UC ou no projeto depois do cálculo (lista legível). */
export function staleReasons(inputs: GuardInputs, calc: GuardCalculationInput): string[] {
  const reasons: string[] = [];
  const p = calc.premises;
  const intake = inputs.site?.intake ?? {};
  if (p.projectType !== inputs.opportunity.projectType) reasons.push('o tipo de sistema');
  if (inputs.unit && p.customerGroup !== inputs.unit.customerGroup)
    reasons.push('o grupo tarifário');
  if (differs(p.latitude, inputs.site?.latitude ?? undefined, COORDINATE_TOLERANCE))
    reasons.push('a localização');
  if (differs(p.roofAzimuthDegrees, intake.roofAzimuthDegrees, ANGLE_TOLERANCE))
    reasons.push('o azimute do telhado');
  if (differs(p.tiltDegrees, intake.tiltDegrees, ANGLE_TOLERANCE)) reasons.push('a inclinação');
  if (differs(p.availableAreaM2, intake.availableAreaM2, AREA_TOLERANCE))
    reasons.push('a área disponível');
  if (
    inputs.site &&
    intake.shading !== undefined &&
    p.shadingRelevant !== shadingRelevant(intake.shading)
  )
    reasons.push('o sombreamento');
  if (inputs.bill && inputs.bill.createdAt.getTime() > calc.createdAt.getTime())
    reasons.push('a fatura (confirmada depois do cálculo)');
  return reasons;
}

/** Campos do levantamento técnico que a triagem considera necessários. */
const REQUIRED_INTAKE: [keyof SiteIntake, string][] = [
  ['roofAzimuthDegrees', 'azimute do telhado'],
  ['tiltDegrees', 'inclinação'],
  ['shading', 'sombreamento'],
  ['availableAreaM2', 'área disponível'],
];

export function evaluateProjectGuard(inputs: GuardInputs): GuardResult {
  const checks: GuardCheck[] = [];
  const missingFields: string[] = [];
  const add = (code: string, severity: AlertSeverity, source: GuardCheckSource, message: string) =>
    checks.push({ code, severity, source, message });

  // ---- Cálculo ----
  const calc = inputs.calculation;
  if (!calc) {
    add(
      'NO_CALCULATION',
      'BLOCKING',
      'CALCULATOR',
      'Nenhum cálculo vinculado à oportunidade. Faça o cálculo de pré-viabilidade.',
    );
  } else {
    if (calc.trafficLight === 'RED') {
      const blockers = calc.alerts.filter((a) => a.severity === 'BLOCKING').map((a) => a.message);
      add(
        'CALCULATION_RED',
        'BLOCKING',
        'CALCULATOR',
        `O cálculo tem impedimentos: ${blockers.join(' · ') || 'veja os alertas do cálculo'}.`,
      );
    } else if (calc.trafficLight === 'YELLOW') {
      add(
        'CALCULATION_YELLOW',
        'WARNING',
        'CALCULATOR',
        'O cálculo pede revisão (semáforo amarelo): confirme os pontos de atenção antes da proposta.',
      );
    }
    for (const alert of calc.alerts) {
      // O alerta que levou ao vermelho já está acima; os demais entram um a um, com a severidade original.
      if (calc.trafficLight === 'RED' && alert.severity === 'BLOCKING') continue;
      add(`CALC_${alert.code}`, alert.severity, 'CALCULATOR', alert.message);
    }
    const stale = staleReasons(inputs, calc);
    if (stale.length > 0)
      add(
        'CALCULATION_STALE',
        'BLOCKING',
        'FRESHNESS',
        `Mudaram desde o cálculo: ${stale.join(', ')}. Refaça o cálculo com as premissas atuais.`,
      );
    if (calc.overridden.solarResource || calc.overridden.tariff)
      add(
        'ASSUMPTIONS_OVERRIDDEN',
        'INFO',
        'CALCULATOR',
        'O cálculo usa valores alterados à mão em relação ao cadastro (irradiação ou tarifa).',
      );
    if (calc.tariffSource?.toLowerCase().includes('sem impostos'))
      add(
        'TARIFF_WITHOUT_TAXES',
        'INFO',
        'CONSISTENCY',
        'A tarifa vem da ANEEL, sem impostos: a economia pode estar subestimada. Prefira a tarifa da fatura.',
      );
  }

  // ---- Fatura ----
  if (!inputs.bill) {
    add(
      'BILL_NOT_VALIDATED',
      'WARNING',
      'BILL',
      'Não há fatura de energia validada: o consumo não foi conferido com um documento do cliente.',
    );
    missingFields.push('fatura.validada');
  } else if (calc && inputs.bill.averageMonthlyKwh > 0) {
    const diff =
      Math.abs(calc.averageMonthlyConsumptionKwh - inputs.bill.averageMonthlyKwh) /
      inputs.bill.averageMonthlyKwh;
    if (diff > CONSUMPTION_TOLERANCE)
      add(
        'CONSUMPTION_MISMATCH',
        'WARNING',
        'CONSISTENCY',
        `O consumo médio do cálculo (${Math.round(calc.averageMonthlyConsumptionKwh)} kWh/mês) difere ${Math.round(diff * 100)}% do da fatura validada (${Math.round(inputs.bill.averageMonthlyKwh)} kWh/mês).`,
      );
  }

  // ---- Local, UC e levantamento técnico ----
  if (!inputs.site) {
    add(
      'SITE_MISSING',
      'WARNING',
      'INTAKE',
      'Nenhum imóvel vinculado: o levantamento técnico do local não foi feito.',
    );
    missingFields.push('local');
  } else {
    const intake = inputs.site.intake;
    const missing = REQUIRED_INTAKE.filter(([key]) => intake[key] === undefined);
    for (const [key] of missing) missingFields.push(`local.${key}`);
    if (missing.length > 0)
      add(
        'INTAKE_INCOMPLETE',
        'WARNING',
        'INTAKE',
        `Levantamento técnico incompleto: faltam ${missing.map(([, label]) => label).join(', ')}.`,
      );
    if (intake.technicalVisitRequired && !intake.technicalVisitDone)
      add(
        'TECHNICAL_VISIT_PENDING',
        'WARNING',
        'INTAKE',
        'A visita técnica foi marcada como necessária e ainda não foi feita.',
      );
    if (intake.groundingAdequate === false)
      add(
        'GROUNDING_INADEQUATE',
        'WARNING',
        'INTAKE',
        'O aterramento do imóvel não está adequado: prever a adequação no orçamento e no prazo.',
      );
    if (shadingRelevant(intake.shading))
      add(
        'SHADING_RELEVANT',
        'WARNING',
        'INTAKE',
        'Há sombreamento relevante no local: as perdas precisam ser estimadas com cuidado.',
      );
    if (intake.entryBreakerAmps === undefined || intake.groundingAdequate === undefined)
      add(
        'ENTRY_STANDARD_UNKNOWN',
        'INFO',
        'INTAKE',
        'Padrão de entrada (disjuntor e aterramento) não verificado: pode exigir adequações.',
      );
  }
  if (!inputs.unit) {
    add('UC_MISSING', 'WARNING', 'INTAKE', 'Nenhuma unidade consumidora vinculada.');
    missingFields.push('uc');
  } else {
    if (!inputs.unit.distributorId) {
      add(
        'DISTRIBUTOR_MISSING',
        'WARNING',
        'INTAKE',
        'A unidade consumidora não tem concessionária informada.',
      );
      missingFields.push('uc.concessionaria');
    }
    if (!inputs.unit.phaseSystem) {
      add(
        'PHASE_MISSING',
        'WARNING',
        'INTAKE',
        'Tipo de ligação (mono, bi ou trifásico) não informado.',
      );
      missingFields.push('uc.ligacao');
    }
  }

  // ---- Engenharia ----
  const engineeringOpen = inputs.engineeringRequests.some(
    (r) => r.status === 'PENDING' || r.status === 'IN_PROGRESS',
  );
  if (engineeringOpen)
    add(
      'ENGINEERING_PENDING',
      'WARNING',
      'ENGINEERING',
      'Há pedido de engenharia em aberto: a análise técnica ainda não terminou.',
    );

  const status: TrafficLight = checks.some((c) => c.severity === 'BLOCKING')
    ? 'RED'
    : checks.some((c) => c.severity === 'WARNING')
      ? 'YELLOW'
      : 'GREEN';

  return {
    algorithmVersion: GUARD_ALGORITHM_VERSION,
    status,
    checks,
    missingFields,
    needsHumanReview: status !== 'GREEN',
    needsEngineeringReview: !!calc?.requiresEngineering || engineeringOpen,
  };
}
