import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { solarPosition } from './position.js';

interface GoldenFile {
  reference: string;
  toleranceElevationDegrees: number;
  toleranceAzimuthDegrees: number;
  cases: {
    id: string;
    input: { at: string; latitudeDegrees: number; longitudeDegrees: number };
    expected: { elevationDegrees: number; azimuthDegrees: number };
  }[];
}

const golden = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tools/golden/cases/solar-position.json'), 'utf8'),
) as GoldenFile;

/** Casos de ouro (pvlib/NREL SPA): ver `tools/golden/README.md`. */
describe('posição solar × casos de ouro', () => {
  it('há casos carregados', () => {
    expect(golden.cases.length).toBeGreaterThan(20);
  });

  it.each(golden.cases)('$id', ({ input, expected }) => {
    const r = solarPosition({
      at: new Date(input.at),
      latitudeDegrees: input.latitudeDegrees,
      longitudeDegrees: input.longitudeDegrees,
    });
    expect(Math.abs(r.elevationDegrees - expected.elevationDegrees)).toBeLessThan(
      golden.toleranceElevationDegrees,
    );
    // Perto do zênite o azimute varia muito por pequenas diferenças: só confere com o sol a mais de 5° do zênite.
    if (r.zenithDegrees > 5) {
      const diff = Math.abs(((r.azimuthDegrees - expected.azimuthDegrees + 540) % 360) - 180);
      expect(diff).toBeLessThan(golden.toleranceAzimuthDegrees);
    }
  });
});
