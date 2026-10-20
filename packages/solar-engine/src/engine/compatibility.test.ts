import { describe, expect, it } from 'vitest';
import {
  engineeringDesignSchema,
  type EngineeringDesign,
  type InverterEntry,
  type InverterSpec,
  type ModuleSpec,
} from '@voltex/shared';
import { evaluateCompatibility, type CompatibilityInput } from './compatibility.js';

const M1 = '0198a000-0000-7000-8000-000000000001';
const M2 = '0198a000-0000-7000-8000-000000000002';
const INV = '0198a000-0000-7000-8000-0000000000a1';
const MICRO = '0198a000-0000-7000-8000-0000000000a2';

const moduleSpec: ModuleSpec = {
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
  maxSystemVoltageV: 1500,
  lengthMm: 2278,
  widthMm: 1134,
  bifacial: false,
};
const inverterSpec: InverterSpec = {
  topology: 'STRING',
  pAcNomW: 5000,
  pAcMaxW: 5500,
  pDcMaxW: 7500,
  vDcMaxV: 1100,
  vStartV: 180,
  mpptMinV: 140,
  mpptMaxV: 1000,
  mpptCount: 2,
  inputsPerMppt: 2,
  iMaxPerMpptA: 16,
  iscMaxPerMpptA: 22,
  vAcV: 220,
  phases: 1,
  exportLimitation: true,
};
const microSpec: InverterSpec = {
  topology: 'MICRO',
  pAcNomW: 1000,
  pDcMaxW: 1200,
  vDcMaxV: 60,
  mpptMinV: 22,
  mpptMaxV: 55,
  mpptCount: 2,
  inputsPerMppt: 1,
  iMaxPerMpptA: 14,
  iscMaxPerMpptA: 15,
  vAcV: 220,
  phases: 1,
  exportLimitation: false,
};

