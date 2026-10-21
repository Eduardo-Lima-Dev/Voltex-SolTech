import type { OffgridDesign, OffgridResourceResult } from '@voltex/shared';
import { DAYS_IN_MONTH, roundTo } from '../units/index.js';
import { optimalAzimuthDegrees, recommendedTiltDegrees } from '../calculator/orientation.js';
import { buildPlaneHours, type SimulationHour } from '../engine/simulation.js';
import { solarPosition } from '../solar-position/index.js';
import type { HourlySeries } from '../io/weather.js';

/**
 * OFF-F02: recurso solar no plano do arranjo. Com a série horária da Central, transpõe GHI/DHI para cada arranjo
 * (mesmo modelo do Engine). Sem série, monta um **ano sintético** a partir da climatologia mensal do local: a irradiação
 * diária do mês é distribuída pelas horas com peso `sen(altura do sol)`, a fração difusa é presumida (35%) e a
 * temperatura segue uma senoide diária. É menos exato que a série real e vem sempre com aviso.
 * Memorial: `docs/06-calculos/offgrid-dimensionamento.md`.
 */
export const OFFGRID_RESOURCE_VERSION = 'offgrid-resource-1.0.0';

export const SYNTHETIC_DIFFUSE_FRACTION = 0.35;

export interface ArrayOrientation {
  azimuthDegrees: number;
  tiltDegrees: number;
  /** Peso na média (potência CC; 1 quando o módulo ainda não foi escolhido). */
  weight: number;
}

export interface YearTimeline {
  source: 'SERIES' | 'SYNTHETIC';
  monthIndex: number[];
  hourOfDay: number[];
  weekday: number[];
  dayOfYear: number[];
  ambientC: number[];
  /** Irradiância no plano (W/m²) por arranjo, alinhada ao tempo. */
  planeWm2: number[][];
  warnings: string[];
}

/** Série horária sintética (hora solar local) de um ano de 365 dias. */
export function syntheticSeries(
  site: OffgridDesign['site'],
): { series: HourlySeries; warnings: string[] } | null {
  const climate = site.climate;
  if (!climate) return null;
  const ghi: number[] = [];
  const dhi: number[] = [];
  const temp: number[] = [];
  for (let month = 0; month < 12; month++) {
    // Pesos do dia representativo (dia 15) em hora solar local.
    const weights = Array<number>(24).fill(0);
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(
        Date.UTC(2021, month, 15, 0, 0, 0) + (hour + 0.5 - site.longitude / 15) * 3_600_000,
      );
      const sun = solarPosition({
        at,
        latitudeDegrees: site.latitude,
        longitudeDegrees: site.longitude,
      });
      weights[hour] = Math.max(0, Math.sin((sun.elevationDegrees * Math.PI) / 180));
    }
    const total = weights.reduce((a, b) => a + b, 0);
    const dailyWh = (climate.ghiKwhM2Day[month] as number) * 1000;
    const mean = climate.tempMeanC[month] as number;
    const amplitude =
      ((climate.tempMaxC[month] as number) - (climate.tempMinC[month] as number)) / 2;
    for (let day = 0; day < (DAYS_IN_MONTH[month] as number); day++)
      for (let hour = 0; hour < 24; hour++) {
        const g = (dailyWh * (weights[hour] as number)) / total;
        ghi.push(g);
        dhi.push(g * SYNTHETIC_DIFFUSE_FRACTION);
        temp.push(mean + amplitude * Math.cos(((hour - 15) * 2 * Math.PI) / 24));
      }
  }
  return {
    series: {
      startAt: '2021-01-01T00:00:00',
      timeStandard: 'LST',
      ghiWhM2: ghi,
      dhiWhM2: dhi,
      tempC: temp,
      missingHours: 0,
    },
    warnings: [
      'Sem série horária da Central: usado um ano sintético a partir da climatologia mensal (fração difusa presumida de 35%).',
    ],
  };
}

export function orientationsOf(
  design: Pick<OffgridDesign, 'arrays' | 'site'>,
  powerOf: (arrayId: string) => number,
): ArrayOrientation[] {
  if (design.arrays.length === 0)
    return [
      {
        azimuthDegrees: optimalAzimuthDegrees(design.site.latitude),
        tiltDegrees: recommendedTiltDegrees(design.site.latitude),
        weight: 1,
      },
    ];
  return design.arrays.map((a) => ({
    azimuthDegrees: a.azimuthDegrees,
    tiltDegrees: a.tiltDegrees,
    weight: Math.max(1, powerOf(a.id)),
  }));
}

