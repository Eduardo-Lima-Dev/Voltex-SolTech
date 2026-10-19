import { describe, expect, it } from 'vitest';
import {
  GUARD_ALGORITHM_VERSION,
  evaluateProjectGuard,
  staleReasons,
  type GuardInputs,
} from './evaluate.js';

const T0 = new Date('2026-10-01T12:00:00Z');
const T1 = new Date('2026-10-02T12:00:00Z');

/** Entrada completa e coerente: dá VERDE. Cada teste muda só o que quer provar. */
const ok = (): GuardInputs => ({
  opportunity: { projectType: 'ON_GRID' },
  site: {
    latitude: -3.73,
    intake: {
      roofType: 'CERAMIC',
      roofAzimuthDegrees: 0,
      tiltDegrees: 15,
      shading: 'NONE',
      availableAreaM2: 50,
      entryBreakerAmps: 63,
      groundingAdequate: true,
    },
  },
  unit: { distributorId: 'd-1', customerGroup: 'B', phaseSystem: 'TWO_PHASE' },
  bill: { createdAt: T0, averageMonthlyKwh: 500 },
  calculation: {
    id: 'calc-1',
    createdAt: T1,
    trafficLight: 'GREEN',
    requiresEngineering: false,
    alerts: [],
    averageMonthlyConsumptionKwh: 500,
    premises: {
      projectType: 'ON_GRID',
      customerGroup: 'B',
      latitude: -3.73,
      roofAzimuthDegrees: 0,
      tiltDegrees: 15,
      availableAreaM2: 50,
      shadingRelevant: false,
    },
    tariffSource: null,
    overridden: { solarResource: false, tariff: false },
  },
  engineeringRequests: [],
});
const codes = (inputs: GuardInputs) => evaluateProjectGuard(inputs).checks.map((c) => c.code);