const surface = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Água ${id}`,
  azimuthDegrees: 0,
  tiltDegrees: 20,
  widthM: 10,
  depthM: 5,
  ...over,
});
const strings = (...groups: [string, number, number][]) => ({
  strings: groups.map(([surfaceId, n, parallel], i) => ({
    id: `g${i}`,
    surfaceId,
    modulesInSeries: n,
    parallel,
  })),
});
const entry = (
  mppts: InverterEntry['mppts'],
  over: Partial<InverterEntry> = {},
): InverterEntry => ({
  id: 'e1',
  inverterId: INV,
  mppts,
  ...over,
});
const design = (over: Record<string, unknown> = {}): EngineeringDesign =>
  engineeringDesignSchema.parse({
    site: { latitude: -15.78, longitude: -47.93, designTminC: 5, designTmaxAmbientC: 35 },
    defaultModuleId: M1,
    surfaces: [surface('s1')],
    inverters: [entry([strings(['s1', 6, 1]), strings(['s1', 6, 1])])],
    ...over,
  });
const input = (
  d: EngineeringDesign,
  over: Partial<CompatibilityInput> = {},
): CompatibilityInput => ({
  design: d,
  layoutCountBySurface: { s1: 12, s2: 12 },
  modules: { [M1]: moduleSpec, [M2]: { ...moduleSpec, pmaxWp: 400 } },
  inverters: { [INV]: inverterSpec, [MICRO]: microSpec },
  status: { [M1]: 'APPROVED', [M2]: 'APPROVED', [INV]: 'APPROVED', [MICRO]: 'APPROVED' },
  // Valores de TESTE (não são regra de nenhuma norma).
  parameters: { hotCellIrradianceWm2: 1000, dcAcRatioMin: 0.95, dcAcRatioMax: 1.35 },
  ...over,
});
const codes = (r: ReturnType<typeof evaluateCompatibility>, outcome = 'FAIL') =>
  r.inverters.flatMap((i) => i.checks.filter((c) => c.outcome === outcome).map((c) => c.code));

describe('caso base válido', () => {
  const r = evaluateCompatibility(input(design()));

  it('12 módulos em 2 strings de 6 num inversor de 5 kW passam em tudo', () => {
    expect(r.status).toBe('VALID');
    expect(r.pending).toEqual([]);
    expect(codes(r)).toEqual([]);
    expect(r.inverters[0]?.metrics).toMatchObject({
      dcPowerKwp: 6.6,
      acPowerKw: 5,
      dcAcRatio: 1.32,
      modulesConnected: 12,
      mpptUsed: 2,
      mpptAvailable: 2,
    });
    expect(r.algorithmVersion).toBe('compat-1.0.0');
  });

  it('a temperatura corrige as tensões (valores feitos à mão)', () => {
    // Voc(5 °C) = 49,7 × (1 + 0,0027 × 20) = 52,384; Vmpp(5 °C) = 43,952.
    // Célula quente = 35 + (45 − 20)/800 × 1000 = 66,25 °C; Vmpp quente = 41,7 × (1 − 0,0027 × 41,25) = 37,056.
    expect(r.thermal[0]).toMatchObject({
      moduleId: M1,
      vocColdV: 52.384,
      vmppColdV: 43.952,
      vmppHotV: 37.056,
      cellHotC: 66.25,
      noctSource: 'DATASHEET',
      betaVmppSource: 'BETA_VOC_ASSUMED',
    });
  });

  it('cada verificação carrega valor, limite, fórmula e fonte', () => {
    const voc = r.inverters[0]?.checks.find((c) => c.code === 'VOC_COLD_EXCEEDS_MAX');
    expect(voc).toMatchObject({ outcome: 'PASS', unit: 'V', limit: 1100 });
    expect(voc?.value).toBeCloseTo(6 * 52.384, 2);
    expect(voc?.formula).toMatch(/Voc\(Tmín\)/);
    expect(voc?.source).toMatch(/CRESESB/);
  });
});

describe('limites de tensão da string', () => {
  const one = (n: number) =>
    evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', n, 1])])] }), {
        layoutCountBySurface: { s1: n },
      }),
    );

  it('Voc frio: 20 módulos passam (1047,7 V) e 21 estouram (1100,06 V > 1100 V) por centésimos', () => {
    expect(codes(one(20))).not.toContain('VOC_COLD_EXCEEDS_MAX');
    expect(codes(one(21))).toContain('VOC_COLD_EXCEEDS_MAX');
    expect(one(21).status).toBe('INVALID');
  });

  it('Vmpp frio acima do MPPT: 23 módulos dão 1010,9 V > 1000 V', () => {
    expect(codes(one(23))).toContain('VMPP_ABOVE_MPPT');
    expect(codes(one(22))).not.toContain('VMPP_ABOVE_MPPT');
  });

  it('Vmpp quente abaixo do MPPT: 3 módulos dão 111,2 V < 140 V', () => {
    expect(codes(one(3))).toContain('VMPP_BELOW_MPPT');
    expect(codes(one(4))).not.toContain('VMPP_BELOW_MPPT');
  });

  it('abaixo da tensão de partida é aviso, não erro', () => {
    // 4 módulos: 148,2 V ≥ 140 (passa o MPPT) mas < 180 V (partida).
    const r = one(4);
    expect(codes(r)).toContain('START_VOLTAGE_NOT_REACHED');
    expect(
      r.inverters[0]?.checks.find((c) => c.code === 'START_VOLTAGE_NOT_REACHED')?.severity,
    ).toBe('WARNING');
  });

  it('tensão máxima do sistema do módulo também limita', () => {
    const r = evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', 20, 1])])] }), {
        modules: { [M1]: { ...moduleSpec, maxSystemVoltageV: 1000 } },
        inverters: { [INV]: { ...inverterSpec, vDcMaxV: 1500, mpptMaxV: 1300 } },
        layoutCountBySurface: { s1: 20 },
      }),
    );
    expect(codes(r)).toContain('MODULE_SYSTEM_VOLTAGE_EXCEEDED');
  });
});

describe('corrente e entradas por MPPT', () => {
  const withParallel = (parallel: number) =>
    evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', 6, parallel])])] }), {
        layoutCountBySurface: { s1: 6 * parallel },
      }),
    );

  it('duas strings em paralelo dão 26,38 A > 16 A e 27,96 A > 22 A no curto', () => {
    const r = withParallel(2);
    expect(codes(r)).toEqual(
      expect.arrayContaining(['MPPT_CURRENT_EXCEEDED', 'MPPT_SHORT_CIRCUIT_EXCEEDED']),
    );
    const cur = r.inverters[0]?.checks.find((c) => c.code === 'MPPT_CURRENT_EXCEEDED');
    expect(cur?.value).toBeCloseTo(26.38, 2);
  });

  it('mais strings que entradas por MPPT', () => {
    expect(codes(withParallel(3))).toContain('INPUTS_PER_MPPT_EXCEEDED');
    expect(codes(withParallel(1))).not.toContain('INPUTS_PER_MPPT_EXCEEDED');
  });

  it('sem limite de curto-circuito na ficha, a verificação não existe', () => {
    const { iscMaxPerMpptA: _drop, ...noIsc } = inverterSpec;
    const r = evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', 6, 1])])] }), {
        inverters: { [INV]: noIsc },
        layoutCountBySurface: { s1: 6 },
      }),
    );
    expect(r.inverters[0]?.checks.some((c) => c.code === 'MPPT_SHORT_CIRCUIT_EXCEEDED')).toBe(
      false,
    );
  });

  it('usar mais MPPT do que o inversor tem', () => {
    const r = evaluateCompatibility(
      input(
        design({
          inverters: [entry([strings(['s1', 6, 1]), strings(['s1', 6, 1]), strings(['s1', 6, 1])])],
        }),
        { layoutCountBySurface: { s1: 18 } },
      ),
    );
    expect(codes(r)).toContain('MPPT_COUNT_EXCEEDED');
  });
});

describe('strings do mesmo MPPT (descasamento)', () => {
  it('comprimentos diferentes são erro', () => {
    const r = evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', 6, 1], ['s1', 7, 1])])] }), {
        layoutCountBySurface: { s1: 13 },
      }),
    );
    expect(codes(r)).toContain('STRING_MISMATCH');
    expect(r.status).toBe('INVALID');
  });

  it('módulos diferentes no mesmo MPPT são erro', () => {
    const r = evaluateCompatibility(
      input(
        design({
          surfaces: [surface('s1'), surface('s2', { moduleId: M2 })],
          inverters: [entry([strings(['s1', 6, 1], ['s2', 6, 1])])],
        }),
      ),
    );
    expect(
      r.inverters[0]?.checks.find((c) => c.code === 'STRING_MISMATCH' && c.severity === 'ERROR')
        ?.message,
    ).toMatch(/Módulos diferentes/);
  });

  it('orientações diferentes (norte e leste) são só aviso', () => {
    const r = evaluateCompatibility(
      input(
        design({
          surfaces: [surface('s1'), surface('s2', { azimuthDegrees: 90 })],
          inverters: [entry([strings(['s1', 6, 1], ['s2', 6, 1])])],
        }),
        {
          layoutCountBySurface: { s1: 6, s2: 6 },
          inverters: { [INV]: { ...inverterSpec, iMaxPerMpptA: 30, iscMaxPerMpptA: 30 } },
        },
      ),
    );
    const mismatch = r.inverters[0]?.checks.find((c) => c.code === 'STRING_MISMATCH');
    expect(mismatch).toMatchObject({ severity: 'WARNING', value: 90 });
    expect(r.status).toBe('VALID_WITH_WARNINGS');
  });
});

describe('potência e relação CC/CA', () => {
  it('potência CC acima do máximo do inversor é erro', () => {
    // 14 módulos = 7,7 kWp > 7,5 kW.
    const r = evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', 7, 1]), strings(['s1', 7, 1])])] }), {
        layoutCountBySurface: { s1: 14 },
      }),
    );
    expect(codes(r)).toContain('DC_POWER_EXCEEDED');
  });

  it('relação fora da política é aviso (14 módulos num inversor de 7,5 kW máx. de entrada)', () => {
    const r = evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', 6, 1]), strings(['s1', 6, 1])])] }), {
        inverters: { [INV]: { ...inverterSpec, pAcNomW: 4000 } },
        layoutCountBySurface: { s1: 12 },
      }),
    );
    // 6,6 / 4 = 1,65 > 1,35.
    const ratio = r.inverters[0]?.checks.find((c) => c.code === 'DC_AC_RATIO_OUT_OF_POLICY');
    expect(ratio).toMatchObject({ outcome: 'FAIL', severity: 'WARNING', value: 1.65 });
    expect(r.status).toBe('VALID_WITH_WARNINGS');
  });
});

describe('o que falta fica pendente e impede o "válido"', () => {
  it('sem a temperatura mínima: pendência de dado e status INCOMPLETE, sem erro inventado', () => {
    const d = design({
      site: { latitude: -15.78, longitude: -47.93, designTminC: null, designTmaxAmbientC: 35 },
    });
    const r = evaluateCompatibility(input(d));
    expect(r.pending.map((p) => p.code)).toEqual(['TMIN_MISSING']);
    expect(r.status).toBe('INCOMPLETE');
    expect(codes(r, 'PENDING')).toContain('VOC_COLD_EXCEEDS_MAX');
    expect(r.thermal[0]?.vocColdV).toBeNull();
  });

  it('sem a regra engine.design: pendências de regra (irradiância e relação CC/CA)', () => {
    const r = evaluateCompatibility(input(design(), { parameters: {} }));
    expect(r.pending.map((p) => p.code)).toEqual(['RULE_HOT_CELL_IRRADIANCE', 'RULE_DC_AC_RATIO']);
    expect(r.pending.every((p) => p.kind === 'RULE')).toBe(true);
    expect(r.status).toBe('INCOMPLETE');
    expect(r.thermal[0]?.vmppHotV).toBeNull();
    expect(r.inverters[0]?.status).toBe('INCOMPLETE');
  });

  it('um erro físico vale mais que a pendência: INVALID', () => {
    const r = evaluateCompatibility(
      input(design({ inverters: [entry([strings(['s1', 21, 1])])] }), {
        parameters: {},
        layoutCountBySurface: { s1: 21 },
      }),
    );
    expect(r.status).toBe('INVALID');
  });

  it('sem inversores no projeto: pendência e INCOMPLETE', () => {
    const r = evaluateCompatibility(input(design({ inverters: [] })));
    expect(r.pending.map((p) => p.code)).toEqual(['NO_INVERTERS']);
    expect(r.status).toBe('INCOMPLETE');
  });

  it('módulo sem NOCT usa o Kt padrão do manual (44 °C) e avisa a origem', () => {
    const { noctC: _n, ...noNoct } = moduleSpec;
    const r = evaluateCompatibility(input(design(), { modules: { [M1]: noNoct } }));
    expect(r.thermal[0]).toMatchObject({ noctSource: 'KT_DEFAULT', cellHotC: 35 + 0.03 * 1000 });
  });

  it('com β de Vmpp na ficha, usa o coeficiente próprio', () => {
    const r = evaluateCompatibility(
      input(design(), { modules: { [M1]: { ...moduleSpec, betaVmppPctPerC: -0.35 } } }),
    );
    expect(r.thermal[0]?.betaVmppSource).toBe('BETA_VMPP');
    expect(r.thermal[0]?.vmppHotV).toBeCloseTo(41.7 * (1 - 0.0035 * 41.25), 2);
  });
});

describe('equipamento e alocação', () => {
  it('módulo e inversor precisam estar aprovados', () => {
    const r = evaluateCompatibility(
      input(design(), { status: { [M1]: 'RETIRED', [INV]: 'DRAFT' } }),
    );
    expect(codes(r)).toEqual(
      expect.arrayContaining(['MODULE_NOT_APPROVED', 'INVERTER_NOT_APPROVED']),
    );
    expect(r.status).toBe('INVALID');
  });

  it('inversor que não existe no catálogo', () => {
    const r = evaluateCompatibility(input(design(), { inverters: {} }));
    expect(codes(r)).toEqual(['INVERTER_NOT_FOUND']);
    expect(r.inverters[0]?.status).toBe('INVALID');
  });

  it('superfície ou módulo inexistente na string', () => {
    const none = evaluateCompatibility(
      input(design({ inverters: [entry([strings(['x', 6, 1])])] })),
    );
    expect(codes(none)).toContain('SURFACE_NOT_FOUND');
    const noModule = evaluateCompatibility(input(design({ defaultModuleId: undefined }), {}));
    expect(codes(noModule)).toContain('MODULE_NOT_SELECTED');
  });

  it('módulos do layout sem string é aviso; strings com mais módulos que o layout é erro', () => {
    const fewer = evaluateCompatibility(input(design(), { layoutCountBySurface: { s1: 14 } }));
    expect(fewer.allocation[0]).toMatchObject({
      code: 'MODULES_NOT_ALLOCATED',
      severity: 'WARNING',
      value: 12,
      limit: 14,
    });
    expect(fewer.status).toBe('VALID_WITH_WARNINGS');
    const more = evaluateCompatibility(input(design(), { layoutCountBySurface: { s1: 10 } }));
    expect(more.allocation[0]).toMatchObject({ code: 'MODULES_OVER_ALLOCATED', severity: 'ERROR' });
    expect(more.status).toBe('INVALID');
  });
});

describe('microinversor', () => {
  const microEntry = (over: Partial<InverterEntry> = {}): InverterEntry => ({
    id: 'm1',
    inverterId: MICRO,
    mppts: [],
    micro: { surfaceId: 's1', units: 5, modulesPerUnit: 2 },
    ...over,
  });
  const run = (e: InverterEntry, layout = 10) =>
    evaluateCompatibility(
      input(design({ inverters: [e] }), { layoutCountBySurface: { s1: layout } }),
    );

  it('5 unidades com 2 módulos cada passam; relação CC/CA por unidade = 1,1', () => {
    const r = run(microEntry());
    expect(r.status).toBe('VALID');
    expect(r.inverters[0]?.metrics).toMatchObject({
      modulesConnected: 10,
      dcPowerKwp: 5.5,
      acPowerKw: 5,
      dcAcRatio: 1.1,
    });
  });

  it('mais módulos por unidade que entradas é erro; potência por unidade acima do máximo também', () => {
    const r = run(microEntry({ micro: { surfaceId: 's1', units: 4, modulesPerUnit: 3 } }), 12);
    expect(codes(r)).toEqual(expect.arrayContaining(['MICRO_INPUT_MISMATCH', 'DC_POWER_EXCEEDED']));
  });

  it('a tensão do módulo é conferida contra a entrada do microinversor', () => {
    const r = evaluateCompatibility(
      input(design({ inverters: [microEntry()] }), {
        inverters: { [MICRO]: { ...microSpec, vDcMaxV: 50 } },
        layoutCountBySurface: { s1: 10 },
      }),
    );
    expect(codes(r)).toContain('VOC_COLD_EXCEEDS_MAX');
  });

  it('microinversor sem os dados das unidades fica pendente; sem módulo ou aprovação gera erro', () => {
    expect(run(microEntry({ micro: undefined })).inverters[0]?.checks[0]).toMatchObject({
      code: 'MICRO_INPUT_MISMATCH',
      outcome: 'PENDING',
    });
    expect(
      codes(run(microEntry({ micro: { surfaceId: 'x', units: 1, modulesPerUnit: 1 } }))),
    ).toContain('MODULE_NOT_SELECTED');
    const unapproved = evaluateCompatibility(
      input(design({ inverters: [microEntry()] }), {
        status: { [M1]: 'DRAFT', [MICRO]: 'APPROVED' },
        layoutCountBySurface: { s1: 10 },
      }),
    );
    expect(codes(unapproved)).toContain('MODULE_NOT_APPROVED');
  });
});
