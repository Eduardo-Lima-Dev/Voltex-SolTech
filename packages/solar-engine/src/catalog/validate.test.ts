import { describe, expect, it } from 'vitest';
import type { InverterSpec, ModuleSpec } from '@voltex/shared';
import {
  hasBlockingIssue,
  validateCableSpec,
  validateInverterSpec,
  validateModuleSpec,
  validateProtectionSpec,
  validateSpec,
} from './validate.js';

const moduleSpec = (over: Partial<ModuleSpec> = {}): ModuleSpec => ({
  technology: 'MONO_SI',
  pmaxWp: 550,
  vmppV: 41.7,
  imppA: 13.19,
  vocV: 49.7,
  iscA: 13.98,
  efficiencyPct: 21.3,
  betaVocPctPerC: -0.27,
  alphaIscPctPerC: 0.05,
  gammaPmaxPctPerC: -0.34,
  noctC: 45,
  maxSystemVoltageV: 1500,
  maxSeriesFuseA: 25,
  cellsInSeries: 72,
  lengthMm: 2278,
  widthMm: 1134,
  bifacial: false,
  ...over,
});
const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort();

describe('módulo', () => {
  it('uma ficha coerente não tem problemas', () => {
    expect(validateModuleSpec(moduleSpec())).toEqual([]);
  });

  it('erros que impedem a aprovação', () => {
    const issues = validateModuleSpec(
      moduleSpec({
        vmppV: 50,
        imppA: 14,
        betaVocPctPerC: 0.2,
        gammaPmaxPctPerC: 0.1,
        betaVmppPctPerC: 0.1,
        maxSystemVoltageV: 40,
      }),
    );
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'VMPP_NOT_BELOW_VOC',
        'IMPP_NOT_BELOW_ISC',
        'BETA_VOC_NOT_NEGATIVE',
        'GAMMA_NOT_NEGATIVE',
        'BETA_VMPP_NOT_NEGATIVE',
        'SYSTEM_VOLTAGE_BELOW_VOC',
      ]),
    );
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('Pmax que não bate com Vmpp × Impp: aviso até 5% e erro acima', () => {
    // 41,7 × 13,19 = 550,0 W
    expect(codes(validateModuleSpec(moduleSpec({ pmaxWp: 565 })))).toContain('PMAX_GAP');
    const bad = validateModuleSpec(moduleSpec({ pmaxWp: 600 }));
    expect(codes(bad)).toContain('PMAX_MISMATCH');
    expect(hasBlockingIssue(bad)).toBe(true);
    expect(codes(validateModuleSpec(moduleSpec({ pmaxWp: 553 })))).not.toContain('PMAX_GAP');
  });

  it('avisos de faixa não bloqueiam', () => {
    const issues = validateModuleSpec(
      moduleSpec({
        betaVocPctPerC: -0.9,
        gammaPmaxPctPerC: -0.9,
        alphaIscPctPerC: 0.5,
        noctC: 60,
        maxSystemVoltageV: 500,
        maxSeriesFuseA: 10,
        lengthMm: 20,
        widthMm: 10,
        efficiencyPct: 30,
        cellsInSeries: 10,
        powerWarrantyYears: 25,
      }),
    );
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'BETA_VOC_RANGE',
        'GAMMA_RANGE',
        'ALPHA_RANGE',
        'NOCT_RANGE',
        'SYSTEM_VOLTAGE_RANGE',
        'FUSE_BELOW_ISC',
        'AREA_RANGE',
        'EFFICIENCY_MISMATCH',
        'VOC_PER_CELL',
        'WARRANTY_INCOMPLETE',
      ]),
    );
    expect(issues.filter((i) => i.code === 'BETA_VOC_RANGE')[0]?.severity).toBe('WARNING');
  });
});

const inverterSpec = (over: Partial<InverterSpec> = {}): InverterSpec => ({
  topology: 'STRING',
  pAcNomW: 5000,
  pAcMaxW: 5500,
  pDcMaxW: 7500,
  vDcMaxV: 1100,
  vStartV: 180,
  mpptMinV: 140,
  mpptMaxV: 1000,
  mpptCount: 2,
  inputsPerMppt: 1,
  iMaxPerMpptA: 16,
  iscMaxPerMpptA: 22,
  vAcV: 220,
  phases: 1,
  iAcMaxA: 25,
  efficiencyMaxPct: 98.4,
  efficiencyEuroPct: 97.5,
  exportLimitation: true,
  ...over,
});