describe('evaluateProjectGuard', () => {
  it('tudo coerente e completo: verde, sem alertas, sem revisão', () => {
    const result = evaluateProjectGuard(ok());
    expect(result).toMatchObject({
      algorithmVersion: GUARD_ALGORITHM_VERSION,
      status: 'GREEN',
      checks: [],
      missingFields: [],
      needsHumanReview: false,
      needsEngineeringReview: false,
    });
  });

  describe('vermelho (bloqueios)', () => {
    it('sem cálculo vinculado', () => {
      const input = { ...ok(), calculation: null };
      const result = evaluateProjectGuard(input);
      expect(result.status).toBe('RED');
      expect(result.checks[0]).toMatchObject({
        code: 'NO_CALCULATION',
        severity: 'BLOCKING',
        source: 'CALCULATOR',
      });
      expect(result.needsHumanReview).toBe(true);
    });

    it('cálculo vermelho cita os impedimentos e não repete o alerta bloqueante', () => {
      const input = ok();
      input.calculation!.trafficLight = 'RED';
      input.calculation!.alerts = [
        {
          code: 'INSUFFICIENT_AREA',
          severity: 'BLOCKING',
          message: 'Área insuficiente: faltam 3 m².',
        },
        { code: 'DEFAULT_PERFORMANCE_RATIO', severity: 'INFO', message: 'PR padrão em uso.' },
      ];
      const result = evaluateProjectGuard(input);
      expect(result.status).toBe('RED');
      expect(result.checks.find((c) => c.code === 'CALCULATION_RED')?.message).toContain(
        'Área insuficiente',
      );
      expect(result.checks.map((c) => c.code)).toEqual([
        'CALCULATION_RED',
        'CALC_DEFAULT_PERFORMANCE_RATIO',
      ]);
    });

    it.each([
      ['o tipo de sistema', (i: GuardInputs) => (i.opportunity.projectType = 'HYBRID')],
      ['o grupo tarifário', (i: GuardInputs) => (i.unit!.customerGroup = 'A')],
      ['a localização', (i: GuardInputs) => (i.site!.latitude = -10)],
      ['o azimute do telhado', (i: GuardInputs) => (i.site!.intake.roofAzimuthDegrees = 90)],
      ['a inclinação', (i: GuardInputs) => (i.site!.intake.tiltDegrees = 30)],
      ['a área disponível', (i: GuardInputs) => (i.site!.intake.availableAreaM2 = 20)],
      ['o sombreamento', (i: GuardInputs) => (i.site!.intake.shading = 'RELEVANT')],
      ['a fatura', (i: GuardInputs) => (i.bill!.createdAt = new Date('2026-10-03T00:00:00Z'))],
    ])('premissa mudada depois do cálculo (%s) deixa o cálculo desatualizado', (reason, mutate) => {
      const input = ok();
      mutate(input);
      const result = evaluateProjectGuard(input);
      expect(result.status).toBe('RED');
      const stale = result.checks.find((c) => c.code === 'CALCULATION_STALE');
      expect(stale).toMatchObject({ severity: 'BLOCKING', source: 'FRESHNESS' });
      expect(stale?.message).toContain(reason);
    });

    it('lista todas as mudanças de uma vez; diferença dentro da tolerância não conta', () => {
      const input = ok();
      input.site!.intake.tiltDegrees = 15.3; // tolerância de 0,5°
      input.site!.latitude = -3.735; // tolerância de 0,01°
      expect(staleReasons(input, input.calculation!)).toEqual([]);
      input.site!.intake.tiltDegrees = 25;
      input.opportunity.projectType = 'OFF_GRID';
      expect(staleReasons(input, input.calculation!)).toEqual([
        'o tipo de sistema',
        'a inclinação',
      ]);
    });

    it('sem imóvel ou sem UC não há como comparar: não acusa desatualização', () => {
      const input = { ...ok(), site: null, unit: null };
      expect(codes(input)).not.toContain('CALCULATION_STALE');
    });
  });

  describe('amarelo (revisão necessária)', () => {
    it('cálculo amarelo exige revisão e, se pedir engenharia, revisão de engenharia', () => {
      const input = ok();
      input.calculation!.trafficLight = 'YELLOW';
      input.calculation!.requiresEngineering = true;
      input.calculation!.alerts = [
        { code: 'GROUP_A_COMPLEX', severity: 'WARNING', message: 'Cliente do Grupo A.' },
      ];
      const result = evaluateProjectGuard(input);
      expect(result.status).toBe('YELLOW');
      expect(result.needsHumanReview).toBe(true);
      expect(result.needsEngineeringReview).toBe(true);
      expect(result.checks.map((c) => c.code)).toEqual([
        'CALCULATION_YELLOW',
        'CALC_GROUP_A_COMPLEX',
      ]);
    });

    it('sem fatura validada: amarelo, com o campo faltante', () => {
      const result = evaluateProjectGuard({ ...ok(), bill: null });
      expect(result.status).toBe('YELLOW');
      expect(result.checks.map((c) => c.code)).toEqual(['BILL_NOT_VALIDATED']);
      expect(result.missingFields).toEqual(['fatura.validada']);
    });

    it('consumo do cálculo muito diferente do da fatura', () => {
      const input = ok();
      input.calculation!.averageMonthlyConsumptionKwh = 800; // +60%
      const check = evaluateProjectGuard(input).checks.find(
        (c) => c.code === 'CONSUMPTION_MISMATCH',
      );
      expect(check?.severity).toBe('WARNING');
      expect(check?.message).toMatch(/800 kWh\/mês.*60%.*500 kWh\/mês/);
      input.calculation!.averageMonthlyConsumptionKwh = 600; // +20%, dentro da tolerância
      expect(codes(input)).not.toContain('CONSUMPTION_MISMATCH');
    });

    it('sem imóvel e sem UC', () => {
      const result = evaluateProjectGuard({ ...ok(), site: null, unit: null });
      expect(result.checks.map((c) => c.code)).toEqual(['SITE_MISSING', 'UC_MISSING']);
      expect(result.missingFields).toEqual(['local', 'uc']);
      expect(result.status).toBe('YELLOW');
    });

    it('levantamento técnico incompleto lista o que falta', () => {
      const input = ok();
      input.site!.intake = { roofType: 'CERAMIC' };
      const result = evaluateProjectGuard(input);
      expect(result.missingFields).toEqual([
        'local.roofAzimuthDegrees',
        'local.tiltDegrees',
        'local.shading',
        'local.availableAreaM2',
      ]);
      const check = result.checks.find((c) => c.code === 'INTAKE_INCOMPLETE');
      expect(check?.message).toBe(
        'Levantamento técnico incompleto: faltam azimute do telhado, inclinação, sombreamento, área disponível.',
      );
    });

    it('visita técnica pendente, aterramento inadequado e sombreamento relevante', () => {
      const input = ok();
      input.site!.intake = {
        ...input.site!.intake,
        technicalVisitRequired: true,
        groundingAdequate: false,
        shading: 'RELEVANT',
      };
      input.calculation!.premises.shadingRelevant = true;
      const result = evaluateProjectGuard(input);
      expect(result.checks.map((c) => c.code).sort()).toEqual([
        'GROUNDING_INADEQUATE',
        'SHADING_RELEVANT',
        'TECHNICAL_VISIT_PENDING',
      ]);
      expect(result.status).toBe('YELLOW');
      input.site!.intake.technicalVisitDone = true;
      expect(codes(input)).not.toContain('TECHNICAL_VISIT_PENDING');
    });

    it('UC sem concessionária e sem tipo de ligação', () => {
      const input = ok();
      input.unit = { distributorId: null, customerGroup: 'B', phaseSystem: null };
      const result = evaluateProjectGuard(input);
      expect(result.checks.map((c) => c.code)).toEqual(['DISTRIBUTOR_MISSING', 'PHASE_MISSING']);
      expect(result.missingFields).toEqual(['uc.concessionaria', 'uc.ligacao']);
    });

    it('pedido de engenharia em aberto (pendente ou em andamento) exige revisão de engenharia', () => {
      for (const status of ['PENDING', 'IN_PROGRESS']) {
        const input = ok();
        input.engineeringRequests = [{ status }];
        const result = evaluateProjectGuard(input);
        expect(result.checks.map((c) => c.code)).toEqual(['ENGINEERING_PENDING']);
        expect(result.needsEngineeringReview).toBe(true);
      }
      const done = ok();
      done.engineeringRequests = [{ status: 'DONE' }, { status: 'CANCELLED' }];
      expect(evaluateProjectGuard(done).status).toBe('GREEN');
    });
  });

  describe('informativos (não mudam o semáforo)', () => {
    it('padrão de entrada não verificado, premissas alteradas e tarifa sem impostos ficam em verde', () => {
      const input = ok();
      input.site!.intake = {
        roofAzimuthDegrees: 0,
        tiltDegrees: 15,
        shading: 'NONE',
        availableAreaM2: 50,
      };
      input.calculation!.overridden = { solarResource: true, tariff: false };
      input.calculation!.tariffSource = 'ANEEL Dados Abertos — REH 3.549 (… sem impostos)';
      input.calculation!.alerts = [
        { code: 'DEFAULT_PERFORMANCE_RATIO', severity: 'INFO', message: 'PR padrão em uso.' },
      ];
      const result = evaluateProjectGuard(input);
      expect(result.status).toBe('GREEN');
      expect(result.needsHumanReview).toBe(false);
      expect(result.checks.every((c) => c.severity === 'INFO')).toBe(true);
      expect(result.checks.map((c) => c.code).sort()).toEqual([
        'ASSUMPTIONS_OVERRIDDEN',
        'CALC_DEFAULT_PERFORMANCE_RATIO',
        'ENTRY_STANDARD_UNKNOWN',
        'TARIFF_WITHOUT_TAXES',
      ]);
    });
  });

  it('o bloqueio vence o aviso: com vermelho e amarelo juntos, o semáforo é vermelho', () => {
    const input = ok();
    input.bill = null; // amarelo
    input.calculation = null; // vermelho
    expect(evaluateProjectGuard(input).status).toBe('RED');
  });

  it('a fonte de cada alerta é rastreável', () => {
    const input = ok();
    input.bill = null;
    input.site!.intake = {};
    input.engineeringRequests = [{ status: 'PENDING' }];
    const sources = new Set(evaluateProjectGuard(input).checks.map((c) => c.source));
    expect(sources).toEqual(new Set(['BILL', 'INTAKE', 'ENGINEERING']));
  });
});
