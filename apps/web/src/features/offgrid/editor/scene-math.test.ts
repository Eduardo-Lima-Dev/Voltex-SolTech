import { describe, expect, it } from 'vitest';
import { offgridLayoutElementSchema } from '@voltex/shared';
import {
  arrayPoint,
  buildOffgridScene,
  elementCorners,
  projectOffgridScene,
  shadowOfPoints,
} from './scene-math';

const el = (over: object = {}) =>
  offgridLayoutElementSchema.parse({
    id: 'e',
    kind: 'HOUSE',
    name: 'Casa',
    positionM: { x: 10, y: 10 },
    widthM: 4,
    depthM: 2,
    heightM: 3,
    ...over,
  });
const arr = {
  id: 'a',
  center: { x: 5, y: 5 },
  azimuthDegrees: 0,
  tiltDegrees: 30,
  columns: 2,
  rows: 1,
  widthM: 2.3,
  slopeM: 2.3,
  baseHeightM: 0.5,
};

describe('cena do terreno', () => {
  it('gira a construção em torno do centro', () => {
    const c0 = elementCorners(el());
    expect(c0[0]).toEqual({ x: 8, y: 9 });
    const c90 = elementCorners(el({ rotationDeg: 90 }));
    expect(c90[0]?.x).toBeCloseTo(9, 5);
    expect(c90[0]?.y).toBeCloseTo(12, 5);
  });

  it('a mesa voltada ao norte tem a borda baixa ao norte e sobe para o sul', () => {
    const low = arrayPoint(arr, 0, 0);
    const high = arrayPoint(arr, 0, arr.slopeM);
    expect(low.y).toBeGreaterThan(high.y);
    expect(high.z).toBeGreaterThan(low.z);
    expect(low.z).toBe(0.5);
  });

  it('a sombra cai para o lado oposto ao sol e some com o sol baixo', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 3 },
      { x: 0, y: 1, z: 3 },
    ];
    const shadow = shadowOfPoints(points, { azimuthDegrees: 180, elevationDegrees: 45 });
    // Sol ao sul: sombra para o norte (y maior).
    expect(Math.max(...(shadow ?? []).map((p) => p.y))).toBeCloseTo(4, 5);
    expect(shadowOfPoints(points, { azimuthDegrees: 180, elevationDegrees: 1 })).toBeNull();
  });

  it('monta chão, sombras, faces e células, e projeta em ordem de profundidade', () => {
    const polys = buildOffgridScene({
      lot: { widthM: 20, depthM: 20 },
      elements: [el(), el({ id: 'flat', heightM: 0, positionM: { x: 3, y: 15 } })],
      arrays: [arr],
      sun: { azimuthDegrees: 90, elevationDegrees: 40 },
    });
    const kinds = polys.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'SIDE')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'CELL')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'SHADOW')).toHaveLength(2);
    const projected = projectOffgridScene(polys, 25, 35);
    expect(projected.polygons[0]?.kind).toBe('GROUND');
    expect(projected.polygons.at(-1)?.kind).toBe('CELL');
    expect(projected.viewBox.split(' ')).toHaveLength(4);
    expect(projected.project({ x: 0, y: 0, z: 0 })).toHaveProperty('x');
    const noSun = buildOffgridScene({
      lot: { widthM: 5, depthM: 5 },
      elements: [],
      arrays: [],
      sun: { azimuthDegrees: 0, elevationDegrees: 0 },
    });
    expect(noSun).toHaveLength(1);
  });
});
