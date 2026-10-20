import { describe, expect, it } from 'vitest';
import { engineeringDesignSchema, type InverterSpec, type ModuleSpec } from '@voltex/shared';
import {
  configuratorPending,
  suggestConfigurations,
  type Candidate,
  type ConfiguratorInput,
} from './configurator.js';

const M1 = '0198a000-0000-7000-8000-000000000001';
const M2 = '0198a000-0000-7000-8000-000000000002';
const A = '0198a000-0000-7000-8000-0000000000a1';
const B = '0198a000-0000-7000-8000-0000000000a2';
const MICRO = '0198a000-0000-7000-8000-0000000000a3';

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
  maxSystemVoltageV: 1500,
  lengthMm: 2278,
  widthMm: 1134,
  bifacial: false,
};
const inv: InverterSpec = {
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
const { vStartV: _start, ...invNoStart } = inv;
const micro: InverterSpec = {
  ...invNoStart,
  topology: 'MICRO',
  pAcNomW: 1000,
  pDcMaxW: 1200,
  vDcMaxV: 60,
  mpptMinV: 22,
  mpptMaxV: 55,
  inputsPerMppt: 1,
  iMaxPerMpptA: 14,
  iscMaxPerMpptA: 15,
};

const design = (site: Record<string, unknown> = {}) =>
  engineeringDesignSchema.parse({
    site: { latitude: -15.78, longitude: -47.93, designTminC: 5, designTmaxAmbientC: 35, ...site },
    surfaces: [
      {
        id: 's1',
        name: 'Laje',
        kind: 'PITCHED',
        azimuthDegrees: 0,
        tiltDegrees: 20,
        widthM: 20,
        depthM: 10,
      },
    ],
  });

const cand = <S>(id: string, spec: S, costCents: number | null, label = id): Candidate<S> => ({
  id,
  spec,
  costCents,
  label,
});
const base = (over: Partial<ConfiguratorInput> = {}): ConfiguratorInput => ({
  design: design(),
  surfaceId: 's1',
  targetKwp: 6.6,
  modules: [cand(M1, mod, 60000, 'Módulo 550')],
  inverters: [cand(A, inv, 400000, 'Inversor 5 kW')],
  // Valores de TESTE (não são regra de nenhuma norma).
  parameters: { hotCellIrradianceWm2: 1000, dcAcRatioMin: 0.95, dcAcRatioMax: 1.35 },
  maxInverters: 4,
  limit: 10,
  ...over,
});

describe('gerador de configurações', () => {
  it('acha a configuração esperada: 6,6 kWp = 12 módulos em 2 strings de 6 num inversor de 5 kW', () => {
    const r = suggestConfigurations(base());
    expect(r.pending).toEqual([]);
    const best = r.configurations[0];
    expect(best).toMatchObject({
      moduleId: M1,
      inverterId: A,
      inverterCount: 1,
      modulesInSeries: 6,
      totalStrings: 2,
      moduleCount: 12,
      powerKwp: 6.6,
      dcAcRatio: 1.32,
      status: 'VALID',
    });
    // Custo = 12 × R$ 600,00 + 1 × R$ 4.000,00.
    expect(best?.costCents).toBe(12 * 60000 + 400000);
    expect(best?.entries[0]).toMatchObject({ inverterId: A });
    expect(best?.entries[0]?.mppts.map((m) => m.strings[0]?.parallel)).toEqual([1, 1]);
  });

  it('entre as válidas, a de maior folga de tensão vem primeiro quando o resto empata', () => {
    const r = suggestConfigurations(base());
    const sixBySix = r.configurations.findIndex(
      (c) => c.modulesInSeries === 6 && c.totalStrings === 2,
    );
    const twelve = r.configurations.findIndex(
      (c) => c.modulesInSeries === 12 && c.totalStrings === 1,
    );
    expect(sixBySix).toBeGreaterThanOrEqual(0);
    expect(twelve).toBeGreaterThan(sixBySix);
  });

  it('nenhuma configuração listada viola as verificações (todas VALID ou com aviso) e respeita o limite', () => {
    const r = suggestConfigurations(base({ limit: 3 }));
    expect(r.configurations.length).toBeLessThanOrEqual(3);
    for (const c of r.configurations) expect(['VALID', 'VALID_WITH_WARNINGS']).toContain(c.status);
  });

  it('é determinístico: mesma entrada, mesma saída', () => {
    const input = base({
      modules: [cand(M1, mod, 60000), cand(M2, { ...mod, pmaxWp: 450 }, 50000)],
      inverters: [cand(A, inv, 400000), cand(B, { ...inv, pAcNomW: 6000 }, 450000)],
    });
    expect(suggestConfigurations(input)).toEqual(suggestConfigurations(input));
    // Inverter a ordem de entrada não muda o resultado.
    const reversed = {
      ...input,
      modules: [...input.modules].reverse(),
      inverters: [...input.inverters].reverse(),
    };
    expect(suggestConfigurations(reversed).configurations).toEqual(
      suggestConfigurations(input).configurations,
    );
  });

  it('com dois inversores válidos, o mais barato por kWp vem primeiro', () => {
    const r = suggestConfigurations(
      base({ inverters: [cand(A, inv, 400000), cand(B, { ...inv, pAcNomW: 5000 }, 300000)] }),
    );
    expect(r.configurations[0]?.inverterId).toBe(B);
  });

  it('item sem preço entra, mas depois dos com preço, e informa quais itens não têm preço', () => {
    const r = suggestConfigurations(
      base({ inverters: [cand(A, inv, null, 'Inversor sem preço'), cand(B, inv, 400000)] }),
    );
    expect(r.configurations[0]?.inverterId).toBe(B);
    const unpriced = r.configurations.find((c) => c.inverterId === A);
    expect(unpriced?.costCents).toBeNull();
    expect(unpriced?.unpriced).toEqual(['Inversor sem preço']);
  });

  it('faixa de potência: configurações muito longe da meta ficam atrás das que chegam perto', () => {
    const r = suggestConfigurations(base());
    const powers = r.configurations.map((c) => Math.abs(c.powerKwp - 6.6));
    expect(powers[0]).toBeLessThanOrEqual(powers[powers.length - 1] as number);
  });

  it('microinversores: 12 módulos, 2 por unidade, 6 unidades', () => {
    const r = suggestConfigurations(base({ inverters: [cand(MICRO, micro, 90000, 'Micro 1 kW')] }));
    const best = r.configurations[0];
    expect(best).toMatchObject({
      inverterId: MICRO,
      moduleCount: 12,
      totalStrings: 6,
      status: 'VALID',
    });
    expect(best?.entries[0]?.micro).toEqual({ surfaceId: 's1', units: 6, modulesPerUnit: 2 });
    expect(best?.costCents).toBe(12 * 60000 + 6 * 90000);
  });

  it('par inviável é explicado: nenhuma string atende a faixa de tensão', () => {
    const narrow = { ...inv, mpptMinV: 900, mpptMaxV: 950, vStartV: undefined };
    const r = suggestConfigurations(
      base({ inverters: [cand(A, narrow, 400000, 'Inversor estreito')] }),
    );
    expect(r.configurations).toEqual([]);
    expect(r.discarded[0]?.reason).toMatch(/não existe nº de módulos em série/);
  });

  it('módulo que não cabe na superfície é descartado com motivo', () => {
    const tiny = design();
    tiny.surfaces[0] = {
      ...(tiny.surfaces[0] as NonNullable<(typeof tiny.surfaces)[0]>),
      widthM: 1,
      depthM: 1,
    };
    const r = suggestConfigurations(base({ design: tiny }));
    expect(r.configurations).toEqual([]);
    expect(r.discarded[0]?.reason).toMatch(/não cabe na superfície/);
  });

  it('com mais de um inversor quando a potência pede (30 módulos, 16,5 kWp, MPPT de 5 kW)', () => {
    const r = suggestConfigurations(base({ targetKwp: 16.5, maxInverters: 4 }));
    expect(r.configurations.length).toBeGreaterThan(0);
    expect(r.configurations.every((c) => c.inverterCount >= 2)).toBe(true);
    const c = r.configurations[0];
    expect(c?.entries).toHaveLength(c?.inverterCount ?? 0);
    expect(c?.entries.every((e) => e.mppts.length === 2)).toBe(true);
  });

  it('sem dado ou regra, não gera: devolve as pendências', () => {
    const r = suggestConfigurations(
      base({ design: design({ designTminC: null }), parameters: {} }),
    );
    expect(r.configurations).toEqual([]);
    expect(r.pending.map((p) => p.code)).toEqual([
      'TMIN_MISSING',
      'RULE_HOT_CELL_IRRADIANCE',
      'RULE_DC_AC_RATIO',
    ]);
    expect(
      configuratorPending(design({ designTmaxAmbientC: null }), {
        hotCellIrradianceWm2: 1,
        dcAcRatioMin: 1,
        dcAcRatioMax: 1,
      }).map((p) => p.code),
    ).toEqual(['TMAX_MISSING']);
  });

  it('superfície inexistente é pendência de dado', () => {
    const r = suggestConfigurations(base({ surfaceId: 'zzz' }));
    expect(r.pending[0]?.code).toBe('SURFACE_NOT_FOUND');
  });
});
