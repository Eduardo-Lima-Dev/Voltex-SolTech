import type { OffgridLoad, OffgridLoadResult } from '@voltex/shared';
import { roundTo } from '../units/index.js';

/**
 * OFF-F01: perfil de carga. Energia diária = potência × quantidade × horas por dia, espalhada na janela de uso
 * (duty = horas ÷ comprimento da janela, no máximo 1) e modulada pelo dia da semana e pela sazonalidade do mês.
 * Pico = soma da potência das cargas possíveis de estarem ligadas juntas × simultaneidade; surto = pico + partida da
 * maior carga com fator de surto (uma partida por vez). Memorial: `docs/06-calculos/offgrid-carga.md`.
 */
export const OFFGRID_LOAD_VERSION = 'offgrid-load-1.0.0';

/** Comprimento da janela de uso em horas (atravessa a meia-noite quando o início é maior que o fim). */
export function windowLength(load: Pick<OffgridLoad, 'windowStartHour' | 'windowEndHour'>): number {
  const length =
    load.windowEndHour > load.windowStartHour
      ? load.windowEndHour - load.windowStartHour
      : 24 - load.windowStartHour + load.windowEndHour;
  return length === 0 ? 24 : length;
}

/** A hora local (0–23) cai dentro da janela de uso da carga? */
export function inWindow(
  load: Pick<OffgridLoad, 'windowStartHour' | 'windowEndHour'>,
  hour: number,
): boolean {
  if (load.windowEndHour > load.windowStartHour)
    return hour >= load.windowStartHour && hour < load.windowEndHour;
  if (load.windowEndHour === load.windowStartHour) return true;
  return hour >= load.windowStartHour || hour < load.windowEndHour;
}

/** Energia (Wh) que a carga consome na hora indicada. */
export function loadWhAt(
  load: OffgridLoad,
  monthIndex: number,
  weekday: number,
  hour: number,
): number {
  if (!load.daysOfWeek.includes(weekday) || !inWindow(load, hour)) return 0;
  const duty = Math.min(1, load.hoursPerDay / windowLength(load));
  return load.powerW * load.quantity * duty * (load.seasonality[monthIndex] as number);
}

export interface HourlyLoads {
  acWh: number;
  dcWh: number;
  criticalWh: number;
}

/** Soma das cargas numa hora, separando CA, CC e a parcela crítica. */
export function loadsAt(
  loads: readonly OffgridLoad[],
  monthIndex: number,
  weekday: number,
  hour: number,
  scale = 1,
): HourlyLoads {
  let acWh = 0;
  let dcWh = 0;
  let criticalWh = 0;
  for (const load of loads) {
    const wh = loadWhAt(load, monthIndex, weekday, hour) * scale;
    if (wh === 0) continue;
    if (load.kind === 'AC') acWh += wh;
    else dcWh += wh;
    if (load.critical) criticalWh += wh;
  }
  return { acWh, dcWh, criticalWh };
}

export function profileLoads(loads: readonly OffgridLoad[]): OffgridLoadResult {
  const monthlyAc = Array<number>(12).fill(0);
  const monthlyDc = Array<number>(12).fill(0);
  let critical = 0;
  for (let month = 0; month < 12; month++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) {
        const at = loadsAt(loads, month, weekday, hour);
        monthlyAc[month] = (monthlyAc[month] as number) + at.acWh / 7;
        monthlyDc[month] = (monthlyDc[month] as number) + at.dcWh / 7;
      }
    }
  }
  const monthly = monthlyAc.map((ac, i) => ac + (monthlyDc[i] as number));
  const criticalMonthIndex = monthly.reduce(
    (best, value, i) => (value > (monthly[best] as number) ? i : best),
    0,
  );

  const hourlyWh = Array<number>(24).fill(0);
  let nightWh = 0;
  for (let weekday = 0; weekday < 7; weekday++)
    for (let hour = 0; hour < 24; hour++) {
      const at = loadsAt(loads, criticalMonthIndex, weekday, hour);
      const wh = (at.acWh + at.dcWh) / 7;
      hourlyWh[hour] = (hourlyWh[hour] as number) + wh;
      critical += at.criticalWh / 7;
      if (hour >= 18 || hour < 6) nightWh += wh;
    }

  // Pico e surto: as cargas que podem estar ligadas ao mesmo tempo em algum mês, dia da semana e hora.
  let peakW = 0;
  let surgeW = 0;
  for (let month = 0; month < 12; month++)
    for (let weekday = 0; weekday < 7; weekday++)
      for (let hour = 0; hour < 24; hour++) {
        let total = 0;
        let startExtra = 0;
        for (const load of loads) {
          if (
            !load.daysOfWeek.includes(weekday) ||
            !inWindow(load, hour) ||
            (load.seasonality[month] as number) <= 0 ||
            load.hoursPerDay <= 0
          )
            continue;
          total += load.powerW * load.quantity * load.simultaneity;
          startExtra = Math.max(startExtra, load.powerW * (load.surgeFactor - 1));
        }
        peakW = Math.max(peakW, total);
        surgeW = Math.max(surgeW, total + startExtra);
      }

  const total = monthly[criticalMonthIndex] as number;
  return {
    dailyAcWh: roundTo(monthlyAc[criticalMonthIndex] as number, 1),
    dailyDcWh: roundTo(monthlyDc[criticalMonthIndex] as number, 1),
    dailyWh: roundTo(total, 1),
    criticalDailyWh: roundTo(critical, 1),
    monthlyDailyWh: monthly.map((v) => roundTo(v, 1)),
    monthlyDailyAcWh: monthlyAc.map((v) => roundTo(v, 1)),
    monthlyDailyDcWh: monthlyDc.map((v) => roundTo(v, 1)),
    hourlyWh: hourlyWh.map((v) => roundTo(v, 1)),
    peakW: roundTo(peakW, 1),
    surgeW: roundTo(surgeW, 1),
    installedW: roundTo(
      loads.reduce((acc, l) => acc + l.powerW * l.quantity, 0),
      1,
    ),
    nightFraction: total > 0 ? roundTo(nightWh / total, 3) : 0,
    criticalMonthIndex,
  };
}
