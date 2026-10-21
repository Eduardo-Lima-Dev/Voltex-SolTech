import type { OffgridLayoutElement } from '@voltex/shared';
import {
  convexHull,
  project,
  type SunDirection,
  type Vec3,
} from '../../engine/editor/scene-3d-math';

/**
 * Cena do terreno do Off-Grid (projeção ortográfica em SVG, sem biblioteca). Mundo: x = leste, y = norte, z = para cima,
 * origem no canto sudoeste do terreno. Construções são caixas; arranjos são mesas inclinadas com a grade de módulos.
 */
export type OffgridPolygonKind = 'GROUND' | 'LOT' | 'SHADOW' | 'SIDE' | 'TOP' | 'PANEL' | 'CELL';

export interface OffgridPolygon {
  kind: OffgridPolygonKind;
  points: Vec3[];
  /** Elemento ou arranjo a que pertence (para selecionar clicando). */
  ref?: { type: 'element' | 'array'; id: string };
  elementKind?: OffgridLayoutElement['kind'];
}

export interface SceneArray {
  id: string;
  center: { x: number; y: number };
  azimuthDegrees: number;
  tiltDegrees: number;
  columns: number;
  rows: number;
  /** Dimensões da mesa ao longo do beiral e da inclinação (m). */
  widthM: number;
  slopeM: number;
  baseHeightM: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Cantos de uma construção vistos de cima: (u, v) locais girados pelo giro horário. */
export function elementCorners(element: OffgridLayoutElement): { x: number; y: number }[] {
  const a = rad(element.rotationDeg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = element.widthM / 2;
  const hd = element.depthM / 2;
  return (
    [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as const
  ).map(([u, v]) => ({
    x: element.positionM.x + u * cos + v * sin,
    y: element.positionM.y - u * sin + v * cos,
  }));
}

/** Ponto da mesa: `u` ao longo do beiral (centrado), `v` ao longo da inclinação (0 = borda baixa, voltada para o azimute). */
export function arrayPoint(a: SceneArray, u: number, v: number): Vec3 {
  const az = rad(a.azimuthDegrees);
  const tilt = rad(a.tiltDegrees);
  const face = { x: Math.sin(az), y: Math.cos(az) };
  const eave = { x: Math.cos(az), y: -Math.sin(az) };
  const run = a.slopeM * Math.cos(tilt);
  const along = run / 2 - Math.cos(tilt) * v;
  return {
    x: a.center.x + face.x * along + eave.x * u,
    y: a.center.y + face.y * along + eave.y * u,
    z: a.baseHeightM + v * Math.sin(tilt),
  };
}

/** Sombra no chão de qualquer conjunto de pontos elevados: envoltória convexa dos pontos deslocados pelo sol. */
export function shadowOfPoints(points: Vec3[], sun: SunDirection): Vec3[] | null {
  if (sun.elevationDegrees < 2) return null;
  const az = rad(sun.azimuthDegrees);
  const tan = Math.tan(rad(sun.elevationDegrees));
  const ground = points.map((p) => ({
    x: p.x - (Math.sin(az) * p.z) / tan,
    y: p.y - (Math.cos(az) * p.z) / tan,
  }));
  const base = points.map((p) => ({ x: p.x, y: p.y }));
  return convexHull([...base, ...ground]).map((p) => ({ x: p.x, y: p.y, z: 0.01 }));
}

export function buildOffgridScene(input: {
  lot: { widthM: number; depthM: number };
  elements: readonly OffgridLayoutElement[];
  arrays: readonly SceneArray[];
  sun: SunDirection;
}): OffgridPolygon[] {
  const { lot } = input;
  const polygons: OffgridPolygon[] = [
    {
      kind: 'GROUND',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: lot.widthM, y: 0, z: 0 },
        { x: lot.widthM, y: lot.depthM, z: 0 },
        { x: 0, y: lot.depthM, z: 0 },
      ],
    },
  ];
  for (const element of input.elements) {
    const base = elementCorners(element).map((p) => ({ x: p.x, y: p.y, z: 0 }));
    const top = base.map((p) => ({ ...p, z: element.heightM }));
    const ref = { type: 'element' as const, id: element.id };
    const shadow = shadowOfPoints([...base, ...top], input.sun);
    if (shadow && element.heightM > 0) polygons.push({ kind: 'SHADOW', points: shadow });
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      polygons.push({
        kind: 'SIDE',
        points: [base[i] as Vec3, base[j] as Vec3, top[j] as Vec3, top[i] as Vec3],
        ref,
        elementKind: element.kind,
      });
    }
    polygons.push({ kind: 'TOP', points: top, ref, elementKind: element.kind });
  }
  for (const a of input.arrays) {
    const ref = { type: 'array' as const, id: a.id };
    const corners = [
      arrayPoint(a, -a.widthM / 2, 0),
      arrayPoint(a, a.widthM / 2, 0),
      arrayPoint(a, a.widthM / 2, a.slopeM),
      arrayPoint(a, -a.widthM / 2, a.slopeM),
    ];
    const shadow = shadowOfPoints(corners, input.sun);
    if (shadow) polygons.push({ kind: 'SHADOW', points: shadow });
    // Pés: o plano é elevado do chão; as faces laterais ficam implícitas na sombra.
    polygons.push({ kind: 'PANEL', points: corners, ref });
    for (let c = 0; c < a.columns; c++)
      for (let r = 0; r < a.rows; r++) {
        const cw = a.widthM / a.columns;
        const rh = a.slopeM / a.rows;
        const u0 = -a.widthM / 2 + c * cw + 0.02;
        const v0 = r * rh + 0.02;
        polygons.push({
          kind: 'CELL',
          points: [
            arrayPoint(a, u0, v0),
            arrayPoint(a, u0 + cw - 0.04, v0),
            arrayPoint(a, u0 + cw - 0.04, v0 + rh - 0.04),
            arrayPoint(a, u0, v0 + rh - 0.04),
          ],
          ref,
        });
      }
  }
  return polygons;
}

