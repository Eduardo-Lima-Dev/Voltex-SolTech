import { describe, expect, it } from 'vitest';
import type { EngineeringResults } from '@voltex/shared';
import { compareVersions, MAX_DESIGN_CHANGES } from './compare.js';

const results = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    totals: { moduleCount: 10, powerKwp: 5.5, moduleAreaM2: 26 },
    compatibility: { status: 'VALID' },
    protection: { status: 'VALID' },
    cables: { status: 'VALID' },
    bom: { totalCents: 1000 },
    ...over,
  }) as unknown as EngineeringResults;

describe('compareVersions', () => {
  const a = {
    site: { latitude: -15, longitude: -47 },
    surfaces: [
      { id: 's1', tiltDegrees: 20 },
      { id: 's2', tiltDegrees: 10 },
    ],
    cables: [{ id: 'c1', lengthM: 10 }],
  };

  it('lista o que mudou no desenho, com itens de lista identificados pelo id', () => {
    const b = {
      site: { latitude: -15, longitude: -47, designTminC: 5 },
      surfaces: [{ id: 's1', tiltDegrees: 25 }],
      cables: [
        { id: 'c1', lengthM: 10 },
        { id: 'c2', lengthM: 4 },
      ],
    };
    const r = compareVersions({ design: a, results: null }, { design: b, results: null });
    expect(r.designChanges).toEqual([
      {
        section: 'cables',
        path: 'cables[c2]',
        kind: 'ADDED',
        before: undefined,
        after: { id: 'c2', lengthM: 4 },
      },
      { section: 'site', path: 'site.designTminC', kind: 'ADDED', before: undefined, after: 5 },
      {
        section: 'surfaces',
        path: 'surfaces[s1].tiltDegrees',
        kind: 'CHANGED',
        before: 20,
        after: 25,
      },
      {
        section: 'surfaces',
        path: 'surfaces[s2]',
        kind: 'REMOVED',
        before: { id: 's2', tiltDegrees: 10 },
        after: undefined,
      },
    ]);
    expect(r.truncated).toBe(false);
  });

  it('desenhos iguais não geram mudanças; itens sem id usam o índice', () => {
    expect(
      compareVersions({ design: a, results: null }, { design: a, results: null }).designChanges,
    ).toEqual([]);
    const r = compareVersions(
      { design: { list: [1, 2] }, results: null },
      { design: { list: [1, 3] }, results: null },
    );
    expect(r.designChanges[0]).toMatchObject({ path: 'list[1]', before: 2, after: 3 });
  });

  it('compara os indicadores dos resultados com a diferença numérica', () => {
    const r = compareVersions(
      { design: {}, results: results() },
      {
        design: {},
        results: results({
          totals: { moduleCount: 12, powerKwp: 6.6 },
          protection: { status: 'INVALID' },
          bom: { totalCents: 1500 },
        }),
      },
    );
    expect(r.resultChanges.map((c) => c.metric)).toEqual([
      'modules',
      'powerKwp',
      'protection',
      'bomTotal',
    ]);
    expect(r.resultChanges[0]).toMatchObject({ before: 10, after: 12, delta: 2 });
    expect(r.resultChanges[1]?.delta).toBeCloseTo(1.1, 6);
    expect(r.resultChanges[2]).toMatchObject({ before: 'VALID', after: 'INVALID', delta: null });
  });

  it('versão sem resultados vira nulo; muitas mudanças são cortadas e sinalizadas', () => {
    const r = compareVersions({ design: {}, results: null }, { design: {}, results: results() });
    expect(r.resultChanges[0]).toMatchObject({ before: null, after: 10, delta: null });
    const many = Object.fromEntries(
      Array.from({ length: MAX_DESIGN_CHANGES + 5 }, (_, i) => [`k${i}`, i]),
    );
    const big = compareVersions({ design: {}, results: null }, { design: many, results: null });
    expect(big.designChanges).toHaveLength(MAX_DESIGN_CHANGES);
    expect(big.truncated).toBe(true);
  });
});
