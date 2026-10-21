import type {
  BatterySpec,
  ChargeControllerSpec,
  GeneratorSpec,
  ModuleSpec,
  OffgridCheck,
  OffgridDesign,
  OffgridInverterSpec,
  OffgridLoadResult,
  OffgridSelected,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import type { EquipmentStatusLite } from '../engine/compatibility.js';
import { cellTemperatureC, vocColdV, voltageAtTemperatureV } from '../engine/thermal.js';
import type { OffgridParams } from './parameters.js';
import { ruleDodLimitPct } from './sizing.js';

/**
 * OFF-F04..F06: confere o que o projetista escolheu (arranjo, banco, controlador, inversor, gerador) contra as fichas
 * do catálogo e devolve o resumo e as verificações. Equações: CRESESB 6.4–6.9 (strings), 6.16–6.17 (banco), 6.18–6.20
 * (controlador). Memorial: `docs/06-calculos/offgrid-compatibilidade.md`.
 */
export const OFFGRID_SELECTION_VERSION = 'offgrid-selection-1.0.0';

export interface OffgridEquipmentContext {
  modules: Record<string, ModuleSpec | undefined>;
  batteries: Record<string, BatterySpec | undefined>;
  controllers: Record<string, ChargeControllerSpec | undefined>;
  inverters: Record<string, OffgridInverterSpec | undefined>;
  generators: Record<string, GeneratorSpec | undefined>;
  status?: Record<string, EquipmentStatusLite | undefined>;
}

export interface ArrayPower {
  id: string;
  modules: number;
  pmaxWp: number;
  gammaPctPerC: number;
  noctC: number;
  lossFraction: number;
  azimuthDegrees: number;
  tiltDegrees: number;
}

export interface DispatchEquipment {
  arrays: ArrayPower[];
  nominalWh: number;
  usableWh: number;
  roundTripEfficiency: number;
  maxChargeW: number;
  maxDischargeW: number;
  controllerEfficiency: number;
  controllerLimitW: number;
  inverterContinuousW: number;
  inverterSurgeW: number;
  inverterEfficiency: number;
  inverterStandbyW: number;
  inverterChargerW: number;
  generator: GeneratorSpec | null;
  designDodFraction: number;
  battery: BatterySpec | null;
}

export interface SelectionResult {
  selected: OffgridSelected | null;
  equipment: DispatchEquipment | null;
  checks: OffgridCheck[];
  pending: { code: string; message: string }[];
}

const ok = (code: string, message: string, extra: Partial<OffgridCheck> = {}): OffgridCheck => ({
  code,
  severity: 'OK',
  message,
  ...extra,
});
const warn = (code: string, message: string, extra: Partial<OffgridCheck> = {}): OffgridCheck => ({
  code,
  severity: 'WARNING',
  message,
  ...extra,
});
const error = (code: string, message: string, extra: Partial<OffgridCheck> = {}): OffgridCheck => ({
  code,
  severity: 'ERROR',
  message,
  ...extra,
});

/** Controlador MPPT/PWM efetivo: o controlador escolhido ou o MPPT embutido do inversor. */
interface ChargePath {
  kind: 'MPPT' | 'PWM';
  label: string;
  vocMaxV: number;
  mpptMinV?: number;
  mpptMaxV?: number;
  currentA: number;
  powerMaxW?: number;
  efficiency: number;
}

function chargePath(
  design: OffgridDesign,
  eq: OffgridEquipmentContext,
): { path: ChargePath | null; builtIn: boolean } {
  const controller = design.controllerId ? eq.controllers[design.controllerId] : undefined;
  if (controller) {
    const count = design.controllerCount;
    return {
      builtIn: false,
      path: {
        kind: controller.technology,
        label: 'controlador de carga',
        vocMaxV: controller.pvVocMaxV,
        mpptMinV: controller.mpptMinV,
        mpptMaxV: controller.mpptMaxV,
        currentA: controller.ratedChargeCurrentA * count,
        powerMaxW: controller.pvPowerMaxW ? controller.pvPowerMaxW * count : undefined,
        efficiency: (controller.efficiencyPct ?? 97) / 100,
      },
    };
  }
  const inverter = design.inverterId ? eq.inverters[design.inverterId] : undefined;
  if (inverter?.mpptBuiltIn && inverter.pvVocMaxV && inverter.mpptCurrentA) {
    const count = design.inverterCount;
    return {
      builtIn: true,
      path: {
        kind: 'MPPT',
        label: 'MPPT embutido no inversor',
        vocMaxV: inverter.pvVocMaxV,
        mpptMinV: inverter.mpptMinV,
        mpptMaxV: inverter.mpptMaxV,
        currentA: inverter.mpptCurrentA * (inverter.mpptCount ?? 1) * count,
        powerMaxW: inverter.pvPowerMaxW
          ? inverter.pvPowerMaxW * (inverter.mpptCount ?? 1) * count
          : undefined,
        efficiency: (inverter.efficiencyPct ?? 97) / 100,
      },
    };
  }
  return { path: null, builtIn: false };
}

export function evaluateSelection(input: {
  design: OffgridDesign;
  equipment: OffgridEquipmentContext;
  params: OffgridParams;
  load: OffgridLoadResult;
  dailyBatteryWh: number;
  minAmbientC: number | null;
  maxAmbientC: number | null;
}): SelectionResult {
  const { design, equipment: eq, params, load } = input;
  const checks: OffgridCheck[] = [];
  const pending: SelectionResult['pending'] = [];
  const vsys = design.systemVoltageV;

  const requireApproved = (id: string | undefined, label: string): void => {
    if (!id) return;
    const status = eq.status?.[id];
    if (status === undefined)
      checks.push(error('EQUIPMENT_NOT_FOUND', `${label} não está no catálogo da empresa.`));
    else if (status !== 'APPROVED')
      checks.push(
        error('EQUIPMENT_NOT_APPROVED', `${label} não está aprovado no catálogo (${status}).`),
      );
  };

  // ---- Arranjos ----
  const arrays: ArrayPower[] = [];
  for (const array of design.arrays) {
    const module = array.moduleId ? eq.modules[array.moduleId] : undefined;
    if (!array.moduleId) {
      pending.push({
        code: 'MODULE_NOT_SELECTED',
        message: `O arranjo "${array.name}" não tem módulo escolhido.`,
      });
      continue;
    }
    requireApproved(array.moduleId, `O módulo do arranjo "${array.name}"`);
    if (!module) continue;
    arrays.push({
      id: array.id,
      modules: array.modulesInSeries * array.parallelStrings,
      pmaxWp: module.pmaxWp,
      gammaPctPerC: module.gammaPmaxPctPerC,
      noctC: module.noctC ?? 45,
      lossFraction: array.shadingLossPct / 100,
      azimuthDegrees: array.azimuthDegrees,
      tiltDegrees: array.tiltDegrees,
    });
  }
  if (design.arrays.length === 0)
    pending.push({ code: 'NO_ARRAYS', message: 'Nenhum arranjo fotovoltaico foi cadastrado.' });
  const pvPowerWp = arrays.reduce((a, r) => a + r.modules * r.pmaxWp, 0);

  // ---- Controlador / MPPT: tensão e corrente ----
  const { path, builtIn } = chargePath(design, eq);
  if (design.controllerId) requireApproved(design.controllerId, 'O controlador de carga');
  if (!path)
    pending.push({
      code: 'CONTROLLER_NOT_SELECTED',
      message: 'Escolha um controlador de carga (ou um inversor com MPPT embutido).',
    });
  if (path && arrays.length === design.arrays.length) {
    const tMin = input.minAmbientC;
    const tMax = input.maxAmbientC ?? 40;
    if (tMin === null)
      pending.push({
        code: 'DESIGN_TMIN_MISSING',
        message: 'Sem temperatura mínima de projeto: a Voc a frio não pode ser conferida.',
      });
    let totalIsc = 0;
    for (const array of design.arrays) {
      const module = array.moduleId ? eq.modules[array.moduleId] : undefined;
      if (!module) continue;
      const ns = array.modulesInSeries;
      totalIsc += module.iscA * array.parallelStrings;
      if (tMin !== null) {
        const vocCold =
          ns *
          vocColdV({
            vocStcV: module.vocV,
            betaVocPctPerC: module.betaVocPctPerC,
            minAmbientC: tMin,
          }) *
          params.vocColdFactor;
        checks.push(
          vocCold <= path.vocMaxV
            ? ok(
                'VOC_COLD_OK',
                `Arranjo "${array.name}": Voc a frio (${roundTo(vocCold, 1)} V) dentro do limite do ${path.label}.`,
                { value: roundTo(vocCold, 1), limit: path.vocMaxV, unit: 'V' },
              )
            : error(
                'VOC_COLD_EXCEEDS',
                `Arranjo "${array.name}": Voc a frio (${roundTo(vocCold, 1)} V) passa do limite do ${path.label} (${path.vocMaxV} V).`,
                { value: roundTo(vocCold, 1), limit: path.vocMaxV, unit: 'V' },
              ),
        );
      }
      const vmpHot =
        ns *
        voltageAtTemperatureV({
          stcVoltageV: module.vmppV,
          coefficientPctPerC: module.betaVmppPctPerC ?? module.betaVocPctPerC,
          cellTemperatureC: cellTemperatureC({
            ambientC: tMax,
            noctC: module.noctC ?? 45,
            irradianceWm2: 1000,
          }),
        });
      if (path.kind === 'MPPT') {
        if (path.mpptMinV !== undefined && vmpHot < path.mpptMinV)
          checks.push(
            error(
              'VMPP_BELOW_MPPT',
              `Arranjo "${array.name}": Vmpp a quente (${roundTo(vmpHot, 1)} V) abaixo do mínimo do MPPT (${path.mpptMinV} V).`,
              { value: roundTo(vmpHot, 1), limit: path.mpptMinV, unit: 'V' },
            ),
          );
        else if (path.mpptMinV !== undefined)
          checks.push(
            ok('VMPP_HOT_OK', `Arranjo "${array.name}": Vmpp a quente dentro da faixa do MPPT.`),
          );
        // O MPPT também precisa de tensão acima da do banco para carregar.
        if (vmpHot < vsys * params.chargeVoltageFactor)
          checks.push(
            error(
              'ARRAY_BELOW_CHARGE_VOLTAGE',
              `Arranjo "${array.name}": Vmpp a quente (${roundTo(vmpHot, 1)} V) abaixo da tensão de carga do banco (${roundTo(vsys * params.chargeVoltageFactor, 1)} V).`,
              {
                value: roundTo(vmpHot, 1),
                limit: roundTo(vsys * params.chargeVoltageFactor, 1),
                unit: 'V',
              },
            ),
          );
      } else if (vmpHot < vsys * params.chargeVoltageFactor)
        checks.push(
          error(
            'PWM_CANNOT_CHARGE',
            `Arranjo "${array.name}": com PWM a tensão do arranjo (${roundTo(vmpHot, 1)} V a quente) não alcança a de carga (${roundTo(vsys * params.chargeVoltageFactor, 1)} V).`,
            {
              value: roundTo(vmpHot, 1),
              limit: roundTo(vsys * params.chargeVoltageFactor, 1),
              unit: 'V',
            },
          ),
        );
    }
    const needed = params.controllerCurrentFactor * totalIsc;
    checks.push(
      needed <= path.currentA
        ? ok('CONTROLLER_CURRENT_OK', 'Corrente do controlador atende o arranjo.', {
            value: roundTo(needed, 1),
            limit: path.currentA,
            unit: 'A',
          })
        : error(
            'CONTROLLER_CURRENT_EXCEEDED',
            `Corrente exigida (${roundTo(needed, 1)} A = ${params.controllerCurrentFactor} × Isc total) passa da capacidade do ${path.label} (${path.currentA} A).`,
            { value: roundTo(needed, 1), limit: path.currentA, unit: 'A' },
          ),
    );
    if (path.powerMaxW !== undefined)
      checks.push(
        pvPowerWp <= path.powerMaxW
          ? ok('CONTROLLER_POWER_OK', 'Potência FV dentro do limite do controlador.')
          : warn(
              'CONTROLLER_POWER_EXCEEDED',
              `Potência FV (${roundTo(pvPowerWp, 0)} Wp) acima do máximo do ${path.label} (${path.powerMaxW} W).`,
              { value: roundTo(pvPowerWp, 0), limit: path.powerMaxW, unit: 'W' },
            ),
      );
    const controller = design.controllerId ? eq.controllers[design.controllerId] : undefined;
    if (controller) {
      if (controller.batteryVoltageV < vsys)
        checks.push(
          error(
            'CONTROLLER_VOLTAGE_MISMATCH',
            `O controlador aceita no máximo ${controller.batteryVoltageV} V de banco e o sistema é de ${vsys} V.`,
          ),
        );
      else if (controller.batteryVoltageV > vsys && !controller.autoVoltage)
        checks.push(
          warn(
            'CONTROLLER_VOLTAGE_HIGHER',
            `O controlador é de ${controller.batteryVoltageV} V e não reconhece tensões menores automaticamente.`,
          ),
        );
    }
  }

  // ---- Banco de baterias ----
  const battery = design.bank.batteryId ? eq.batteries[design.bank.batteryId] : undefined;
  let nominalWh = 0;
  let usableWh = 0;
  let bankAh = 0;
  let batteryCount = 0;
  let designDod = 0;
  let maxChargeW = 0;
  let maxDischargeW = 1e9;
  if (!design.bank.batteryId)
    pending.push({ code: 'BATTERY_NOT_SELECTED', message: 'Escolha a bateria do banco.' });
  else {
    requireApproved(design.bank.batteryId, 'A bateria');
    if (battery) {
      const { seriesCount, parallelCount } = design.bank;
      batteryCount = seriesCount * parallelCount;
      const bankVoltage = seriesCount * battery.nominalVoltageV;
      bankAh = parallelCount * battery.capacityAh;
      nominalWh = bankVoltage * bankAh;
      checks.push(
        Math.abs(bankVoltage - vsys) / vsys <= 0.1
          ? ok(
              'BANK_VOLTAGE_OK',
              `Banco de ${roundTo(bankVoltage, 1)} V compatível com o sistema de ${vsys} V.`,
            )
          : error(
              'BANK_VOLTAGE_MISMATCH',
              `O banco (${seriesCount} × ${battery.nominalVoltageV} V = ${roundTo(bankVoltage, 1)} V) não bate com a tensão do sistema (${vsys} V).`,
              { value: roundTo(bankVoltage, 1), limit: vsys, unit: 'V' },
            ),
      );
      const ruleDod = ruleDodLimitPct(battery.chemistry, params);
      const dodPct = Math.min(
        design.bank.designDodPct ?? battery.maxDodPct,
        battery.maxDodPct,
        ruleDod ?? 100,
      );
      designDod = dodPct / 100;
      usableWh = nominalWh * designDod;
      if (design.bank.designDodPct !== undefined && design.bank.designDodPct > dodPct)
        checks.push(
          warn(
            'DOD_LIMITED',
            `A DoD pedida (${design.bank.designDodPct}%) foi limitada a ${dodPct}% pela ficha ou pela regra.`,
          ),
        );
      const parallelLimit = Math.min(battery.maxParallel ?? Infinity, params.maxBatteriesParallel);
      checks.push(
        parallelCount <= parallelLimit
          ? ok('BANK_PARALLEL_OK', `${parallelCount} série(s) em paralelo, dentro do limite.`)
          : error(
              'BANK_PARALLEL_EXCEEDED',
              `${parallelCount} baterias em paralelo passam do limite (${parallelLimit}): desequilibra a corrente entre as colunas.`,
              { value: parallelCount, limit: parallelLimit },
            ),
      );
      const chargeLimits: number[] = [];
      if (battery.maxChargeCurrentA)
        chargeLimits.push(battery.maxChargeCurrentA * parallelCount * vsys);
      if (battery.chemistry !== 'LFP' && battery.chemistry !== 'NMC')
        chargeLimits.push(params.maxChargeCRate * bankAh * vsys);
      maxChargeW = chargeLimits.length > 0 ? Math.min(...chargeLimits) : 0.5 * bankAh * vsys;
      if (battery.maxDischargeCurrentA)
        maxDischargeW = battery.maxDischargeCurrentA * parallelCount * vsys;
      if (path) {
        const pvCurrent = pvPowerWp / vsys;
        const cRate = pvCurrent / bankAh;
        const limitC = maxChargeW / vsys / bankAh;
        checks.push(
          cRate <= limitC + 1e-9
            ? ok('CHARGE_RATE_OK', 'Corrente de carga do FV dentro do limite do banco.', {
                value: roundTo(cRate, 3),
                limit: roundTo(limitC, 3),
                unit: 'C',
              })
            : warn(
                'CHARGE_RATE_HIGH',
                `O FV pode carregar o banco a C/${roundTo(1 / cRate, 1)}, acima do limite (C/${roundTo(1 / limitC, 1)}); o excedente é limitado.`,
                { value: roundTo(cRate, 3), limit: roundTo(limitC, 3), unit: 'C' },
              ),
        );
      }
      if (design.bank.temperatureC < 15)
        checks.push(
          warn(
            'BATTERY_COLD',
            'Banco em local frio: a capacidade disponível cai com a temperatura (não considerada no cálculo).',
          ),
        );
      const autonomyMin = params.autonomyMinDays;
      const autonomy = input.dailyBatteryWh > 0 ? usableWh / input.dailyBatteryWh : 0;
      checks.push(
        autonomy + 1e-9 >= autonomyMin
          ? ok('AUTONOMY_OK', `Autonomia de ${roundTo(autonomy, 2)} dia(s).`, {
              value: roundTo(autonomy, 2),
              limit: autonomyMin,
              unit: 'dias',
            })
          : error(
              'AUTONOMY_BELOW_MIN',
              `Autonomia de ${roundTo(autonomy, 2)} dia(s) abaixo do mínimo (${autonomyMin}).`,
              { value: roundTo(autonomy, 2), limit: autonomyMin, unit: 'dias' },
            ),
      );
    }
  }

  // ---- Inversor ----
  const inverter = design.inverterId ? eq.inverters[design.inverterId] : undefined;
  let inverterContinuousW = 0;
  let inverterSurgeW = 0;
  if (!design.inverterId)
    pending.push({ code: 'INVERTER_NOT_SELECTED', message: 'Escolha o inversor.' });
  else {
    requireApproved(design.inverterId, 'O inversor');
    if (inverter) {
      const count = design.inverterCount;
      inverterContinuousW = inverter.pContinuousW * count;
      inverterSurgeW = (inverter.pSurgeW ?? inverter.pContinuousW) * count;
      checks.push(
        inverter.batteryVoltageV === vsys
          ? ok('INVERTER_VOLTAGE_OK', 'Tensão do inversor igual à do banco.')
          : error(
              'INVERTER_VOLTAGE_MISMATCH',
              `O inversor é de ${inverter.batteryVoltageV} V e o banco é de ${vsys} V.`,
            ),
      );
      const needed = load.peakW * (1 + params.inverterSurgeMargin);
      checks.push(
        inverterContinuousW >= needed
          ? ok('INVERTER_POWER_OK', 'Potência contínua do inversor atende o pico com a margem.', {
              value: roundTo(needed, 0),
              limit: inverterContinuousW,
              unit: 'W',
            })
          : error(
              'INVERTER_POWER_LOW',
              `Pico de ${roundTo(load.peakW, 0)} W com margem exige ${roundTo(needed, 0)} W; o inversor entrega ${roundTo(inverterContinuousW, 0)} W.`,
              { value: roundTo(needed, 0), limit: inverterContinuousW, unit: 'W' },
            ),
      );
      checks.push(
        inverterSurgeW >= load.surgeW
          ? ok('INVERTER_SURGE_OK', 'Capacidade de surto atende a partida das cargas.')
          : error(
              'INVERTER_SURGE_LOW',
              `Partida de ${roundTo(load.surgeW, 0)} W excede o surto do inversor (${roundTo(inverterSurgeW, 0)} W).`,
              { value: roundTo(load.surgeW, 0), limit: inverterSurgeW, unit: 'W' },
            ),
      );
      if (
        inverter.efficiencyPct !== undefined &&
        inverter.efficiencyPct / 100 < params.inverterEfficiencyMin
      )
        checks.push(
          warn(
            'INVERTER_EFFICIENCY_LOW',
            `Eficiência do inversor (${inverter.efficiencyPct}%) abaixo da mínima da regra (${roundTo(params.inverterEfficiencyMin * 100, 1)}%).`,
          ),
        );
      if (design.systemType === 'HYBRID') {
        if (inverter.topology !== 'HYBRID' || !inverter.gridInput)
          checks.push(
            error(
              'INVERTER_NOT_HYBRID',
              'Sistema híbrido exige inversor híbrido com entrada de rede.',
            ),
          );
        else checks.push(ok('INVERTER_HYBRID_OK', 'Inversor híbrido com entrada de rede.'));
      }
      if (design.generator.enabled && !inverter.generatorInput)
        checks.push(
          warn(
            'INVERTER_NO_GENERATOR_INPUT',
            'O inversor não tem entrada de gerador: o gerador só alimentará cargas por transferência manual.',
          ),
        );
      if (!inverter.sineWave)
        checks.push(warn('INVERTER_NOT_SINE', 'Inversor sem onda senoidal pura.'));
    }
  }

  // ---- Gerador ----
  const generator =
    design.generator.enabled && design.generator.generatorId
      ? (eq.generators[design.generator.generatorId] ?? null)
      : null;
  if (design.generator.enabled) {
    if (!design.generator.generatorId)
      pending.push({ code: 'GENERATOR_NOT_SELECTED', message: 'Escolha o gerador.' });
    else {
      requireApproved(design.generator.generatorId, 'O gerador');
      if (generator) {
        const chargerW = (inverter?.chargerCurrentA ?? 0) * vsys;
        checks.push(
          generator.pContinuousW >= load.peakW
            ? ok('GENERATOR_POWER_OK', 'Gerador atende o pico das cargas.')
            : error(
                'GENERATOR_POWER_LOW',
                `Gerador (${generator.pContinuousW} W) abaixo do pico das cargas (${roundTo(load.peakW, 0)} W).`,
                { value: roundTo(load.peakW, 0), limit: generator.pContinuousW, unit: 'W' },
              ),
        );
        if (generator.pContinuousW < load.peakW + chargerW)
          checks.push(
            warn(
              'GENERATOR_CHARGING_LIMITED',
              'Gerador sem folga para alimentar as cargas e carregar o banco ao mesmo tempo: a recarga será menor.',
            ),
          );
      }
    }
    if (design.generator.stopSocPct <= design.generator.startSocPct)
      checks.push(
        error('GENERATOR_SOC_INVERTED', 'O SOC de parada deve ser maior que o de partida.'),
      );
  }

  const complete =
    arrays.length === design.arrays.length &&
    arrays.length > 0 &&
    path !== null &&
    battery !== undefined &&
    inverter !== undefined &&
    (!design.generator.enabled || generator !== null);

  if (!complete)
    return {
      selected: null,
      equipment: null,
      checks,
      pending,
    };

  const limitW = Math.min(
    path.currentA * vsys * params.chargeVoltageFactor,
    path.powerMaxW ?? Infinity,
  );
  const selected: OffgridSelected = {
    pvPowerWp: roundTo(pvPowerWp, 1),
    moduleCount: arrays.reduce((a, r) => a + r.modules, 0),
    bankNominalWh: roundTo(nominalWh, 0),
    bankUsableWh: roundTo(usableWh, 0),
    bankAh: roundTo(bankAh, 1),
    batteryCount,
    controllerCurrentA: roundTo(path.currentA, 1),
    inverterContinuousW: roundTo(inverterContinuousW, 0),
    inverterSurgeW: roundTo(inverterSurgeW, 0),
    generatorW: generator ? generator.pContinuousW : 0,
  };
  void builtIn;
  return {
    selected,
    equipment: {
      arrays,
      nominalWh,
      usableWh,
      roundTripEfficiency:
        (battery?.roundTripEfficiencyPct ?? 0) > 0
          ? (battery?.roundTripEfficiencyPct as number) / 100
          : (design.batteryEfficiency ?? params.batteryEfficiencyDefault),
      maxChargeW,
      maxDischargeW,
      controllerEfficiency: path.efficiency,
      controllerLimitW: limitW,
      inverterContinuousW,
      inverterSurgeW,
      inverterEfficiency: Math.max(
        0.5,
        (inverter?.efficiencyPct ?? 0) > 0
          ? (inverter?.efficiencyPct as number) / 100
          : (design.inverterEfficiency ?? params.inverterEfficiencyMin),
      ),
      inverterStandbyW: (inverter?.standbyW ?? 0) * design.inverterCount,
      inverterChargerW: (inverter?.chargerCurrentA ?? 0) * vsys * design.inverterCount * 1,
      generator,
      designDodFraction: designDod,
      battery: battery ?? null,
    },
    checks,
    pending,
  };
}
