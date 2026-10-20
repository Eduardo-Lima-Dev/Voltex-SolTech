import type { Obstacle, Surface, SurfaceLayoutResult } from '@voltex/shared';

/**
 * Cena 3D do projeto (projeção ortográfica em SVG, sem biblioteca): telhado/laje inclinados, módulos do layout,
 * obstáculos como caixas e a sombra deles para um instante do sol. Sistema do mundo: x = leste, y = norte, z = para cima.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PolygonKind = 'GROUND' | 'SHADOW' | 'ROOF' | 'MODULE' | 'OBSTACLE';

export interface ScenePolygon {
  kind: PolygonKind;
  points: Vec3[];
  label?: string;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

/** Pontos de uma superfície: `u` ao longo do beiral (−W/2..W/2) e `v` ao longo da água (0 = beiral baixo .. D = cumeeira). */
export function surfacePoint(surface: Surface, center: Vec3, u: number, v: number): Vec3 {
  const az = rad(surface.azimuthDegrees);
  const tilt = rad(surface.tiltDegrees);
  const face = { x: Math.sin(az), y: Math.cos(az), z: 0 };
  const eave = { x: Math.cos(az), y: -Math.sin(az), z: 0 };
  const run = surface.depthM * Math.cos(tilt);
  // O beiral baixo fica do lado para onde a face aponta; a água sobe para o lado oposto.
  const lower = add(center, scale(face, run / 2));
  return add(add(add(lower, scale(eave, u)), scale(face, -Math.cos(tilt) * v)), {
    x: 0,
    y: 0,
    z: v * Math.sin(tilt),
  });
}

export interface SunDirection {
  azimuthDegrees: number;
  elevationDegrees: number;
}

/** Sombra de uma caixa no chão: envoltória convexa da base e do topo projetado pela direção do sol. */
function shadowOf(base: Vec3[], height: number, sun: SunDirection): Vec3[] | null {
  if (sun.elevationDegrees < 2 || height <= 0) return null;
  const a = rad(sun.azimuthDegrees);
  const e = rad(sun.elevationDegrees);
  const length = height / Math.tan(e);
  // A sombra cai para o lado oposto ao sol.
  const shift = { x: -Math.sin(a) * length, y: -Math.cos(a) * length, z: 0 };
  const points = [...base, ...base.map((p) => add(p, shift))].map((p) => ({ x: p.x, y: p.y }));
  const hull = convexHull(points);
  return hull.map((p) => ({ x: p.x, y: p.y, z: 0.01 }));
}

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (
    o: { x: number; y: number },
    p: { x: number; y: number },
    q: { x: number; y: number },
  ) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Caixa do obstáculo vista do centro da superfície: direção, distância, largura e altura da ficha do projeto. */
export function obstacleBox(obstacle: Obstacle, center: Vec3): { base: Vec3[]; top: Vec3[] } {
  const a = rad(obstacle.azimuthDegrees);
  const dir = { x: Math.sin(a), y: Math.cos(a), z: 0 };
  const across = { x: Math.cos(a), y: -Math.sin(a), z: 0 };
  const depth = Math.min(1, Math.max(0.3, obstacle.widthM * 0.5));
  const middle = add(center, scale(dir, obstacle.distanceM));
  const corner = (du: number, dd: number) =>
    add(add(middle, scale(across, du * obstacle.widthM * 0.5)), scale(dir, dd * depth * 0.5));
  const base = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const h = Math.max(0.05, obstacle.heightM);
  return { base, top: base.map((p) => ({ ...p, z: h })) };
}

