import { describe, expect, it } from 'vitest';
import { arrayFootprint, computeLayout, resolveArrayCenters, sectionForDrop } from './layout.js';
import { computeOffgridResults } from './project.js';
import { IDS, baseContext, baseDesign } from './fixtures.js';

const element = (over: Record<string, unknown>) => ({
  id: String(over.kind),
  name: String(over.kind),
  widthM: 4,
  depthM: 4,
  heightM: 3,
  rotationDeg: 0,
  ...over,
});

const design = (elements: object[], patch: Record<string, unknown> = {}) =>
  baseDesign({
    layout: { lotWidthM: 40, lotDepthM: 30, elements, ...patch },
    arrays: [
      {
        id: 'a1',
        name: 'Telhado',
        moduleId: IDS.module,
        modulesInSeries: 4,
        parallelStrings: 2,
        azimuthDegrees: 0,
        tiltDegrees: 15,
        positionM: { x: 20, y: 20 },
      },
    ],
  });

const run = (d = design([]), peakW = 1500) =>
  computeLayout({
    design: d,
    modules: baseContext().modules,
    inverter: baseContext().inverters[IDS.inverter],
    peakW,
    generatorW: 3500,
  });

describe('pegada dos arranjos', () => {
  it('módulos em retrato: colunas = série, fileiras = strings', () => {
    const f = arrayFootprint(
      { modulesInSeries: 4, parallelStrings: 2, tiltDegrees: 0 },
      { lengthMm: 2000, widthMm: 1000 },
    );
    expect(f.widthM).toBeCloseTo(4 * 1 + 3 * 0.02, 2);
    expect(f.depthM).toBeCloseTo(2 * 2 + 0.02, 2);
    expect(f.topHeightM).toBe(0);
    const tilted = arrayFootprint(
      { modulesInSeries: 1, parallelStrings: 1, tiltDegrees: 30 },
      undefined,
    );
    expect(tilted.topHeightM).toBeCloseTo(2.278 * 0.5, 2);
    expect(tilted.depthM).toBeLessThan(tilted.slopeDepthM);
  });

  it('sem posição, os arranjos ficam lado a lado no fundo do terreno', () => {
    const arrays = [
      {
        id: 'a',
        name: 'A',
        modulesInSeries: 2,
        parallelStrings: 1,
        azimuthDegrees: 0,
        tiltDegrees: 10,
      },
      {
        id: 'b',
        name: 'B',
        modulesInSeries: 2,
        parallelStrings: 1,
        azimuthDegrees: 0,
        tiltDegrees: 10,
        positionM: { x: 9, y: 9 },
      },
      {
        id: 'c',
        name: 'C',
        modulesInSeries: 2,
        parallelStrings: 1,
        azimuthDegrees: 0,
        tiltDegrees: 10,
      },
    ];
    const f = { widthM: 2.3, depthM: 2 };
    const centers = resolveArrayCenters(arrays, [f, f, f], 20);
    expect(centers[1]).toEqual({ x: 9, y: 9 });
    expect(centers[2]?.x).toBeGreaterThan(centers[0]?.x ?? 0);
    expect(centers[0]?.y).toBeGreaterThan(10);
  });
});

describe('seção pela queda de tensão', () => {
  it('S = ρ·2·d·I/ΔV e a comercial seguinte', () => {
    const r = sectionForDrop({ distanceM: 20, currentA: 20, voltageV: 120, dropPct: 3 });
    const rho = 0.01724 * (1 + 0.0039 * 50);
    expect(r.minSectionMm2).toBeCloseTo((rho * 2 * 20 * 20) / 3.6, 1);
    expect(r.suggestedSectionMm2).toBe(6);
    expect(r.dropPctAtSuggested).toBeLessThanOrEqual(3);
  });
  it('acima de 240 mm² não há seção comercial', () => {
    const r = sectionForDrop({ distanceM: 500, currentA: 400, voltageV: 12, dropPct: 1 });
    expect(r.suggestedSectionMm2).toBeNull();
    expect(r.dropPctAtSuggested).toBeNull();
  });
  it('queda zero não divide por zero', () => {
    expect(
      sectionForDrop({ distanceM: 1, currentA: 1, voltageV: 10, dropPct: 0 }).minSectionMm2,
    ).toBe(0);
  });
});

