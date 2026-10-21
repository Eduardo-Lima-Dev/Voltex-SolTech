import type {
  BatterySpec,
  ChargeControllerSpec,
  ModuleSpec,
  OffgridDesign,
  OffgridInverterSpec,
  OffgridSuggestion,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { cellTemperatureC, vocColdV, voltageAtTemperatureV } from '../engine/thermal.js';
import { profileLoads } from './load.js';
import { resolveParameters } from './parameters.js';
import { computeOffgridResults, type OffgridContext } from './project.js';
import { buildYear, describeResource, orientationsOf } from './resource.js';
import {
  bankCapacity,
  batteriesInParallel,
  batteriesInSeries,
  dailyBatteryEnergyWh,
  pvPeakPowerWp,
  ruleDodLimitPct,
} from './sizing.js';

/**
 * OFF-F10: sugestor de dimensionamento. Parte do mês crítico (CRESESB), enumera combinações do catálogo **aprovado**
 * (módulo × bateria × controlador × inversor), descarta as que não passam nas verificações elétricas, ordena por custo e
 * confirma as melhores com a simulação horária (perda de carga dentro do limite da regra). Sempre uma sugestão a
 * confirmar pelo projetista. Memorial: `docs/06-calculos/offgrid-dimensionamento.md`.
 */
export const OFFGRID_SUGGEST_VERSION = 'offgrid-suggest-1.0.0';

export interface SuggestCandidate<T> {
  id: string;
  spec: T;
  priceCents: number | null;
}

export interface SuggestCatalog {
  modules: SuggestCandidate<ModuleSpec>[];
  batteries: SuggestCandidate<BatterySpec>[];
  controllers: SuggestCandidate<ChargeControllerSpec>[];
  inverters: SuggestCandidate<OffgridInverterSpec>[];
}

const TOP = 5;
const SIMULATED = 12;

const cheapest = <T>(
  list: SuggestCandidate<T>[],
  per: (c: SuggestCandidate<T>) => number,
): SuggestCandidate<T>[] => [...list].sort((a, b) => per(a) - per(b)).slice(0, TOP);

export function suggestOffgrid(input: {
  design: OffgridDesign;
  catalog: SuggestCatalog;
  context: Omit<
    OffgridContext,
    'modules' | 'batteries' | 'controllers' | 'inverters' | 'status' | 'prices'
  >;
  limit: number;
}): OffgridSuggestion[] {
  const { design, catalog, limit } = input;
  const { params } = resolveParameters(input.context.parameters);
  const load = profileLoads(design.loads);
  if (design.loads.length === 0) return [];
  const vsys = design.systemVoltageV;
  const etaBat = design.batteryEfficiency ?? params.batteryEfficiencyDefault;
  const etaInv = design.inverterEfficiency ?? params.inverterEfficiencyMin;
  const red1 = design.red1 ?? params.red1Default;
  const red2 = design.red2 ?? params.red2Default;

  const orientations = orientationsOf({ arrays: [], site: design.site }, () => 1);
  const first = design.arrays[0];
  if (first)
    orientations[0] = {
      azimuthDegrees: first.azimuthDegrees,
      tiltDegrees: first.tiltDegrees,
      weight: 1,
    };
  const year = buildYear(design, orientations, input.context.series);
  if (!year) return [];
  const resource = describeResource(year, orientations, load.monthlyDailyWh);
  const monthly = load.monthlyDailyAcWh.map((ac, m) =>
    dailyBatteryEnergyWh({
      acWh: ac,
      dcWh: load.monthlyDailyDcWh[m] as number,
      batteryEfficiency: etaBat,
      inverterEfficiency: etaInv,
    }),
  );
  const dailyBatteryWh = Math.max(...monthly);
  const pv = pvPeakPowerWp({
    monthlyEnergyWh: monthly,
    monthlyHsp: resource.hspMonthly,
    red1,
    red2,
  });
  if (!Number.isFinite(pv.wp)) return [];
  const autonomy = Math.max(design.autonomyDays, params.autonomyMinDays);
  const tMin = design.site.designTminC ?? 0;
  const tMax = design.site.designTmaxAmbientC ?? 40;
  const needPower = load.peakW * (1 + params.inverterSurgeMargin);

  const inverters = cheapest(
    catalog.inverters.filter(
      (i) =>
        i.spec.batteryVoltageV === vsys &&
        (design.systemType !== 'HYBRID' || (i.spec.topology === 'HYBRID' && i.spec.gridInput)),
    ),
    (i) => i.priceCents ?? Infinity,
  );
  const batteries = cheapest(
    catalog.batteries.filter(
      (b) =>
        Math.abs(batteriesInSeries(vsys, b.spec.nominalVoltageV) * b.spec.nominalVoltageV - vsys) /
          vsys <=
        0.1,
    ),
    (b) => (b.priceCents ?? Infinity) / (b.spec.capacityAh * b.spec.nominalVoltageV),
  );
  const modules = cheapest(catalog.modules, (m) => (m.priceCents ?? Infinity) / m.spec.pmaxWp);
  const controllers = cheapest(
    catalog.controllers.filter((c) => c.spec.batteryVoltageV >= vsys),
    (c) => c.priceCents ?? Infinity,
  );

  interface Option {
    suggestion: OffgridSuggestion;
    design: OffgridDesign;
    capex: number | null;
  }
  const options: Option[] = [];
  const price = (c: { priceCents: number | null }, qty: number): number | null =>
    c.priceCents === null ? null : c.priceCents * qty;
  const add = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a + b;

  for (const inverter of inverters) {
    const invCount = Math.max(1, Math.ceil(needPower / inverter.spec.pContinuousW));
    if (invCount > 3) continue;
    if ((inverter.spec.pSurgeW ?? inverter.spec.pContinuousW) * invCount < load.surgeW) continue;
    for (const battery of batteries) {
      const dodPct = Math.min(
        battery.spec.maxDodPct,
        ruleDodLimitPct(battery.spec.chemistry, params) ?? 100,
      );
      const bank = bankCapacity({
        dailyEnergyWh: dailyBatteryWh,
        autonomyDays: autonomy,
        dodFraction: dodPct / 100,
        systemVoltageV: vsys,
      });
      const series = batteriesInSeries(vsys, battery.spec.nominalVoltageV);
      const parallel = batteriesInParallel(bank.ah, battery.spec.capacityAh);
      if (parallel > Math.min(battery.spec.maxParallel ?? Infinity, params.maxBatteriesParallel))
        continue;
      for (const module of modules) {
        const vocCold =
          vocColdV({
            vocStcV: module.spec.vocV,
            betaVocPctPerC: module.spec.betaVocPctPerC,
            minAmbientC: tMin,
          }) * params.vocColdFactor;
        const vmpHot = voltageAtTemperatureV({
          stcVoltageV: module.spec.vmppV,
          coefficientPctPerC: module.spec.betaVmppPctPerC ?? module.spec.betaVocPctPerC,
          cellTemperatureC: cellTemperatureC({
            ambientC: tMax,
            noctC: module.spec.noctC ?? 45,
            irradianceWm2: 1000,
          }),
        });
        const modulesNeeded = Math.ceil(pv.wp / module.spec.pmaxWp);
        for (const controller of controllers) {
          const maxNs = Math.floor(controller.spec.pvVocMaxV / vocCold);
          const minVoltage = Math.max(
            controller.spec.mpptMinV ?? 0,
            vsys * params.chargeVoltageFactor,
          );
          const minNs = Math.ceil(minVoltage / vmpHot);
          if (minNs > maxNs) continue;
          const ns = minNs;
          const np = Math.max(1, Math.ceil(modulesNeeded / ns));
          const count = Math.ceil(
            (params.controllerCurrentFactor * module.spec.iscA * np) /
              controller.spec.ratedChargeCurrentA,
          );
          if (count > 4) continue;
          const modulesTotal = ns * np;
          const capex = add(
            add(
              add(price(module, modulesTotal), price(battery, series * parallel)),
              price(controller, count),
            ),
            price(inverter, invCount),
          );
          const arrayDesign: OffgridDesign = {
            ...design,
            arrays: [
              {
                id: 'a1',
                name: 'Arranjo 1',
                moduleId: module.id,
                modulesInSeries: ns,
                parallelStrings: np,
                azimuthDegrees: (orientations[0] as { azimuthDegrees: number }).azimuthDegrees,
                tiltDegrees: (orientations[0] as { tiltDegrees: number }).tiltDegrees,
                shadingLossPct: first ? first.shadingLossPct : 0,
              },
            ],
            bank: {
              ...design.bank,
              batteryId: battery.id,
              seriesCount: series,
              parallelCount: parallel,
            },
            controllerId: controller.id,
            controllerCount: count,
            inverterId: inverter.id,
            inverterCount: invCount,
            stress: { ...design.stress, enabled: false },
          };
          options.push({
            capex,
            design: arrayDesign,
            suggestion: {
              moduleId: module.id,
              batteryId: battery.id,
              controllerId: controller.id,
              inverterId: inverter.id,
              systemVoltageV: vsys,
              modulesInSeries: ns,
              parallelStrings: np,
              batterySeries: series,
              batteryParallel: parallel,
              inverterCount: invCount,
              pvPowerWp: roundTo(modulesTotal * module.spec.pmaxWp, 0),
              bankNominalWh: roundTo(
                series * parallel * battery.spec.nominalVoltageV * battery.spec.capacityAh,
                0,
              ),
              capexCents: capex,
              lolpPct: null,
              notes: [],
            },
          });
        }
      }
    }
  }

  options.sort(
    (a, b) =>
      (a.capex ?? Infinity) - (b.capex ?? Infinity) ||
      b.suggestion.pvPowerWp - a.suggestion.pvPowerWp,
  );
  const confirmed: OffgridSuggestion[] = [];
  const context: OffgridContext = {
    ...input.context,
    modules: Object.fromEntries(catalog.modules.map((c) => [c.id, c.spec])),
    batteries: Object.fromEntries(catalog.batteries.map((c) => [c.id, c.spec])),
    controllers: Object.fromEntries(catalog.controllers.map((c) => [c.id, c.spec])),
    inverters: Object.fromEntries(catalog.inverters.map((c) => [c.id, c.spec])),
    generators: {},
    status: Object.fromEntries(
      [...catalog.modules, ...catalog.batteries, ...catalog.controllers, ...catalog.inverters].map(
        (c) => [c.id, 'APPROVED' as const],
      ),
    ),
  };
  for (const option of options.slice(0, SIMULATED)) {
    const results = computeOffgridResults(option.design, context);
    const errors = results.checks.filter(
      (c) => c.severity === 'ERROR' && c.code !== 'LOLP_EXCEEDS',
    );
    if (errors.length > 0 || !results.simulation) continue;
    const lolp = results.simulation.lolpPct;
    const notes: string[] = [];
    if (lolp > params.lolpMaxPct)
      notes.push(
        `Perda de carga de ${lolp}% acima do limite (${params.lolpMaxPct}%): aumente FV ou banco.`,
      );
    if (option.capex === null) notes.push('Sem preço de algum item: custo incompleto.');
    confirmed.push({ ...option.suggestion, lolpPct: lolp, notes });
  }
  confirmed.sort(
    (a, b) =>
      Number((a.lolpPct ?? 100) > params.lolpMaxPct) -
        Number((b.lolpPct ?? 100) > params.lolpMaxPct) ||
      (a.capexCents ?? Infinity) - (b.capexCents ?? Infinity),
  );
  return confirmed.slice(0, limit);
}
