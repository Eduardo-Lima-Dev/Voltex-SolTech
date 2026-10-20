import { describe, expect, it } from 'vitest';
import {
  engineeringDesignSchema,
  type CableSpec,
  type EngineeringDesign,
  type InverterSpec,
  type ModuleSpec,
} from '@voltex/shared';
import {
  COPPER_RESISTIVITY_20C,
  copperResistivity,
  evaluateCables,
  voltageDropV,
  type CablesInput,
} from './cables.js';
import type { Candidate } from './configurator.js';

const M1 = '0198a000-0000-7000-8000-000000000001';
const INV = '0198a000-0000-7000-8000-0000000000a1';
const T3 = '0198a000-0000-7000-8000-0000000000a3';
const cid = (n: number) => `0198a000-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;

const mod: ModuleSpec = {
  technology: 'MONO_SI',
  pmaxWp: 550,
  vmppV: 41.7,
  imppA: 13.19,
  vocV: 49.7,
  iscA: 13.98,
  betaVocPctPerC: -0.27,
  alphaIscPctPerC: 0.05,
  gammaPmaxPctPerC: -0.34,
  noctC: 45,
  lengthMm: 2278,
  widthMm: 1134,
  bifacial: false,
};
const inv: InverterSpec = {
  topology: 'STRING',
  pAcNomW: 5000,
  vDcMaxV: 1100,
  mpptMinV: 140,
  mpptMaxV: 1000,
  mpptCount: 2,
  inputsPerMppt: 3,
  iMaxPerMpptA: 60,
  vAcV: 220,
  phases: 1,
  iAcMaxA: 25,
  exportLimitation: false,
};
const tri: InverterSpec = {
  ...inv,
  pAcNomW: 10000,
  vAcV: 380,
  phases: 3,
  iAcMaxA: undefined as never,
};

const cable = (
  n: number,
  kind: 'DC_SOLAR' | 'AC',
  mm2: number,
  over: Partial<CableSpec> = {},
): Candidate<CableSpec> => ({
  id: cid(n),
  costCents: mm2 * 100,
  label: `Cabo ${mm2} mm²`,
  spec: { cableKind: kind, crossSectionMm2: mm2, conductor: 'CU', voltageRatingV: 1800, ...over },
});
const catalog: Candidate<CableSpec>[] = [
  cable(1, 'DC_SOLAR', 4),
  cable(2, 'DC_SOLAR', 6),
  cable(3, 'DC_SOLAR', 10),
  cable(4, 'AC', 4, { voltageRatingV: 750 }),
  cable(5, 'AC', 6, { voltageRatingV: 750 }),
  cable(6, 'AC', 10, { voltageRatingV: 750 }),
];
// Valores de TESTE (não são regra de nenhuma norma).
const params = {
  conductorTempC: 70,
  maxVoltageDropDcPct: 1,
  maxVoltageDropAcPct: 3,
  cableCurrentFactorDc: 1.25,
  cableCurrentFactorAc: 1,
};
const ampacity = [
  { crossSectionMm2: 4, method: 'A', ampacityA: 40 },
  { crossSectionMm2: 6, method: 'A', ampacityA: 52 },
  { crossSectionMm2: 10, method: 'A', ampacityA: 72 },
  { crossSectionMm2: 16, method: 'A', ampacityA: 96 },
];

const run = (over: Record<string, unknown>) => ({
  id: 'r1',
  label: 'Trecho',
  kind: 'DC_STRING',
  inverterEntryId: 'e1',
  mpptIndex: 0,
  lengthM: 20,
  installMethod: 'A',
  ...over,
});
const design = (cables: unknown[], parallel = 2): EngineeringDesign =>
  engineeringDesignSchema.parse({
    site: { latitude: -15.78, longitude: -47.93, designTminC: 5, designTmaxAmbientC: 35 },
    defaultModuleId: M1,
    surfaces: [{ id: 's1', name: 'A', azimuthDegrees: 0, tiltDegrees: 20, widthM: 20, depthM: 10 }],
    inverters: [
      {
        id: 'e1',
        inverterId: INV,
        mppts: [{ strings: [{ id: 'g1', surfaceId: 's1', modulesInSeries: 6, parallel }] }],
      },
    ],
    cables,
  });
const input = (d: EngineeringDesign, over: Partial<CablesInput> = {}): CablesInput => ({
  design: d,
  modules: { [M1]: mod },
  inverters: { [INV]: inv, [T3]: tri },
  catalog,
  parameters: params,
  designParameters: { hotCellIrradianceWm2: 1000 },
  ampacity,
  ...over,
});

describe('física do cabo', () => {
  it('resistividade do cobre: 0,01724 a 20 °C e 0,0206 a 70 °C (CRESESB Eq. 6.34)', () => {
    expect(copperResistivity(20)).toBe(COPPER_RESISTIVITY_20C);
    expect(copperResistivity(70)).toBeCloseTo(0.01724 * 1.195, 8);
  });
  it('queda de tensão: monofásica/CC = 2·ρ·L·I/S; trifásica usa √3', () => {
    const rho = copperResistivity(70);
    expect(
      voltageDropV({ resistivity: rho, lengthM: 30, currentA: 26.38, sectionMm2: 16 }),
    ).toBeCloseTo((2 * rho * 30 * 26.38) / 16, 8);
    expect(
      voltageDropV({
        resistivity: rho,
        lengthM: 30,
        currentA: 15,
        sectionMm2: 10,
        threePhase: true,
      }),
    ).toBeCloseTo((Math.sqrt(3) * rho * 30 * 15) / 10, 8);
  });
});

describe('trecho CC de string', () => {
  const r = evaluateCables(input(design([run({})])));
  const [res] = r.runs;

  it('escolhe 6 mm²: a seção mínima pela queda é 4,34 mm² (caso feito à mão)', () => {
    // I = Impp = 13,19 A; V = 6 × 41,7 = 250,2 V; ΔVmáx = 1% = 2,502 V; S = 2·0,0206018·20·13,19 / 2,502 = 4,344 mm².
    expect(res?.currentA).toBe(13.19);
    expect(res?.referenceVoltageV).toBeCloseTo(250.2, 2);
    expect(res?.minSectionByDropMm2).toBeCloseTo(4.344, 2);
    expect(res?.sectionMm2).toBe(6);
    expect(res?.chosen?.label).toBe('Cabo 6 mm²');
    // 4 mm² cairia 2,717 V (1,086%), acima de 1%.
    expect(res?.voltageDropPct).toBeCloseTo(
      ((2 * copperResistivity(70) * 20 * 13.19) / 6 / 250.2) * 100,
      2,
    );
    expect(res?.limitPct).toBe(1);
  });

  it('capacidade de condução: corrente de projeto 1,25 × Isc = 17,48 A contra 52 A do 6 mm² no método A', () => {
    expect(res?.designCurrentA).toBeCloseTo(17.475, 3);
    expect(res?.ampacityA).toBe(52);
    expect(res?.checks.find((c) => c.code === 'AMPACITY_EXCEEDED')?.outcome).toBe('PASS');
  });

  it('tudo certo: VÁLIDO, sem pendência', () => {
    expect(r.status).toBe('VALID');
    expect(r.pending).toEqual([]);
    expect(res?.checks.find((c) => c.code === 'CABLE_VOLTAGE_RATING_EXCEEDED')?.outcome).toBe(
      'PASS',
    );
    expect(res?.checks.find((c) => c.code === 'VOLTAGE_DROP_EXCEEDED')?.source).toMatch(/CRESESB/);
  });
});

describe('trecho principal CC com duas strings em paralelo', () => {
  it('26,38 A em 30 m pedem 13,03 mm² pela queda: sem cabo de 16 mm² no catálogo, nenhum atende', () => {
    const r = evaluateCables(input(design([run({ kind: 'DC_MAIN', lengthM: 30 })])));
    expect(r.runs[0]?.minSectionByDropMm2).toBeCloseTo(13.03, 1);
    expect(r.runs[0]?.checks.find((c) => c.code === 'NO_CABLE_AVAILABLE')?.message).toMatch(
      /seção mínima pela queda: 13\.0/,
    );
    expect(r.runs[0]?.chosen).toBeNull();
    expect(r.status).toBe('INVALID');
  });

  it('com um cabo de 16 mm² no catálogo, ele é o escolhido (queda de 0,81%)', () => {
    const r = evaluateCables(
      input(design([run({ kind: 'DC_MAIN', lengthM: 30 })]), {
        catalog: [...catalog, cable(7, 'DC_SOLAR', 16)],
      }),
    );
    expect(r.runs[0]?.sectionMm2).toBe(16);
    expect(r.runs[0]?.voltageDropPct).toBeCloseTo(0.8146, 3);
    expect(r.runs[0]?.designCurrentA).toBeCloseTo(1.25 * 13.98 * 2, 3);
    expect(r.status).toBe('VALID');
  });
});

describe('trecho CA', () => {
  it('monofásico de 25 A em 10 m: o menor cabo que atende os 3% (6,6 V) é o de 4 mm²', () => {
    const r = evaluateCables(
      input(design([run({ kind: 'AC', mpptIndex: undefined, lengthM: 10 })])),
    );
    const res = r.runs[0];
    expect(res?.currentA).toBe(25);
    expect(res?.referenceVoltageV).toBe(220);
    expect(res?.minSectionByDropMm2).toBeCloseTo((2 * copperResistivity(70) * 10 * 25) / 6.6, 2);
    expect(res?.sectionMm2).toBe(4);
    expect(r.status).toBe('VALID');
  });

  it('trifásico usa √3 e a corrente P/(√3·V)', () => {
    const d = engineeringDesignSchema.parse({
      ...design([]),
      inverters: [{ id: 'e1', inverterId: T3, mppts: [] }],
      cables: [run({ kind: 'AC', mpptIndex: undefined, lengthM: 20 })],
    });
    const r = evaluateCables(input(d));
    const res = r.runs[0];
    expect(res?.currentA).toBeCloseTo(10000 / (Math.sqrt(3) * 380), 3);
    expect(res?.minSectionByDropMm2).toBeCloseTo(
      (Math.sqrt(3) * copperResistivity(70) * 20 * (10000 / (Math.sqrt(3) * 380))) / 11.4,
      2,
    );
  });
});

describe('escolha manual', () => {
  it('cabo escolhido pequeno demais reprova a queda de tensão', () => {
    const r = evaluateCables(input(design([run({ lengthM: 40, cableId: cid(1) })])));
    expect(r.runs[0]).toMatchObject({ manual: true, sectionMm2: 4 });
    expect(r.runs[0]?.checks.find((c) => c.code === 'VOLTAGE_DROP_EXCEEDED')?.outcome).toBe('FAIL');
    expect(r.status).toBe('INVALID');
  });

  it('cabo de outro tipo ou inexistente é recusado', () => {
    const wrong = evaluateCables(input(design([run({ cableId: cid(4) })])));
    expect(wrong.runs[0]?.checks.some((c) => c.code === 'CABLE_NOT_SUITABLE')).toBe(true);
    expect(wrong.status).toBe('INVALID');
  });

  it('tensão nominal do cabo abaixo da tensão do circuito reprova', () => {
    const low = [cable(1, 'DC_SOLAR', 6, { voltageRatingV: 300 })];
    const r = evaluateCables(input(design([run({ cableId: cid(1) })]), { catalog: low }));
    expect(r.runs[0]?.checks.find((c) => c.code === 'CABLE_VOLTAGE_RATING_EXCEEDED')?.outcome).toBe(
      'FAIL',
    );
  });
});

describe('pendências: nada presumido', () => {
  it('sem a regra engine.cables: pendências de regra e o resultado fica INCOMPLETO', () => {
    const r = evaluateCables(input(design([run({})]), { parameters: {}, ampacity: [] }));
    expect(r.pending.map((p) => p.code)).toEqual([
      'RULE_CONDUCTOR_TEMP',
      'RULE_AMPACITY_TABLE',
      'RULE_VDROP_DC',
      'RULE_CABLE_CURRENT_FACTOR_DC',
    ]);
    expect(r.runs[0]?.voltageDropPct).toBeNull();
    expect(r.status).toBe('INCOMPLETE');
  });

  it('sem a tabela de capacidade: a queda é calculada e a capacidade fica pendente', () => {
    const r = evaluateCables(input(design([run({})]), { ampacity: [] }));
    expect(r.runs[0]?.sectionMm2).toBe(6);
    expect(r.runs[0]?.checks.find((c) => c.code === 'AMPACITY_EXCEEDED')?.outcome).toBe('PENDING');
    expect(r.pending.map((p) => p.code)).toEqual(['RULE_AMPACITY_TABLE']);
    expect(r.status).toBe('INCOMPLETE');
  });

  it('método de instalação ausente ou seção fora da tabela: capacidade pendente com o motivo', () => {
    const noMethod = evaluateCables(input(design([run({ installMethod: undefined })])));
    expect(noMethod.runs[0]?.checks.find((c) => c.code === 'AMPACITY_EXCEEDED')?.message).toMatch(
      /método de instalação/,
    );
    const outOfTable = evaluateCables(input(design([run({ installMethod: 'Z' })])));
    expect(outOfTable.runs[0]?.checks.find((c) => c.code === 'AMPACITY_EXCEEDED')?.message).toMatch(
      /não tem a seção 6 mm² no método "Z"/,
    );
  });

  it('capacidade da tabela menor que a corrente de projeto reprova (e o sistema pula para a seção maior)', () => {
    const small = [
      { crossSectionMm2: 4, method: 'A', ampacityA: 10 },
      { crossSectionMm2: 6, method: 'A', ampacityA: 12 },
      { crossSectionMm2: 10, method: 'A', ampacityA: 72 },
    ];
    const r = evaluateCables(input(design([run({})]), { ampacity: small }));
    expect(r.runs[0]?.sectionMm2).toBe(10);
  });

  it('comprimento estimado é pendência de dado e impede o "válido"', () => {
    const r = evaluateCables(input(design([run({ lengthEstimated: true })])));
    expect(r.pending.map((p) => p.code)).toEqual(['LENGTH_ESTIMATED']);
    expect(r.status).toBe('INCOMPLETE');
  });

  it('sem trechos: pendência; trecho apontando para algo inexistente: erro', () => {
    expect(evaluateCables(input(design([]))).pending.map((p) => p.code)).toEqual(['NO_CABLE_RUNS']);
    const bad = evaluateCables(input(design([run({ inverterEntryId: 'zz' })])));
    expect(bad.runs[0]?.checks[0]?.code).toBe('RUN_REFERENCE_INVALID');
    expect(bad.status).toBe('INVALID');
    const noMppt = evaluateCables(input(design([run({ mpptIndex: undefined })])));
    expect(noMppt.runs[0]?.checks[0]?.message).toMatch(/MPPT do trecho/);
    const emptyMppt = evaluateCables(input(design([run({ mpptIndex: 1 })])));
    expect(emptyMppt.runs[0]?.checks[0]?.message).toMatch(/não tem strings/);
  });

  it('só cobre é suportado: cabo de alumínio no catálogo é ignorado', () => {
    const al = [cable(1, 'DC_SOLAR', 25, { conductor: 'AL' })];
    const r = evaluateCables(input(design([run({})]), { catalog: al }));
    expect(r.runs[0]?.chosen).toBeNull();
  });
});