describe('inversor', () => {
  it('ficha coerente passa', () => {
    expect(validateInverterSpec(inverterSpec())).toEqual([]);
  });

  it('erros: faixa MPPT invertida, MPPT acima da tensão CC, partida fora, potências e eficiência', () => {
    const issues = validateInverterSpec(
      inverterSpec({
        mpptMinV: 1300,
        mpptMaxV: 1200,
        vStartV: 1300,
        pAcMaxW: 4000,
        efficiencyEuroPct: 99,
        efficiencyMaxPct: 98,
      }),
    );
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'MPPT_RANGE_INVERTED',
        'MPPT_ABOVE_VDC_MAX',
        'START_ABOVE_MPPT_MAX',
        'PAC_MAX_BELOW_NOM',
        'EFFICIENCY_EURO_ABOVE_MAX',
      ]),
    );
  });

  it('avisos: potência CC, curto por MPPT, eficiência, microinversor, tensão CA e corrente CA', () => {
    const issues = validateInverterSpec(
      inverterSpec({
        topology: 'MICRO',
        mpptCount: 6,
        pDcMaxW: 3000,
        iscMaxPerMpptA: 10,
        efficiencyMaxPct: 85,
        efficiencyEuroPct: 80,
        vAcV: 50,
        iAcMaxA: 5,
      }),
    );
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'PDC_BELOW_PAC',
        'ISC_MAX_BELOW_IMAX',
        'EFFICIENCY_RANGE',
        'MICRO_MANY_MPPT',
        'VAC_RANGE',
        'IAC_BELOW_POWER',
      ]),
    );
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('trifásico usa √3 na corrente CA', () => {
    expect(
      codes(
        validateInverterSpec(
          inverterSpec({ phases: 3, vAcV: 380, pAcNomW: 10000, pAcMaxW: 11000, iAcMaxA: 17 }),
        ),
      ),
    ).not.toContain('IAC_BELOW_POWER');
  });
});

describe('proteção, cabo e despacho por tipo', () => {
  it('cada tipo de proteção exige os seus campos', () => {
    expect(codes(validateProtectionSpec({ protectionKind: 'FUSE_DC' }))).toEqual([
      'PROTECTION_FIELD_REQUIRED',
      'PROTECTION_FIELD_REQUIRED',
    ]);
    expect(
      validateProtectionSpec({ protectionKind: 'FUSE_DC', ratedCurrentA: 15, ratedVoltageV: 1000 }),
    ).toEqual([]);
    expect(validateProtectionSpec({ protectionKind: 'SURGE_DC', ratedVoltageV: 1000 })).toEqual([]);
    expect(validateProtectionSpec({ protectionKind: 'RCD', ratedCurrentA: 40 })).toHaveLength(1);
  });

  it('cabo: seção fora da faixa e cabo solar sem tensão nominal avisam', () => {
    expect(
      codes(validateCableSpec({ cableKind: 'DC_SOLAR', crossSectionMm2: 4, conductor: 'CU' })),
    ).toEqual(['CABLE_VOLTAGE_MISSING']);
    expect(
      codes(validateCableSpec({ cableKind: 'AC', crossSectionMm2: 1000, conductor: 'CU' })),
    ).toEqual(['CROSS_SECTION_RANGE']);
    expect(validateCableSpec({ cableKind: 'AC', crossSectionMm2: 6, conductor: 'CU' })).toEqual([]);
  });

  it('validateSpec escolhe o validador pelo tipo', () => {
    expect(validateSpec('MODULE', moduleSpec())).toEqual([]);
    expect(validateSpec('INVERTER', inverterSpec())).toEqual([]);
    expect(validateSpec('PROTECTION', { protectionKind: 'BREAKER_AC' })).not.toEqual([]);
    expect(validateSpec('CABLE', { cableKind: 'AC', crossSectionMm2: 6, conductor: 'CU' })).toEqual(
      [],
    );
  });
});