const ORDER: Record<OffgridPolygonKind, number> = {
  GROUND: 0,
  LOT: 0,
  SHADOW: 1,
  SIDE: 2,
  TOP: 3,
  PANEL: 3,
  CELL: 4,
};

export interface ProjectedOffgridPolygon {
  kind: OffgridPolygonKind;
  points: { x: number; y: number }[];
  ref?: OffgridPolygon['ref'];
  elementKind?: OffgridPolygon['elementKind'];
  depth: number;
  /** Brilho 0–1 da face (laterais mais escuras que o topo). */
  shade: number;
}

export function projectOffgridScene(
  polygons: readonly OffgridPolygon[],
  yawDegrees: number,
  pitchDegrees: number,
): {
  polygons: ProjectedOffgridPolygon[];
  viewBox: string;
  project: (p: Vec3) => { x: number; y: number };
} {
  const out = polygons.map((poly) => {
    const pts = poly.points.map((p) => project(p, yawDegrees, pitchDegrees));
    const depth = pts.reduce((sum, p) => sum + p.depth, 0) / pts.length;
    return {
      kind: poly.kind,
      ...(poly.ref ? { ref: poly.ref } : {}),
      ...(poly.elementKind ? { elementKind: poly.elementKind } : {}),
      points: pts.map(({ x, y }) => ({ x, y })),
      depth,
      shade: poly.kind === 'SIDE' ? 0.6 : 1,
    };
  });
  out.sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      (a.kind === 'GROUND' || a.kind === 'SHADOW' ? 0 : b.depth - a.depth),
  );
  const xs = out.flatMap((p) => p.points.map((q) => q.x));
  const ys = out.flatMap((p) => p.points.map((q) => q.y));
  const pad = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * 0.06);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return {
    polygons: out,
    viewBox: `${minX} ${minY} ${Math.max(...xs) - minX + pad} ${Math.max(...ys) - minY + pad}`,
    project: (p) => {
      const q = project(p, yawDegrees, pitchDegrees);
      return { x: q.x, y: q.y };
    },
  };
}
