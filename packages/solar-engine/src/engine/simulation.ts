import { roundTo } from '../units/index.js';
import { cellTemperatureC } from './thermal.js';
import type { HourlySeries } from '../io/weather.js';
import { solarPosition } from '../solar-position/index.js';
import { incidenceCosine, isSunBlocked, obstacleSilhouette } from './shading.js';
import type { SiteDesign, Surface } from '@voltex/shared';

/** ENG-F18–F21: simulação determinística sobre uma série já transposta para o plano do arranjo. */
export const SIMULATION_ALGORITHM_VERSION = 'simulation-1.1.0';

export interface SimulationHour {
  /** Irradiância no plano do arranjo, já após transposição (W/m²). */
  planeIrradianceWm2: number;
  ambientC: number;
  /** Fração sombreada (0–1) calculada pela carta solar ou informada. */
  shadingFraction?: number;
  /** Irradiância no plano **sem** obstáculos/horizonte, para isolar a perda por sombra (W/m²). */
  unshadedIrradianceWm2?: number;
  /** Mês (0–11) e hora (0–23) locais, para agregações mensais e perfil de dia típico. */
  monthIndex?: number;
  hourOfDay?: number;
}

/** Uma etapa da cascata de perdas, em kWh de energia (CA ao final). */
export interface LossStep {
  id: 'IDEAL' | 'SHADING' | 'TEMPERATURE' | 'SYSTEM' | 'INVERTER' | 'CLIPPING' | 'AC';
  label: string;
  kwh: number;
}

export interface SimulationInput {
  hours: SimulationHour[];
  dcPowerWp: number;
  acLimitW: number;
  gammaPmaxPctPerC: number;
  noctC?: number;
  /** Perdas em cascata, p.ex. sujeira, mismatch e cabos (0–1). */
  lossFraction?: number;
  inverterEfficiencyPct?: number;
  degradationPctPerYear?: number;
  year?: number;
}

export interface SimulationResult {
  energyKwh: number;
  dcEnergyKwh: number;
  clippingKwh: number;
  performanceRatio: number | null;
  cellTemperatureMeanC: number | null;
  algorithmVersion: string;
  warnings: string[];
  /** Energia CA por mês (kWh), quando as horas trazem o mês. */
  monthlyKwh?: number[];
  /** Potência CA média por hora do dia (kW), quando as horas trazem a hora. */
  typicalDayKw?: number[];
  /** Cascata: ideal → sombra → temperatura → perdas do sistema → inversor → clipping → CA. */
  losses?: LossStep[];
}

export interface SimulationSurface {
  surface: Pick<Surface, 'azimuthDegrees' | 'tiltDegrees' | 'obstacles'>;
  dcPowerWp: number;
}

export interface ProjectSimulationInput extends Omit<SimulationInput, 'hours' | 'dcPowerWp'> {
  /** Refletância do solo (0–1) para a componente refletida; ausente = ignorada (e avisado). */
  albedo?: number;
  series: HourlySeries;
  site: Pick<SiteDesign, 'latitude' | 'longitude' | 'horizon'>;
  surfaces: SimulationSurface[];
}

/**
 * ENG-F18–F20. Decompõe GHI/DHI da Central e transpõe para cada plano pelo modelo isotrópico simples.
 * A série NASA está em hora solar local, enquanto a PVGIS está em UTC; as duas são convertidas para a
 * posição solar antes de aplicar horizonte/obstáculos e o limite CA horário.
 */
