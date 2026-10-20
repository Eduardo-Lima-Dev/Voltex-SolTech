import type { Obstacle, SiteDesign, Surface } from '@voltex/shared';
import { DAYS_IN_MONTH, degToRad, radToDeg, roundTo } from '../units/index.js';
import { solarPosition } from '../solar-position/index.js';

/**
 * Sombreamento por posição solar (ENG-F17): horizonte distante (perfil do PVGIS) e obstáculos próximos, por hora e por
 * mês, ponderado pela radiação **direta** estimada com céu claro. É uma **estimativa**: a componente difusa não é
 * sombreada pelos obstáculos e não há penumbra nem efeito elétrico de sombra parcial. Memorial:
 * `docs/06-calculos/engine-posicao-solar-sombreamento.md`.
 */
export const SHADING_ALGORITHM_VERSION = 'shading-1.0.0';

/** Passo da varredura do dia (h) e janela de horas solares consideradas. */
const STEP_HOURS = 0.25;
const FIRST_HOUR = 4;
const LAST_HOUR = 20;
/** Dia do mês usado como representativo. */
const REPRESENTATIVE_DAY = 15;

export interface ShadingInput {
  site: Pick<SiteDesign, 'latitude' | 'longitude' | 'horizon'>;
  surface: Pick<Surface, 'azimuthDegrees' | 'tiltDegrees' | 'obstacles'>;
}

export interface ShadingComputation {
  monthlyLossPct: number[];
  annualLossPct: number;
  sunPaths: {
    month: number;
    points: { azimuthDegrees: number; elevationDegrees: number; shaded: boolean }[];
  }[];
  obstacles: {
    name: string;
    azimuthDegrees: number;
    halfWidthDegrees: number;
    topElevationDegrees: number;
  }[];
}

/** Irradiância direta normal com céu claro (modelo de Meinel, W/m²) em função da altura do sol. */
export function clearSkyDirectNormal(elevationDegrees: number): number {
  if (elevationDegrees <= 0) return 0;
  const zenith = 90 - elevationDegrees;
  // Massa de ar de Kasten e Young.
  const airMass = 1 / (Math.cos(degToRad(zenith)) + 0.50572 * (96.07995 - zenith) ** -1.6364);
  return 1353 * 0.7 ** (airMass ** 0.678);
}

/** Cosseno do ângulo de incidência do sol no plano da superfície. */
export function incidenceCosine(
  sunElevationDegrees: number,
  sunAzimuthDegrees: number,
  surfaceAzimuthDegrees: number,
  surfaceTiltDegrees: number,
): number {
  const el = degToRad(sunElevationDegrees);
  const tilt = degToRad(surfaceTiltDegrees);
  return (
    Math.sin(el) * Math.cos(tilt) +
    Math.cos(el) * Math.sin(tilt) * Math.cos(degToRad(sunAzimuthDegrees - surfaceAzimuthDegrees))
  );
}

/** Altura do horizonte (°) num azimute, por interpolação linear circular entre os pontos do perfil. */
export function horizonHeightAt(
  points: readonly { azimuthDegrees: number; heightDegrees: number }[],
  azimuthDegrees: number,
): number {
  if (points.length === 0) return 0;
  const az = ((azimuthDegrees % 360) + 360) % 360;
  const sorted = [...points].sort((a, b) => a.azimuthDegrees - b.azimuthDegrees);
  let before = sorted[sorted.length - 1] as (typeof sorted)[number];
  let after = sorted[0] as (typeof sorted)[number];
  for (const point of sorted) {
    if (point.azimuthDegrees <= az) before = point;
    if (point.azimuthDegrees >= az) {
      after = point;
      break;
    }
  }
  if (az > (sorted[sorted.length - 1] as (typeof sorted)[number]).azimuthDegrees) {
    before = sorted[sorted.length - 1] as (typeof sorted)[number];
    after = sorted[0] as (typeof sorted)[number];
  }
  const span = (((after.azimuthDegrees - before.azimuthDegrees) % 360) + 360) % 360;
  if (span === 0) return before.heightDegrees;
  const offset = (((az - before.azimuthDegrees) % 360) + 360) % 360;
  return before.heightDegrees + ((after.heightDegrees - before.heightDegrees) * offset) / span;
}