/** Monta o ano de referência (horas locais) com a irradiância no plano de cada arranjo. */
export function buildYear(
  design: Pick<OffgridDesign, 'site' | 'albedo'>,
  orientations: ArrayOrientation[],
  series?: HourlySeries,
): YearTimeline | null {
  const warnings: string[] = [];
  let source: YearTimeline['source'] = 'SERIES';
  let usable = series;
  if (!usable) {
    const synthetic = syntheticSeries(design.site);
    if (!synthetic) return null;
    usable = synthetic.series;
    source = 'SYNTHETIC';
    warnings.push(...synthetic.warnings);
  }
  const planeLists: SimulationHour[][] = orientations.map((o) =>
    buildPlaneHours({
      albedo: design.albedo,
      series: usable as HourlySeries,
      site: {
        latitude: design.site.latitude,
        longitude: design.site.longitude,
        horizon: design.site.horizon,
      },
      surfaces: [
        {
          surface: { azimuthDegrees: o.azimuthDegrees, tiltDegrees: o.tiltDegrees, obstacles: [] },
          dcPowerWp: 1,
        },
      ],
    }),
  );
  const base = planeLists[0] as SimulationHour[];
  if (design.albedo === undefined)
    warnings.push('Albedo não informado: a radiação refletida pelo solo foi ignorada.');
  return {
    source,
    monthIndex: base.map((h) => h.monthIndex as number),
    hourOfDay: base.map((h) => h.hourOfDay as number),
    weekday: base.map((h) => h.weekday as number),
    dayOfYear: base.map((h) => h.dayOfYear as number),
    ambientC: base.map((h) => h.ambientC),
    planeWm2: planeLists.map((list) => list.map((h) => h.planeIrradianceWm2)),
    warnings,
  };
}

/** Horas de sol pleno por mês (kWh/m²·dia) no plano, média ponderada pelos pesos dos arranjos. */
export function monthlyHsp(timeline: YearTimeline, orientations: ArrayOrientation[]): number[] {
  const totalWeight = orientations.reduce((a, o) => a + o.weight, 0);
  const sums = Array<number>(12).fill(0);
  const days = Array.from({ length: 12 }, () => new Set<number>());
  timeline.monthIndex.forEach((month, i) => {
    let weighted = 0;
    orientations.forEach((o, a) => {
      weighted += (((timeline.planeWm2[a] as number[])[i] as number) * o.weight) / totalWeight;
    });
    sums[month] = (sums[month] as number) + weighted;
    (days[month] as Set<number>).add(timeline.dayOfYear[i] as number);
  });
  return sums.map((sum, m) => {
    const count = (days[m] as Set<number>).size;
    return count > 0 ? roundTo(sum / 1000 / count, 3) : 0;
  });
}

/** Mês de projeto: o de pior relação carga ÷ recurso solar (CRESESB: mês crítico). */
export function designMonth(dailyWh: readonly number[], hsp: readonly number[]): number {
  let best = 0;
  let worst = -1;
  for (let m = 0; m < 12; m++) {
    const resource = hsp[m] as number;
    const ratio =
      resource > 0 ? (dailyWh[m] as number) / resource : (dailyWh[m] as number) > 0 ? Infinity : 0;
    if (ratio > worst) {
      worst = ratio;
      best = m;
    }
  }
  return best;
}

export function describeResource(
  timeline: YearTimeline | null,
  orientations: ArrayOrientation[],
  dailyWh: readonly number[],
): OffgridResourceResult {
  if (!timeline)
    return {
      source: 'NONE',
      hspMonthly: Array<number>(12).fill(0),
      designMonthIndex: designMonth(dailyWh, []),
      hspDesign: 0,
      hspMin: 0,
      tiltDegrees: null,
      azimuthDegrees: null,
    };
  const hsp = monthlyHsp(timeline, orientations);
  const month = designMonth(dailyWh, hsp);
  const first = orientations[0];
  return {
    source: timeline.source,
    hspMonthly: hsp,
    designMonthIndex: month,
    hspDesign: hsp[month] as number,
    hspMin: Math.min(...hsp),
    tiltDegrees: first ? first.tiltDegrees : null,
    azimuthDegrees: first ? first.azimuthDegrees : null,
  };
}