export function buildScene(
  surfaces: readonly Surface[],
  layouts: readonly SurfaceLayoutResult[],
  sun: SunDirection | null,
): ScenePolygon[] {
  const polygons: ScenePolygon[] = [];
  let cursor = 0;
  surfaces.forEach((surface, index) => {
    const tilt = rad(surface.tiltDegrees);
    const footprint = Math.max(surface.widthM, surface.depthM * Math.cos(tilt));
    const center: Vec3 = { x: cursor + footprint / 2, y: 0, z: 0 };
    cursor += footprint + Math.max(3, footprint * 0.25);

    // Chão sob a superfície (projeção horizontal).
    const ground = [
      surfacePoint(surface, center, -surface.widthM / 2, 0),
      surfacePoint(surface, center, surface.widthM / 2, 0),
      surfacePoint(surface, center, surface.widthM / 2, surface.depthM),
      surfacePoint(surface, center, -surface.widthM / 2, surface.depthM),
    ].map((p) => ({ ...p, z: 0 }));
    polygons.push({ kind: 'GROUND', points: ground, label: `Base de ${surface.name}` });

    polygons.push({
      kind: 'ROOF',
      points: [
        surfacePoint(surface, center, -surface.widthM / 2, 0),
        surfacePoint(surface, center, surface.widthM / 2, 0),
        surfacePoint(surface, center, surface.widthM / 2, surface.depthM),
        surfacePoint(surface, center, -surface.widthM / 2, surface.depthM),
      ],
      label: surface.name,
    });

    const layout = layouts.find((l) => l.surfaceId === surface.id) ?? layouts[index];
    const sb = surface.setbackM;
    for (const r of layout?.rects ?? []) {
      const u0 = sb.left + r.x - surface.widthM / 2;
      const u1 = u0 + r.w;
      const vTop = surface.depthM - (sb.top + r.y);
      const vBottom = vTop - r.h;
      polygons.push({
        kind: 'MODULE',
        points: [
          surfacePoint(surface, center, u0, vBottom),
          surfacePoint(surface, center, u1, vBottom),
          surfacePoint(surface, center, u1, vTop),
          surfacePoint(surface, center, u0, vTop),
        ].map((p) => add(p, { x: 0, y: 0, z: 0.03 })),
      });
    }

    for (const obstacle of surface.obstacles) {
      const { base, top } = obstacleBox(obstacle, center);
      if (sun) {
        const shadow = shadowOf(base, Math.max(0, obstacle.heightM), sun);
        if (shadow)
          polygons.push({ kind: 'SHADOW', points: shadow, label: `Sombra de ${obstacle.name}` });
      }
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        polygons.push({
          kind: 'OBSTACLE',
          points: [base[k]!, base[n]!, top[n]!, top[k]!],
          label: obstacle.name,
        });
      }
      polygons.push({ kind: 'OBSTACLE', points: top, label: obstacle.name });
    }
  });
  return polygons;
}

export interface ProjectedPolygon {
  kind: PolygonKind;
  label?: string;
  /** Pontos no plano da tela (SVG: y para baixo). */
  points: { x: number; y: number }[];
  depth: number;
}

/** Projeção ortográfica: `yaw` gira em torno da vertical; `pitch` é a elevação da câmera (0 = horizonte, 90 = de cima). */
export function project(
  p: Vec3,
  yawDegrees: number,
  pitchDegrees: number,
): { x: number; y: number; depth: number } {
  const yaw = rad(yawDegrees);
  const pitch = rad(pitchDegrees);
  const xr = p.x * Math.cos(yaw) + p.y * Math.sin(yaw);
  const yr = -p.x * Math.sin(yaw) + p.y * Math.cos(yaw);
  const up = yr * Math.sin(pitch) + p.z * Math.cos(pitch);
  return { x: xr, y: -up, depth: yr * Math.cos(pitch) - p.z * Math.sin(pitch) };
}

const KIND_ORDER: Record<PolygonKind, number> = {
  GROUND: 0,
  SHADOW: 1,
  ROOF: 2,
  MODULE: 3,
  OBSTACLE: 2,
};

export function projectScene(
  polygons: readonly ScenePolygon[],
  yawDegrees: number,
  pitchDegrees: number,
): { polygons: ProjectedPolygon[]; viewBox: string } {
  const projected = polygons.map((poly) => {
    const pts = poly.points.map((p) => project(p, yawDegrees, pitchDegrees));
    const depth = pts.reduce((sum, p) => sum + p.depth, 0) / pts.length;
    return {
      kind: poly.kind,
      ...(poly.label ? { label: poly.label } : {}),
      points: pts.map(({ x, y }) => ({ x, y })),
      depth,
    };
  });
  // Do mais longe para o mais perto; chão e sombra sempre por baixo, módulos sempre sobre o telhado.
  projected.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.kind === 'GROUND' || a.kind === 'SHADOW' ? 0 : b.depth - a.depth),
  );
  const xs = projected.flatMap((p) => p.points.map((q) => q.x));
  const ys = projected.flatMap((p) => p.points.map((q) => q.y));
  if (xs.length === 0) return { polygons: [], viewBox: '0 0 10 10' };
  const pad = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * 0.06);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return {
    polygons: projected,
    viewBox: `${minX} ${minY} ${Math.max(...xs) - minX + pad} ${Math.max(...ys) - minY + pad}`,
  };
}
