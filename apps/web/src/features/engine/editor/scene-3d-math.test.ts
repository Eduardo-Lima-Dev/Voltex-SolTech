import { describe, expect, it } from 'vitest';
import { surfaceSchema, obstacleSchema, type SurfaceLayoutResult } from '@voltex/shared';
import { buildScene, obstacleBox, project, projectScene, surfacePoint } from './scene-3d-math';

const surface = (over: Record<string, unknown> = {}) =>
  surfaceSchema.parse({
    id: 's1',
    name: 'Norte',
    azimuthDegrees: 0,
    tiltDegrees: 30,
    widthM: 10,
    depthM: 6,
    ...over,
  });
const origin = { x: 0, y: 0, z: 0 };

describe('geometria da superfície', () => {
  it('a cumeeira fica mais alta que o beiral: z = profundidade × sen(inclinação)', () => {
    const s = surface();
    expect(surfacePoint(s, origin, 0, 0).z).toBeCloseTo(0, 9);
    expect(surfacePoint(s, origin, 0, 6).z).toBeCloseTo(6 * Math.sin((30 * Math.PI) / 180), 9);
  });

  it('face para o norte: o beiral baixo fica ao norte (y positivo) e a água sobe para o sul', () => {
    const s = surface();
    const low = surfacePoint(s, origin, 0, 0);
    const high = surfacePoint(s, origin, 0, 6);
    expect(low.y).toBeGreaterThan(0);
    expect(high.y).toBeLessThan(0);
    expect(low.y).toBeCloseTo((6 * Math.cos((30 * Math.PI) / 180)) / 2, 9);
    expect(low.y + -high.y).toBeCloseTo(6 * Math.cos((30 * Math.PI) / 180), 9);
  });

  it('a largura corre ao longo do beiral (leste–oeste numa face norte)', () => {
    const s = surface();
    const a = surfacePoint(s, origin, -5, 0);
    const b = surfacePoint(s, origin, 5, 0);
    expect(b.x - a.x).toBeCloseTo(10, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  });
});

describe('obstáculo e sombra', () => {
  const obstacle = obstacleSchema.parse({
    id: 'o1',
    name: 'Caixa dagua',
    azimuthDegrees: 90,
    distanceM: 4,
    heightM: 3,
    widthM: 2,
  });

  it('fica na direção e na distância informadas, com a altura da ficha', () => {
    const { base, top } = obstacleBox(obstacle, origin);
    const cx = base.reduce((s, p) => s + p.x, 0) / 4;
    const cy = base.reduce((s, p) => s + p.y, 0) / 4;
    expect(cx).toBeCloseTo(4, 9);
    expect(cy).toBeCloseTo(0, 9);
    expect(top.every((p) => p.z === 3)).toBe(true);
  });

  it('a sombra cai para o lado oposto ao sol e tem o comprimento altura/tg(elevação)', () => {
    const polys = buildScene([surface({ obstacles: [obstacle] })], [], {
      azimuthDegrees: 90,
      elevationDegrees: 45,
    });
    const shadow = polys.find((p) => p.kind === 'SHADOW')!;
    // Sol a leste, 45°: sombra de 3 m para oeste (x diminui) a partir do obstáculo.
    const minX = Math.min(...shadow.points.map((p) => p.x));
    const surfaceCenterX =
      Math.max(...polys.find((p) => p.kind === 'GROUND')!.points.map((p) => p.x)) - 5;
    expect(minX).toBeLessThan(surfaceCenterX + 4 - 2.9);
  });

  it('sol baixo demais ou sem sol não gera sombra', () => {
    expect(
      buildScene([surface({ obstacles: [obstacle] })], [], {
        azimuthDegrees: 90,
        elevationDegrees: 1,
      }).some((p) => p.kind === 'SHADOW'),
    ).toBe(false);
    expect(
      buildScene([surface({ obstacles: [obstacle] })], [], null).some((p) => p.kind === 'SHADOW'),
    ).toBe(false);
  });
});

describe('cena e câmera', () => {
  const layout: SurfaceLayoutResult = {
    surfaceId: 's1',
    moduleId: null,
    fitCount: 2,
    moduleCount: 2,
    rows: 1,
    columns: 2,
    usableWidthM: 9,
    usableDepthM: 5,
    rowSpacingM: null,
    minRowSpacingM: null,
    powerKwp: 1.1,
    moduleAreaM2: 5,
    warnings: [],
    rects: [
      { x: 0, y: 0, w: 1.1, h: 2.3 },
      { x: 1.12, y: 0, w: 1.1, h: 2.3 },
    ],
  };

  it('monta chão, telhado e um polígono por módulo; várias superfícies lado a lado sem se sobrepor', () => {
    const polys = buildScene(
      [surface(), surface({ id: 's2', name: 'Leste', azimuthDegrees: 90 })],
      [layout],
      null,
    );
    expect(polys.filter((p) => p.kind === 'MODULE')).toHaveLength(2);
    expect(polys.filter((p) => p.kind === 'ROOF').map((p) => p.label)).toEqual(['Norte', 'Leste']);
    const roofs = polys.filter((p) => p.kind === 'ROOF');
    const maxX0 = Math.max(...roofs[0]!.points.map((p) => p.x));
    const minX1 = Math.min(...roofs[1]!.points.map((p) => p.x));
    expect(minX1).toBeGreaterThan(maxX0);
  });

  it('projeção: de cima (90°) o z some; de frente (0°) a altura vira o eixo vertical da tela', () => {
    expect(project({ x: 1, y: 2, z: 5 }, 0, 90).y).toBeCloseTo(-2, 9);
    const front = project({ x: 1, y: 2, z: 5 }, 0, 0);
    expect(front.x).toBeCloseTo(1, 9);
    expect(front.y).toBeCloseTo(-5, 9);
  });

  it('ordem de desenho: chão e sombra por baixo, módulos por cima do telhado; viewBox cobre a cena', () => {
    const polys = buildScene(
      [
        surface({
          obstacles: [
            obstacleSchema.parse({
              id: 'o',
              name: 'X',
              azimuthDegrees: 90,
              distanceM: 4,
              heightM: 3,
              widthM: 2,
            }),
          ],
        }),
      ],
      [layout],
      { azimuthDegrees: 100, elevationDegrees: 40 },
    );
    const { polygons, viewBox } = projectScene(polys, 30, 35);
    expect(polygons[0]!.kind).toBe('GROUND');
    expect(polygons.at(-1)!.kind === 'MODULE' || polygons.at(-1)!.kind === 'OBSTACLE').toBe(true);
    const order = polygons.map((p) => p.kind);
    expect(order.indexOf('SHADOW')).toBeLessThan(order.indexOf('ROOF'));
    expect(order.lastIndexOf('ROOF')).toBeLessThan(order.indexOf('MODULE'));
    expect(viewBox.split(' ')).toHaveLength(4);
    expect(projectScene([], 0, 0).viewBox).toBe('0 0 10 10');
  });
});
