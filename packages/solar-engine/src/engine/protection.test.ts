import { describe, expect, it } from 'vitest';
import {
  engineeringDesignSchema,
  type EngineeringDesign,
  type InverterSpec,
  type ModuleSpec,
  type ProtectionSpec,
} from '@voltex/shared';
import type { Candidate } from './configurator.js';
import { evaluateProtections, type ProtectionInput } from './protection.js';

const M1 = '0198a000-0000-7000-8000-000000000001';
const INV = '0198a000-0000-7000-8000-0000000000a1';
const MICRO = '0198a000-0000-7000-8000-0000000000a2';
const T3 = '0198a000-0000-7000-8000-0000000000a3';
const id = (n: number) => `0198a000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

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
  maxSeriesFuseA: 25,
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
  iscMaxPerMpptA: 80,
  vAcV: 220,
  phases: 1,
  iAcMaxA: 25,
  exportLimitation: false,
};
const micro: InverterSpec = {
  ...inv,
  topology: 'MICRO',
  pAcNomW: 1000,
  vDcMaxV: 60,
  inputsPerMppt: 1,
  iAcMaxA: undefined as never,
};
const tri: InverterSpec = {
  ...inv,
  pAcNomW: 10000,
  vAcV: 380,
  phases: 3,
  iAcMaxA: undefined as never,
};

const p = (
  n: number,
  spec: ProtectionSpec,
  cost: number | null = 1000,
  label = `Item ${n}`,
): Candidate<ProtectionSpec> => ({ id: id(n), spec, costCents: cost, label });
const catalog: Candidate<ProtectionSpec>[] = [
  p(1, { protectionKind: 'FUSE_DC', ratedCurrentA: 15, ratedVoltageV: 1000 }, 500, 'Fusível 15 A'),
  p(
    2,
    { protectionKind: 'FUSE_DC', ratedCurrentA: 20, ratedVoltageV: 250 },
    400,
    'Fusível 20 A / 250 V',
  ),
  p(3, { protectionKind: 'FUSE_DC', ratedCurrentA: 20, ratedVoltageV: 1000 }, 600, 'Fusível 20 A'),
  p(4, { protectionKind: 'FUSE_DC', ratedCurrentA: 25, ratedVoltageV: 1000 }, 700, 'Fusível 25 A'),
  p(
    5,
    { protectionKind: 'DISCONNECTOR_DC', ratedCurrentA: 32, ratedVoltageV: 1000 },
    9000,
    'Seccionadora 32 A',
  ),
  p(
    6,
    { protectionKind: 'DISCONNECTOR_DC', ratedCurrentA: 63, ratedVoltageV: 1000 },
    15000,
    'Seccionadora 63 A',
  ),
  p(7, { protectionKind: 'SURGE_DC', ratedVoltageV: 600 }, 8000, 'DPS 600 V'),
  p(8, { protectionKind: 'SURGE_DC', ratedVoltageV: 1000 }, 12000, 'DPS 1000 V'),
  p(
    9,
    { protectionKind: 'BREAKER_AC', ratedCurrentA: 32, ratedVoltageV: 230, poles: 2 },
    4000,
    'Disjuntor 32 A',
  ),
  p(
    10,
    { protectionKind: 'BREAKER_AC', ratedCurrentA: 40, ratedVoltageV: 230, poles: 2 },
    4500,
    'Disjuntor 40 A',
  ),
  p(
    11,
    { protectionKind: 'BREAKER_AC', ratedCurrentA: 25, ratedVoltageV: 440, poles: 4 },
    6000,
    'Disjuntor 25 A trifásico',
  ),
  p(12, { protectionKind: 'RCD', ratedCurrentA: 25, sensitivityMa: 30 }, 3000, 'DR 25 A / 30 mA'),
  p(13, { protectionKind: 'RCD', ratedCurrentA: 40, sensitivityMa: 30 }, 3500, 'DR 40 A / 30 mA'),
  p(14, { protectionKind: 'RCD', ratedCurrentA: 40, sensitivityMa: 300 }, 3000, 'DR 40 A / 300 mA'),
];
// Valores de TESTE (não são regra de nenhuma norma).
const rules = {
  maxParallelStringsWithoutFuse: 2,
  fuseMinFactor: 1.25,
  dcSwitchCurrentFactor: 1.25,
  acBreakerFactor: 1.25,
  rcdSensitivityMa: 30,
};

const group = (n: number, parallel: number) => ({
  id: `g${n}`,
  surfaceId: 's1',
  modulesInSeries: n,
  parallel,
});
const design = (inverters: unknown[], over: Record<string, unknown> = {}): EngineeringDesign =>
  engineeringDesignSchema.parse({
    site: { latitude: -15.78, longitude: -47.93, designTminC: 5, designTmaxAmbientC: 35 },
    defaultModuleId: M1,
    surfaces: [{ id: 's1', name: 'A', azimuthDegrees: 0, tiltDegrees: 20, widthM: 20, depthM: 10 }],
    inverters,
    ...over,
  });
const entry = (parallel: number, id = 'e1', inverterId = INV) => ({
  id,
  inverterId,
  mppts: [{ strings: [group(6, parallel)] }],
});
const input = (d: EngineeringDesign, over: Partial<ProtectionInput> = {}): ProtectionInput => ({
  design: d,
  modules: { [M1]: mod },
  inverters: { [INV]: inv, [MICRO]: micro, [T3]: tri },
  catalog,
  parameters: rules,
  ...over,
});
const find = (r: ReturnType<typeof evaluateProtections>, role: string) =>
  r.items.filter((i) => i.role === role);

describe('três strings em paralelo exigem fusível em cada string (EnergIF p. 169)', () => {
  const r = evaluateProtections(input(design([entry(3)])));

  it('sugere o menor fusível que atende: In de 17,48 A a 25 A e tensão ≥ 314,3 V → 20 A / 1000 V', () => {
    const [fuse] = find(r, 'STRING_FUSE');
    expect(fuse).toMatchObject({ quantity: 3, outcome: 'OK', manual: false, mpptIndex: 0 });
    expect(fuse?.currentMinA).toBeCloseTo(17.475, 3);
    expect(fuse?.currentMaxA).toBe(25);
    expect(fuse?.voltageMinV).toBeCloseTo(6 * 52.384, 2);
    expect(fuse?.chosen?.label).toBe('Fusível 20 A');
    expect(fuse?.justification).toMatch(/Menor item aprovado que atende/);
    expect(fuse?.requirement).toBe('corrente de 17,48 A a 25 A; tensão ≥ 314,3 V');
    expect(fuse?.source).toMatch(/EF-R12/);
  });

  it('seccionadora pelo curto-circuito de 3 strings (1,25 × 13,98 × 3 = 52,4 A → 63 A) e DPS pela tensão', () => {
    expect(find(r, 'DC_DISCONNECTOR')[0]).toMatchObject({ outcome: 'OK', quantity: 1 });
    expect(find(r, 'DC_DISCONNECTOR')[0]?.chosen?.label).toBe('Seccionadora 63 A');
    expect(find(r, 'DC_DISCONNECTOR')[0]?.currentMinA).toBeCloseTo(52.425, 3);
    expect(find(r, 'DC_SURGE')[0]?.chosen?.label).toBe('DPS 600 V');
  });

  it('disjuntor CA (1,25 × 25 A = 31,25 A → 32 A) e DR de 30 mA com corrente do disjuntor', () => {
    expect(find(r, 'AC_BREAKER')[0]?.chosen?.label).toBe('Disjuntor 32 A');
    expect(find(r, 'RCD')[0]?.chosen?.label).toBe('DR 40 A / 30 mA'); // o de 25 A não cobre os 32 A do disjuntor; o de 300 mA não atende a sensibilidade
    expect(find(r, 'RCD')[0]?.sensitivityMaxMa).toBe(30);
  });

  it('tudo escolhido e sem pendência: VÁLIDO', () => {
    expect(r.pending).toEqual([]);
    expect(r.status).toBe('VALID');
    expect(r.algorithmVersion).toBe('protection-1.0.0');
  });
});

describe('duas strings ou menos dispensam o fusível', () => {
  it('não gera item de fusível, mas a seccionadora e o DPS continuam', () => {
    const r = evaluateProtections(input(design([entry(2)])));
    expect(find(r, 'STRING_FUSE')).toEqual([]);
    expect(find(r, 'DC_DISCONNECTOR')[0]?.chosen?.label).toBe('Seccionadora 63 A'); // 1,25 × 13,98 × 2 = 34,95 A > 32
  });
  it('uma string: a seccionadora de 32 A atende (17,5 A)', () => {
    const r = evaluateProtections(input(design([entry(1)])));
    expect(find(r, 'DC_DISCONNECTOR')[0]?.chosen?.label).toBe('Seccionadora 32 A');
  });
});

describe('escolha manual é conferida contra a mesma exigência', () => {
  it('seccionadora de 32 A para 3 strings não atende: item reprovado e projeto INVÁLIDO', () => {
    const d = design([entry(3)], {
      protectionOverrides: [
        {
          id: 'o1',
          role: 'DC_DISCONNECTOR',
          inverterEntryId: 'e1',
          mpptIndex: 0,
          equipmentId: id(5),
        },
      ],
    });
    const r = evaluateProtections(input(d));
    const item = find(r, 'DC_DISCONNECTOR')[0];
    expect(item).toMatchObject({ manual: true, outcome: 'OVERRIDE_FAILS' });
    expect(item?.justification).toMatch(/NÃO atende/);
    expect(r.status).toBe('INVALID');
  });

  it('item que atende é aceito e marcado como escolha manual; item de outro tipo é recusado', () => {
    const ok = evaluateProtections(
      input(
        design([entry(3)], {
          protectionOverrides: [
            { id: 'o1', role: 'DC_SURGE', inverterEntryId: 'e1', mpptIndex: 0, equipmentId: id(8) },
          ],
        }),
      ),
    );
    expect(find(ok, 'DC_SURGE')[0]).toMatchObject({ manual: true, outcome: 'OK' });
    expect(find(ok, 'DC_SURGE')[0]?.chosen?.label).toBe('DPS 1000 V');
    const wrong = evaluateProtections(
      input(
        design([entry(3)], {
          protectionOverrides: [
            { id: 'o1', role: 'DC_SURGE', inverterEntryId: 'e1', mpptIndex: 0, equipmentId: id(1) },
          ],
        }),
      ),
    );
    expect(find(wrong, 'DC_SURGE')[0]).toMatchObject({ outcome: 'OVERRIDE_FAILS' });
  });
});

describe('sem item que atenda, sem regra e sem dado', () => {
  it('catálogo sem fusível adequado: NONE_AVAILABLE e INVÁLIDO, com o que cadastrar', () => {
    const only = catalog.filter((c) => c.spec.protectionKind !== 'FUSE_DC');
    const r = evaluateProtections(input(design([entry(3)]), { catalog: only }));
    const fuse = find(r, 'STRING_FUSE')[0];
    expect(fuse).toMatchObject({ outcome: 'NONE_AVAILABLE', chosen: null });
    expect(fuse?.justification).toMatch(/Cadastre e aprove/);
    expect(r.status).toBe('INVALID');
  });

  it('sem a regra engine.design cada fator vira pendência de regra (nada é presumido)', () => {
    const r = evaluateProtections(input(design([entry(3)]), { parameters: {} }));
    expect(r.pending.map((x) => x.code)).toEqual([
      'RULE_MAX_PARALLEL_STRINGS',
      'RULE_DC_SWITCH_FACTOR',
      'RULE_AC_BREAKER_FACTOR',
      'RULE_RCD_SENSITIVITY',
    ]);
    // o DPS depende só da tensão da string, não de fator de regra
    expect(r.items.filter((i) => i.role !== 'DC_SURGE').every((i) => i.outcome === 'PENDING')).toBe(
      true,
    );
    expect(r.status).toBe('INCOMPLETE');
  });

  it('o fator do fusível e o fusível máximo da ficha também são pendência', () => {
    const noFactor = evaluateProtections(
      input(design([entry(3)]), { parameters: { ...rules, fuseMinFactor: undefined as never } }),
    );
    expect(noFactor.pending.map((x) => x.code)).toContain('RULE_FUSE_MIN_FACTOR');
    const { maxSeriesFuseA: _m, ...noMax } = mod;
    const noFuseMax = evaluateProtections(input(design([entry(3)]), { modules: { [M1]: noMax } }));
    expect(noFuseMax.pending.map((x) => x.code)).toContain('MODULE_MAX_FUSE_MISSING');
    expect(noFuseMax.pending.find((x) => x.code === 'MODULE_MAX_FUSE_MISSING')?.kind).toBe('DATA');
  });

  it('sem a temperatura mínima não há tensão para as proteções CC', () => {
    const d = design([entry(3)], {
      site: { latitude: -15.78, longitude: -47.93, designTminC: null, designTmaxAmbientC: 35 },
    });
    const r = evaluateProtections(input(d));
    expect(r.pending.map((x) => x.code)).toContain('TMIN_MISSING');
    expect(find(r, 'DC_SURGE')[0]?.outcome).toBe('PENDING');
    expect(r.status).toBe('INCOMPLETE');
  });

  it('o fator máximo da regra limita o fusível máximo da ficha (fuseMaxFactor × Isc)', () => {
    const r = evaluateProtections(
      input(design([entry(3)]), { parameters: { ...rules, fuseMaxFactor: 1.4 } }),
    );
    const [fuse] = find(r, 'STRING_FUSE');
    expect(fuse?.currentMaxA).toBeCloseTo(1.4 * (17.475 / 1.25), 3);
    // 20 A passa de 1,4 × Isc (19,57 A): o catálogo de teste não tem fusível na faixa.
    expect(fuse?.outcome).toBe('NONE_AVAILABLE');
    // Sem o fator máximo, vale só o fusível máximo da ficha.
    expect(
      find(evaluateProtections(input(design([entry(3)]))), 'STRING_FUSE')[0]?.currentMaxA,
    ).toBe(25);
  });

  it('fusível máximo da ficha menor que o mínimo calculado: faixa vazia, nenhum item serve', () => {
    const r = evaluateProtections(
      input(design([entry(3)]), { modules: { [M1]: { ...mod, maxSeriesFuseA: 15 } } }),
    );
    expect(find(r, 'STRING_FUSE')[0]?.outcome).toBe('NONE_AVAILABLE');
  });

  it('sem inversores: pendência e INCOMPLETO', () => {
    const r = evaluateProtections(input(design([])));
    expect(r.pending.map((x) => x.code)).toEqual(['NO_INVERTERS']);
    expect(r.status).toBe('INCOMPLETE');
  });
});

describe('lado CA: microinversor e trifásico', () => {
  it('microinversor: só proteção CA, com a potência de todas as unidades (5 × 1 kW / 220 V = 22,7 A → 28,4 A → 32 A)', () => {
    const r = evaluateProtections(
      input(
        design([
          {
            id: 'm1',
            inverterId: MICRO,
            mppts: [],
            micro: { surfaceId: 's1', units: 5, modulesPerUnit: 2 },
          },
        ]),
      ),
    );
    expect(r.items.map((i) => i.role)).toEqual(['AC_BREAKER', 'RCD']);
    expect(find(r, 'AC_BREAKER')[0]?.currentMinA).toBeCloseTo(1.25 * (5000 / 220), 2);
    expect(find(r, 'AC_BREAKER')[0]?.chosen?.label).toBe('Disjuntor 32 A');
  });

  it('trifásico: corrente = P / (√3 · V) = 15,19 A → 18,99 A e exige 3 polos ou mais', () => {
    const r = evaluateProtections(
      input(design([{ id: 't1', inverterId: T3, mppts: [{ strings: [group(6, 1)] }] }])),
    );
    const b = find(r, 'AC_BREAKER')[0];
    expect(b?.currentMinA).toBeCloseTo((1.25 * 10000) / (Math.sqrt(3) * 380), 2);
    expect(b?.chosen?.label).toBe('Disjuntor 25 A trifásico'); // os de 2 polos ficam de fora
  });
});

describe('desempate e determinismo', () => {
  it('mesma corrente e tensão: o mais barato; depois o id', () => {
    const cheap = p(20, { protectionKind: 'SURGE_DC', ratedVoltageV: 600 }, 5000, 'DPS barato');
    const r = evaluateProtections(input(design([entry(1)]), { catalog: [...catalog, cheap] }));
    expect(find(r, 'DC_SURGE')[0]?.chosen?.label).toBe('DPS barato');
    const again = evaluateProtections(
      input(design([entry(1)]), { catalog: [...catalog, cheap].reverse() }),
    );
    expect(again.items).toEqual(r.items);
  });
});