export function obstacleSilhouette(obstacle: Obstacle) {
  return {
    name: obstacle.name,
    azimuthDegrees: obstacle.azimuthDegrees,
    halfWidthDegrees: roundTo(radToDeg(Math.atan(obstacle.widthM / 2 / obstacle.distanceM)), 2),
    topElevationDegrees: roundTo(
      obstacle.heightM > 0 ? radToDeg(Math.atan(obstacle.heightM / obstacle.distanceM)) : 0,
      2,
    ),
  };
}

const angularDistance = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/** O sol está bloqueado pelo horizonte ou por algum obstáculo? */
export function isSunBlocked(
  elevationDegrees: number,
  azimuthDegrees: number,
  horizon: SiteDesign['horizon'],
  silhouettes: ReturnType<typeof obstacleSilhouette>[],
): boolean {
  if (horizon && elevationDegrees < horizonHeightAt(horizon.points, azimuthDegrees)) return true;
  return silhouettes.some(
    (o) =>
      o.topElevationDegrees > 0 &&
      angularDistance(azimuthDegrees, o.azimuthDegrees) <= o.halfWidthDegrees &&
      elevationDegrees < o.topElevationDegrees,
  );
}

export function computeShading(input: ShadingInput): ShadingComputation {
  const { site, surface } = input;
  const silhouettes = surface.obstacles.map(obstacleSilhouette);
  const monthlyLossPct: number[] = [];
  const sunPaths: ShadingComputation['sunPaths'] = [];
  let weightedShaded = 0;
  let weightedTotal = 0;

  for (let month = 0; month < 12; month++) {
    let monthShaded = 0;
    let monthTotal = 0;
    const points: ShadingComputation['sunPaths'][number]['points'] = [];
    for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += STEP_HOURS) {
      // Hora solar local → instante UTC aproximado pela longitude (sem equação do tempo: erro de ± minutos).
      const utcMs =
        Date.UTC(2025, month, REPRESENTATIVE_DAY, 0, 0, 0) +
        (hour - site.longitude / 15) * 3_600_000;
      const sun = solarPosition({
        at: new Date(utcMs),
        latitudeDegrees: site.latitude,
        longitudeDegrees: site.longitude,
      });
      if (sun.elevationDegrees <= 0) continue;
      const blocked = isSunBlocked(
        sun.elevationDegrees,
        sun.azimuthDegrees,
        site.horizon,
        silhouettes,
      );
      if (Math.round(hour * 4) % 2 === 0)
        points.push({
          azimuthDegrees: roundTo(sun.azimuthDegrees, 1),
          elevationDegrees: roundTo(sun.elevationDegrees, 1),
          shaded: blocked,
        });
      const cosine = incidenceCosine(
        sun.elevationDegrees,
        sun.azimuthDegrees,
        surface.azimuthDegrees,
        surface.tiltDegrees,
      );
      const weight = cosine > 0 ? clearSkyDirectNormal(sun.elevationDegrees) * cosine : 0;
      if (weight <= 0) continue;
      monthTotal += weight;
      if (blocked) monthShaded += weight;
    }
    sunPaths.push({ month, points });
    monthlyLossPct.push(monthTotal > 0 ? roundTo((monthShaded / monthTotal) * 100, 2) : 0);
    const days = DAYS_IN_MONTH[month] as number;
    weightedShaded += monthShaded * days;
    weightedTotal += monthTotal * days;
  }
  return {
    monthlyLossPct,
    annualLossPct: weightedTotal > 0 ? roundTo((weightedShaded / weightedTotal) * 100, 2) : 0,
    sunPaths,
    obstacles: silhouettes,
  };
}
