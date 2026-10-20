import { describe, expect, it } from 'vitest';
import { engineeringDesignSchema, surfaceSchema, type EngineeringDesign } from '@voltex/shared';
import { computeEngineeringResults } from './project.js';

const MODULE_ID = '0198a000-0000-7000-8000-000000000001';
const MODULE = { lengthMm: 2278, widthMm: 1134, pmaxWp: 550 };

const design = (over: Partial<EngineeringDesign> = {}): EngineeringDesign =>
  engineeringDesignSchema.parse({
    site: { latitude: -15.78, longitude: -47.93 },
    surfaces: [
      { id: 's1', name: 'Água norte', azimuthDegrees: 0, tiltDegrees: 20, widthM: 10, depthM: 5 },
    ],
    ...over,
  });

describe('resultados do projeto', () => {
  it('sem módulo escolhido há pendência e a potência fica nula', () => {
    const r = computeEngineeringResults(design(), { modules: {} });
    expect(r.pending.map((p) => p.code)).toEqual(['MODULE_NOT_SELECTED']);
    expect(r.totals.powerKwp).toBeNull();
    expect(r.layout[0]?.fitCount).toBe(0);
    expect(r.shading).toHaveLength(1);
  });

  it('módulo fora do catálogo é pendência diferente', () => {
    const r = computeEngineeringResults(design({ defaultModuleId: MODULE_ID }), { modules: {} });
    expect(r.pending.map((p) => p.code)).toEqual(['MODULE_NOT_FOUND']);
  });

  it('sem superfícies avisa', () => {
    const r = computeEngineeringResults(design({ surfaces: [] }), { modules: {} });
    expect(r.pending.map((p) => p.code)).toEqual(['NO_SURFACES']);
    expect(r.totals).toEqual({ moduleCount: 0, powerKwp: null, moduleAreaM2: null });
  });

  it('com módulo calcula layout, potência e sombra; o módulo da superfície vence o padrão', () => {
    const other = '0198a000-0000-7000-8000-000000000002';
    const d = design({
      defaultModuleId: MODULE_ID,
      surfaces: [
        surfaceSchema.parse({
          id: 's1',
          name: 'A',
          azimuthDegrees: 0,
          tiltDegrees: 20,
          widthM: 10,
          depthM: 5,
        }),
        surfaceSchema.parse({
          id: 's2',
          name: 'B',
          azimuthDegrees: 90,
          tiltDegrees: 20,
          widthM: 10,
          depthM: 5,
          moduleId: other,
        }),
      ],
    });
    const r = computeEngineeringResults(d, {
      modules: { [MODULE_ID]: MODULE, [other]: { lengthMm: 1700, widthMm: 1000, pmaxWp: 400 } },
    });
    expect(r.pending).toEqual([]);
    expect(r.layout[0]).toMatchObject({ moduleId: MODULE_ID, moduleCount: 8, powerKwp: 4.4 });
    expect(r.layout[1]?.moduleId).toBe(other);
    expect(r.totals.moduleCount).toBe(r.layout[0]!.moduleCount + r.layout[1]!.moduleCount);
    expect(r.totals.powerKwp).toBeCloseTo(
      (r.layout[0]!.powerKwp as number) + (r.layout[1]!.powerKwp as number),
      3,
    );
    expect(r.algorithmVersions).toMatchObject({ layout: 'layout-1.0.0', shading: 'shading-1.0.0' });
  });

  it('avisa que sem horizonte e sem obstáculos a perda por sombra é zero', () => {
    const r = computeEngineeringResults(design({ defaultModuleId: MODULE_ID }), {
      modules: { [MODULE_ID]: MODULE },
    });
    expect(r.shading[0]?.warnings.join(' ')).toMatch(/Sem perfil de horizonte/);
  });

  it('perda informada à mão substitui o cálculo e guarda a fonte', () => {
    const d = design({
      defaultModuleId: MODULE_ID,
      surfaces: [
        surfaceSchema.parse({
          id: 's1',
          name: 'A',
          azimuthDegrees: 0,
          tiltDegrees: 20,
          widthM: 10,
          depthM: 5,
          shadingLossOverride: { pct: 7.5, source: 'Visita técnica com Solmetric' },
        }),
      ],
    });
    const r = computeEngineeringResults(d, { modules: { [MODULE_ID]: MODULE } });
    expect(r.shading[0]).toMatchObject({
      overridden: true,
      annualLossPct: 7.5,
      overrideSource: 'Visita técnica com Solmetric',
    });
    expect(r.shading[0]?.monthlyLossPct).toEqual(Array(12).fill(7.5));
    expect(r.shading[0]?.warnings.join(' ')).toMatch(/informada à mão/);
  });
});