export function simulateProjectHourly(input: ProjectSimulationInput): SimulationResult {
  const dcPowerWp = input.surfaces.reduce((sum, surface) => sum + surface.dcPowerWp, 0);
  if (!input.surfaces.length || dcPowerWp <= 0)
    return {
      energyKwh: 0,
      dcEnergyKwh: 0,
      clippingKwh: 0,
      performanceRatio: null,
      cellTemperatureMeanC: null,
      algorithmVersion: SIMULATION_ALGORITHM_VERSION,
      warnings: ['Sem potência CC em superfícies para simular.'],
    };
  const start = new Date(
    `${input.series.startAt}${input.series.timeStandard === 'UTC' ? '' : 'Z'}`,
  );
  const hours: SimulationHour[] = [];
  for (let index = 0; index < input.series.ghiWhM2.length; index++) {
    const ghi = input.series.ghiWhM2[index] ?? null;
    const temp = input.series.tempC[index] ?? null;
    if (ghi === null || temp === null) continue;
    const lstOffsetMs =
      input.series.timeStandard === 'LST' ? (-input.site.longitude / 15) * 3_600_000 : 0;
    const at = new Date(start.getTime() + index * 3_600_000 + lstOffsetMs);
    const sun = solarPosition({
      at,
      latitudeDegrees: input.site.latitude,
      longitudeDegrees: input.site.longitude,
    });
    let weightedPlane = 0;
    let weightedUnshaded = 0;
    for (const item of input.surfaces) {
      const weight = item.dcPowerWp / dcPowerWp;
      const cosine = Math.max(
        0,
        incidenceCosine(
          sun.elevationDegrees,
          sun.azimuthDegrees,
          item.surface.azimuthDegrees,
          item.surface.tiltDegrees,
        ),
      );
      const sinElevation = Math.max(0.01, Math.sin((sun.elevationDegrees * Math.PI) / 180));
      const dhi = Math.max(0, input.series.dhiWhM2[index] ?? 0);
      const dni = Math.max(0, (ghi - dhi) / sinElevation);
      // Hay-Davies would require extraterrestrial radiation; isotrópico é explícito e determinístico para o MVP.
      const diffusePlane = (dhi * (1 + Math.cos((item.surface.tiltDegrees * Math.PI) / 180))) / 2;
      const directPlane = dni * cosine;
      const blocked = isSunBlocked(
        sun.elevationDegrees,
        sun.azimuthDegrees,
        input.site.horizon,
        item.surface.obstacles.map(obstacleSilhouette),
      );
      const reflectedPlane =
        (ghi * (input.albedo ?? 0) * (1 - Math.cos((item.surface.tiltDegrees * Math.PI) / 180))) /
        2;
      weightedPlane +=
        (blocked ? diffusePlane + reflectedPlane : directPlane + diffusePlane + reflectedPlane) *
        weight;
      weightedUnshaded += (directPlane + diffusePlane + reflectedPlane) * weight;
    }
    const local = new Date(
      start.getTime() +
        index * 3_600_000 +
        (input.series.timeStandard === 'UTC' ? (input.site.longitude / 15) * 3_600_000 : 0),
    );
    hours.push({
      planeIrradianceWm2: Math.max(0, weightedPlane),
      unshadedIrradianceWm2: Math.max(0, weightedUnshaded),
      ambientC: temp,
      monthIndex: local.getUTCMonth(),
      hourOfDay: local.getUTCHours(),
    });
  }
  const result = simulateHourly({ ...input, hours, dcPowerWp });
  return {
    ...result,
    warnings: [
      ...result.warnings,
      ...(input.series.missingHours
        ? [`${input.series.missingHours} hora(s) sem dado foram excluídas da simulação.`]
        : []),
      'Transposição isotrópica de GHI/DHI; validar contra PVGIS antes de aprovação.',
      ...(input.albedo === undefined
        ? ['Albedo do solo não informado: a radiação refletida pelo solo foi ignorada.']
        : []),
    ],
  };
}

