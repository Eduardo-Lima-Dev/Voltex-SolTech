import type { BatteryChemistry } from '@voltex/shared';
import { roundTo } from '../units/index.js';

/**
 * OFF-F03..F06: dimensionamento de sistema isolado pelo método do mês crítico (CRESESB, Manual de Engenharia para
 * Sistemas Fotovoltaicos, 2014, cap. 6). Funções puras, com a equação de origem em cada uma. Parâmetros normativos
 * (redutores, eficiências, DoD, fatores) chegam por argumento, vindos da regra `offgrid.design`.
 * Memorial: `docs/06-calculos/offgrid-dimensionamento.md`.
 */
export const OFFGRID_SIZING_VERSION = 'offgrid-sizing-1.0.0';

/** CR 6.2: energia que o banco entrega por dia, `L = Lcc/ηbat + Lca/(ηbat·ηinv)` (Wh/dia). */
export function dailyBatteryEnergyWh(input: {
  dcWh: number;
  acWh: number;
  batteryEfficiency: number;
  inverterEfficiency: number;
}): number {
  return (
    input.dcWh / input.batteryEfficiency +
    input.acWh / (input.batteryEfficiency * input.inverterEfficiency)
  );
}

/** CR 6.3: `Pm = max_i [ Li / (HSPi · Red1 · Red2) ]` (Wp). Devolve também o mês que manda. */
export function pvPeakPowerWp(input: {
  monthlyEnergyWh: readonly number[];
  monthlyHsp: readonly number[];
  red1: number;
  red2: number;
}): { wp: number; monthIndex: number } {
  let wp = 0;
  let monthIndex = 0;
  for (let m = 0; m < 12; m++) {
    const hsp = input.monthlyHsp[m] as number;
    const energy = input.monthlyEnergyWh[m] as number;
    if (energy <= 0) continue;
    const need = hsp > 0 ? energy / (hsp * input.red1 * input.red2) : Infinity;
    if (need > wp) {
      wp = need;
      monthIndex = m;
    }
  }
  return { wp: Number.isFinite(wp) ? roundTo(wp, 1) : Infinity, monthIndex };
}

/**
 * CR 6.13 (equação reconstruída do texto; conferir no original): autonomia sugerida `N = 4,58 − 0,48·HSPmin`,
 * nunca abaixo de 1 dia. Serve de referência; quem manda é a autonomia de projeto e o mínimo da regra.
 */
export function suggestedAutonomyDays(hspMin: number): number {
  return roundTo(Math.max(1, 4.58 - 0.48 * hspMin), 2);
}

/** CR 6.10–6.12: capacidade nominal do banco `C = L·N / Pd` (Wh) e em Ah na tensão do sistema. */
export function bankCapacity(input: {
  dailyEnergyWh: number;
  autonomyDays: number;
  dodFraction: number;
  systemVoltageV: number;
}): { wh: number; ah: number } {
  const wh = (input.dailyEnergyWh * input.autonomyDays) / input.dodFraction;
  return { wh: roundTo(wh, 1), ah: roundTo(wh / input.systemVoltageV, 1) };
}

/** CR 6.17: baterias em série `Vsist / Vbat`. */
export const batteriesInSeries = (systemVoltageV: number, batteryVoltageV: number): number =>
  Math.max(1, Math.ceil(systemVoltageV / batteryVoltageV - 1e-9));

/** CR 6.16: baterias em paralelo `CBI / CBIbat`. */
export const batteriesInParallel = (bankAh: number, batteryAh: number): number =>
  Math.max(1, Math.ceil(bankAh / batteryAh - 1e-9));

/** CR 6.18: corrente do controlador `Ic = fator · Isc · Np` (fator típico 1,25). */
export const controllerCurrentA = (factor: number, iscA: number, parallelStrings: number): number =>
  factor * iscA * parallelStrings;

/** Potência do inversor: contínua = pico × (1 + margem); surto = pico de partida. */
export function inverterRequirement(input: { peakW: number; surgeW: number; margin: number }): {
  continuousW: number;
  surgeW: number;
} {
  return {
    continuousW: roundTo(input.peakW * (1 + input.margin), 1),
    surgeW: roundTo(input.surgeW, 1),
  };
}

/** Tensão do barramento recomendada pela potência do inversor (prática comum; o projetista pode trocar). */
export function recommendedSystemVoltage(peakW: number): 12 | 24 | 48 {
  if (peakW <= 1000) return 12;
  if (peakW <= 3000) return 24;
  return 48;
}

const LEAD_VRLA: BatteryChemistry[] = ['LEAD_AGM', 'LEAD_GEL'];

/** DoD máxima da regra para a química (%), ou `undefined` se a regra não traz o parâmetro. */
export function ruleDodLimitPct(
  chemistry: BatteryChemistry,
  parameters: Record<string, number | undefined>,
): number | undefined {
  if (chemistry === 'LEAD_FLOODED') return parameters.dodMaxLeadFlooded;
  if (LEAD_VRLA.includes(chemistry)) return parameters.dodMaxLeadVrla;
  if (chemistry === 'OPZS' || chemistry === 'OPZV') return parameters.dodMaxStationary;
  if (chemistry === 'LFP' || chemistry === 'NMC') return parameters.dodMaxLithium;
  return undefined;
}

/** Vida do banco por energia processada: `ciclos × capacidade × DoD do ensaio ÷ energia anual descarregada`. */
export function batteryLifeYears(input: {
  cycleLife?: number;
  cycleDodPct?: number;
  nominalWh: number;
  annualThroughputWh: number;
  calendarLifeYears?: number;
}): number | null {
  const calendar = input.calendarLifeYears ?? Infinity;
  let cycle = Infinity;
  if (input.cycleLife && input.cycleDodPct && input.annualThroughputWh > 0)
    cycle =
      (input.cycleLife * input.nominalWh * (input.cycleDodPct / 100)) / input.annualThroughputWh;
  const years = Math.min(calendar, cycle);
  return Number.isFinite(years) ? roundTo(years, 1) : null;
}
