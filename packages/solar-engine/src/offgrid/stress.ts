import type { OffgridStressResult } from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { runDispatch, type DispatchConfig, type DispatchTimeline } from './dispatch.js';

/**
 * OFF-F08: teste de estresse sazonal. No mês de projeto, depois de uma semana (ou mais) de dias normais, aplica
 * `cloudyDays` dias seguidos com a irradiância reduzida e a carga aumentada em `loadGrowthPct`, e verifica se o
 * sistema atende sem perda de carga. Memorial: `docs/06-calculos/offgrid-despacho.md`.
 */
export const OFFGRID_STRESS_VERSION = 'offgrid-stress-1.0.0';

export function stressTest(input: {
  config: DispatchConfig;
  timeline: DispatchTimeline;
  monthIndex: number;
  cloudyDays: number;
  irradianceFactor: number;
  loadGrowthPct: number;
  autonomyDaysEffective: number;
}): OffgridStressResult | null {
  const { timeline: tl } = input;
  const indices: number[] = [];
  tl.monthIndex.forEach((m, i) => {
    if (m === input.monthIndex) indices.push(i);
  });
  const days: number[][] = [];
  let current: number[] = [];
  let currentDay = -1;
  for (const i of indices) {
    const day = tl.dayOfYear[i] as number;
    if (day !== currentDay) {
      if (current.length === 24) days.push(current);
      current = [];
      currentDay = day;
    }
    current.push(i);
  }
  if (current.length === 24) days.push(current);
  const recovery = 3;
  const cloudy = Math.min(input.cloudyDays, Math.max(1, days.length - recovery - 1));
  const warm = Math.max(1, Math.min(14, days.length - cloudy - recovery));
  const used = days.slice(0, warm + cloudy + recovery);
  if (used.length < warm + cloudy) return null;

  const growth = 1 + input.loadGrowthPct / 100;
  const sub: DispatchTimeline = {
    hourOfDay: [],
    dayOfYear: [],
    monthIndex: [],
    pvW: [],
    acWh: [],
    dcWh: [],
  };
  used.forEach((day, d) => {
    const isCloudy = d >= warm && d < warm + cloudy;
    for (const i of day) {
      sub.hourOfDay.push(tl.hourOfDay[i] as number);
      sub.dayOfYear.push(tl.dayOfYear[i] as number);
      sub.monthIndex.push(tl.monthIndex[i] as number);
      sub.pvW.push((tl.pvW[i] as number) * (isCloudy ? input.irradianceFactor : 1));
      sub.acWh.push((tl.acWh[i] as number) * growth);
      sub.dcWh.push((tl.dcWh[i] as number) * growth);
    }
  });
  const result = runDispatch({ ...input.config, passes: 1, initialSocFrac: 1 }, sub);
  const from = warm * 24;
  let unmetWh = 0;
  let minSoc = 1;
  let depletion: number | null = null;
  for (let h = from; h < sub.pvW.length; h++) {
    unmetWh += result.unmetWh[h] as number;
    minSoc = Math.min(minSoc, result.socFrac[h] as number);
    if (depletion === null && (result.unmetWh[h] as number) > 1) depletion = h - from;
  }
  return {
    cloudyDays: cloudy,
    irradianceFactor: input.irradianceFactor,
    loadGrowthPct: input.loadGrowthPct,
    survives: unmetWh <= 1,
    unmetKwh: roundTo(unmetWh / 1000, 2),
    minSocPct: roundTo(minSoc * 100, 1),
    hoursToDepletion: depletion,
    autonomyDaysEffective: roundTo(input.autonomyDaysEffective, 2),
  };
}