export function simulateHourly(input: SimulationInput): SimulationResult {
  if (input.dcPowerWp < 0 || input.acLimitW < 0)
    throw new RangeError('Potências não podem ser negativas');
  const loss = input.lossFraction ?? 0;
  const efficiency = (input.inverterEfficiencyPct ?? 96) / 100;
  if (loss < 0 || loss >= 1 || efficiency <= 0 || efficiency > 1)
    throw new RangeError('Perda ou eficiência inválida');
  const degradation = Math.max(
    0,
    1 - ((input.degradationPctPerYear ?? 0) / 100) * Math.max(0, (input.year ?? 1) - 1),
  );
  let dc = 0;
  let ac = 0;
  let clipped = 0;
  let cellSum = 0;
  let cellCount = 0;
  const monthly = Array<number>(12).fill(0);
  const dayKw = Array<number>(24).fill(0);
  const dayCount = Array<number>(24).fill(0);
  let withCalendar = false;
  let unshadedKwh = 0;
  let shadedKwh = 0;
  let tempFreeKwh = 0;
  let rawKwh = 0;
  for (const hour of input.hours) {
    if (hour.planeIrradianceWm2 < 0) throw new RangeError('Irradiância não pode ser negativa');
    const irradiance =
      hour.planeIrradianceWm2 * (1 - Math.min(1, Math.max(0, hour.shadingFraction ?? 0)));
    const cell = cellTemperatureC({
      ambientC: hour.ambientC,
      noctC: input.noctC ?? 44,
      irradianceWm2: irradiance,
    });
    const rawDc =
      input.dcPowerWp *
      (irradiance / 1000) *
      (1 + (input.gammaPmaxPctPerC / 100) * (cell - 25)) *
      degradation;
    const deliveredDc = Math.max(0, rawDc * (1 - loss));
    const beforeClip = deliveredDc * efficiency;
    dc += deliveredDc / 1000;
    ac += Math.min(beforeClip, input.acLimitW) / 1000;
    clipped += Math.max(0, beforeClip - input.acLimitW) / 1000;
    cellSum += cell;
    cellCount += 1;
    const acHour = Math.min(beforeClip, input.acLimitW) / 1000;
    unshadedKwh +=
      (input.dcPowerWp * (hour.unshadedIrradianceWm2 ?? hour.planeIrradianceWm2)) / 1_000_000;
    shadedKwh += (input.dcPowerWp * irradiance) / 1_000_000;
    tempFreeKwh += (input.dcPowerWp * (irradiance / 1000) * degradation) / 1000;
    rawKwh += Math.max(0, rawDc) / 1000;
    if (hour.monthIndex !== undefined && hour.hourOfDay !== undefined) {
      withCalendar = true;
      monthly[hour.monthIndex] = (monthly[hour.monthIndex] ?? 0) + acHour;
      dayKw[hour.hourOfDay] = (dayKw[hour.hourOfDay] ?? 0) + acHour;
      dayCount[hour.hourOfDay] = (dayCount[hour.hourOfDay] ?? 0) + 1;
    }
  }
  const ideal = input.hours.reduce(
    (sum, hour) => sum + (input.dcPowerWp * hour.planeIrradianceWm2) / 1_000_000,
    0,
  );
  return {
    energyKwh: roundTo(ac, 3),
    dcEnergyKwh: roundTo(dc, 3),
    clippingKwh: roundTo(clipped, 3),
    performanceRatio: ideal > 0 ? roundTo(ac / ideal, 4) : null,
    cellTemperatureMeanC: cellCount ? roundTo(cellSum / cellCount, 2) : null,
    algorithmVersion: SIMULATION_ALGORITHM_VERSION,
    warnings: input.hours.length === 0 ? ['Sem série horária: a simulação não foi calculada.'] : [],
    ...(withCalendar
      ? {
          monthlyKwh: monthly.map((v) => roundTo(v, 2)),
          typicalDayKw: dayKw.map((v, h) => roundTo(v / Math.max(1, dayCount[h] ?? 1), 3)),
        }
      : {}),
    losses: [
      { id: 'IDEAL', label: 'Energia ideal no plano (STC)', kwh: roundTo(unshadedKwh, 1) },
      { id: 'SHADING', label: 'Sombreamento', kwh: roundTo(shadedKwh - unshadedKwh, 1) },
      {
        id: 'TEMPERATURE',
        label: 'Temperatura das células',
        kwh: roundTo(rawKwh - tempFreeKwh, 1),
      },
      {
        id: 'SYSTEM',
        label: 'Perdas do sistema CC (sujeira, mismatch, cabos)',
        kwh: roundTo(dc - rawKwh, 1),
      },
      { id: 'INVERTER', label: 'Eficiência do inversor', kwh: roundTo(dc * efficiency - dc, 1) },
      { id: 'CLIPPING', label: 'Limitação do inversor (clipping)', kwh: roundTo(-clipped, 1) },
      { id: 'AC', label: 'Energia CA entregue', kwh: roundTo(ac, 1) },
    ],
  };
}
