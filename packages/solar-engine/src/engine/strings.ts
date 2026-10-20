import type { Ampere, Volt, Watt } from '../units/index.js';

/**
 * Associação série/paralelo de módulos (ENG-F05, EnergIF 2023 p. 41–42, EF-G09 resolvida) e limites de
 * número de módulos por string (ENG-F06). Memorial: `docs/06-calculos/engine-compatibilidade.md`.
 */
export const STRINGS_ALGORITHM_VERSION = 'strings-1.0.0';

export interface ArrayElectrical {
  voltageV: Volt;
  currentA: Ampere;
  powerW: Watt;
}

/** `V = Ns × Vmod`, `I = Np × Imod`, `P = V × I` (módulos iguais). */
export function arrayElectrical(input: {
  modulesInSeries: number;
  stringsInParallel: number;
  moduleVoltageV: Volt;
  moduleCurrentA: Ampere;
}): ArrayElectrical {
  assertPositiveInteger(input.modulesInSeries, 'modulesInSeries');
  assertPositiveInteger(input.stringsInParallel, 'stringsInParallel');
  const voltageV = input.modulesInSeries * input.moduleVoltageV;
  const currentA = input.stringsInParallel * input.moduleCurrentA;
  return { voltageV, currentA, powerW: voltageV * currentA };
}

export interface StringLimitsInput {
  /** Voc do módulo no frio (ENG-F02). */
  vocColdV: Volt;
  /** Vmpp do módulo no quente e no frio (ENG-F03). */
  vmppHotV: Volt;
  vmppColdV: Volt;
  inverter: {
    maxDcVoltageV: Volt;
    mpptMinV: Volt;
    mpptMaxV: Volt;
    startVoltageV?: Volt | undefined;
  };
  /** Tensão máxima do sistema do módulo (V), quando informada. */
  moduleMaxSystemVoltageV?: Volt | undefined;
}

export interface StringLimits {
  /** Maior nº de módulos em série: tensão máxima do inversor (Voc frio) e do MPPT (Vmpp frio). */
  maxModules: number;
  /** Menor nº de módulos em série: tensão mínima do MPPT (Vmpp quente) e de partida (Vmpp quente). */
  minModules: number;
  /** Qual limite decidiu o máximo e o mínimo (explicação ao usuário). */
  maxLimitedBy: 'INVERTER_MAX_VOLTAGE' | 'MPPT_MAX_VOLTAGE' | 'MODULE_SYSTEM_VOLTAGE';
  minLimitedBy: 'MPPT_MIN_VOLTAGE' | 'START_VOLTAGE';
  /** `false` quando `minModules > maxModules`: nenhuma string é possível com este par. */
  feasible: boolean;
}

/**
 * ENG-F06: limites do número de módulos em série.
 * `Nmax = floor(min(Vdc_max_inv, Vsys_max_mod) / Voc_frio)` e também `floor(Vmppt_max / Vmpp_frio)`;
 * `Nmin = ceil(max(Vmppt_min, Vstart) / Vmpp_quente)`.
 */
export function stringLimits(input: StringLimitsInput): StringLimits {
  const { inverter } = input;
  if (input.vocColdV <= 0 || input.vmppHotV <= 0 || input.vmppColdV <= 0)
    throw new RangeError('Tensões do módulo devem ser positivas');
  const ceiling =
    input.moduleMaxSystemVoltageV !== undefined
      ? Math.min(inverter.maxDcVoltageV, input.moduleMaxSystemVoltageV)
      : inverter.maxDcVoltageV;
  const byVoc = Math.floor(ceiling / input.vocColdV);
  const byMppt = Math.floor(inverter.mpptMaxV / input.vmppColdV);
  const maxModules = Math.min(byVoc, byMppt);
  const maxLimitedBy =
    byMppt < byVoc
      ? 'MPPT_MAX_VOLTAGE'
      : input.moduleMaxSystemVoltageV !== undefined &&
          input.moduleMaxSystemVoltageV < inverter.maxDcVoltageV
        ? 'MODULE_SYSTEM_VOLTAGE'
        : 'INVERTER_MAX_VOLTAGE';

  const startV = inverter.startVoltageV ?? 0;
  const lowV = Math.max(inverter.mpptMinV, startV);
  const minModules = Math.max(1, Math.ceil(lowV / input.vmppHotV));
  const minLimitedBy = startV > inverter.mpptMinV ? 'START_VOLTAGE' : 'MPPT_MIN_VOLTAGE';
  return {
    maxModules,
    minModules,
    maxLimitedBy,
    minLimitedBy,
    feasible: maxModules >= minModules,
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} deve ser inteiro ≥ 1`);
}