describe('layout do terreno', () => {
  const full = [
    element({ kind: 'POWER_ROOM', name: 'Casa de máquinas', positionM: { x: 20, y: 10 } }),
    element({
      kind: 'HOUSE',
      name: 'Casa',
      positionM: { x: 10, y: 8 },
      widthM: 8,
      depthM: 6,
      heightM: 3.5,
    }),
    element({ kind: 'GENERATOR', name: 'Gerador', positionM: { x: 30, y: 8 } }),
    element({ kind: 'GRID_POLE', name: 'Poste', positionM: { x: 38, y: 2 }, heightM: 0 }),
  ];

  it('calcula os trajetos de cabo com distância, corrente e seção', () => {
    const r = run(design(full, { cableSlackPct: 0 }));
    const kinds = r.runs.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['DC_PV', 'AC_LOAD', 'AC_GENERATOR', 'DC_BANK']));
    expect(kinds).not.toContain('AC_GRID');
    const pv = r.runs.find((x) => x.kind === 'DC_PV');
    expect(pv?.distanceM).toBeCloseTo(10, 1);
    expect(pv?.currentA).toBeCloseTo(2 * 13.25, 1);
    expect(pv?.voltageV).toBeCloseTo(4 * 41.5, 1);
    expect(pv?.suggestedSectionMm2).toBeGreaterThanOrEqual(pv?.minSectionMm2 ?? 0);
    expect(r.totalCableM).toBeGreaterThan(0);
    expect(r.runs.find((x) => x.kind === 'DC_BANK')?.distanceM).toBe(1.5);
  });

  it('a folga aumenta o percurso e a rede só entra no híbrido', () => {
    const base = run(design(full, { cableSlackPct: 0 }));
    const slack = run(design(full, { cableSlackPct: 20 }));
    expect(slack.runs[0]?.distanceM).toBeCloseTo((base.runs[0]?.distanceM ?? 0) * 1.2, 1);
    const hybrid = run(baseDesign({ ...design(full), systemType: 'HYBRID' } as never));
    expect(hybrid.runs.map((x) => x.kind)).toContain('AC_GRID');
  });

  it('avisa quando falta a casa de máquinas ou a casa, e quando algo sai do terreno ou se sobrepõe', () => {
    expect(run(design([])).warnings.join(' ')).toContain('casa de máquinas');
    const noHouse = run(design([element({ kind: 'POWER_ROOM', positionM: { x: 20, y: 10 } })]));
    expect(noHouse.warnings.join(' ')).toContain('casa (cargas)');
    const out = run(
      design([
        element({ kind: 'TREE', positionM: { x: 60, y: 5 } }),
        element({ kind: 'POWER_ROOM', positionM: { x: 20, y: 22 } }),
      ]),
    );
    expect(out.warnings.join(' ')).toContain('sai dos limites');
    expect(out.warnings.join(' ')).toContain('se sobrepõe');
    const outside = run({
      ...design([]),
      arrays: [{ ...design([]).arrays[0], positionM: { x: -5, y: 5 } }],
    } as never);
    expect(outside.warnings.join(' ')).toContain('sai dos limites do terreno');
  });

  it('a construção ao norte sombreia o arranjo (hemisfério sul) e o ao sul pouco', () => {
    const north = run(
      design([element({ kind: 'HOUSE', positionM: { x: 20, y: 25 }, widthM: 12, heightM: 8 })]),
    );
    const south = run(
      design([element({ kind: 'HOUSE', positionM: { x: 20, y: 5 }, widthM: 12, heightM: 8 })]),
    );
    expect(north.arrays[0]?.annualShadingLossPct).toBeGreaterThan(
      south.arrays[0]?.annualShadingLossPct ?? 100,
    );
    expect(north.arrays[0]?.shadingObstacles).toBe(1);
  });

  it('elemento de altura zero, ou sobre o arranjo, não sombreia', () => {
    const flat = run(design([element({ kind: 'OTHER', positionM: { x: 20, y: 25 }, heightM: 0 })]));
    expect(flat.arrays[0]?.shadingObstacles).toBe(0);
    const on = run(design([element({ kind: 'OTHER', positionM: { x: 20, y: 20 }, heightM: 5 })]));
    expect(on.arrays[0]?.shadingObstacles).toBe(0);
  });

  it('trajeto longo demais para a seção comercial gera aviso', () => {
    const far = design(
      [
        element({ kind: 'POWER_ROOM', positionM: { x: 20, y: 29 } }),
        element({ kind: 'HOUSE', positionM: { x: 20, y: 1 } }),
      ],
      { lotDepthM: 1000, lotWidthM: 1000, maxDropPctAc: 0.1 },
    );
    expect(run(far, 300000).warnings.join(' ')).toContain('240 mm²');
  });

  it('entra nos resultados do projeto', () => {
    const r = computeOffgridResults(design(full), baseContext());
    expect(r.layout?.runs.length).toBeGreaterThan(0);
    expect(r.algorithmVersions.layout).toBe('offgrid-layout-1.0.0');
    expect(computeOffgridResults(baseDesign({ arrays: [] }), baseContext()).layout).toBeNull();
  });
});
