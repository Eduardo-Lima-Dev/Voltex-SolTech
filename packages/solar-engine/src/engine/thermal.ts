import type { Celsius, Volt } from '../units/index.js';

/**
 * Correção térmica de módulos (ENG-F01..F03). Fórmulas físicas lineares; coeficientes vêm da ficha do módulo
 * (EnergIF EF-M07) e as temperaturas de projeto do local. Memorial: `docs/06-calculos/engine-compatibilidade.md`.
 */
export const THERMAL_ALGORITHM_VERSION = 'thermal-1.0.0';

/** Temperatura de referência das condições de teste padrão (STC). */
export const STC_CELL_TEMPERATURE_C: Celsius = 25;
/** Irradiância de referência do NOCT (W/m²) e temperatura ambiente do ensaio NOCT. */
export const NOCT_IRRADIANCE_W_M2 = 800;
export const NOCT_AMBIENT_C: Celsius = 20;

/** ENG-F01: `Tcel = Tamb + (NOCT − 20) / 800 × G`. */
export function cellTemperatureC(input: {
  ambientC: Celsius;
  noctC: Celsius;
  irradianceWm2: number;
}): Celsius {
  if (input.irradianceWm2 < 0) throw new RangeError('Irradiância não pode ser negativa');
  return (
    input.ambientC + ((input.noctC - NOCT_AMBIENT_C) / NOCT_IRRADIANCE_W_M2) * input.irradianceWm2
  );
}

/**
 * Tensão de um módulo (Voc ou Vmpp) em outra temperatura de célula: `V(T) = V_stc × (1 + β/100 × (T − 25))`,
 * com β em %/°C (negativo para silício).
 */
export function voltageAtTemperatureV(input: {
  stcVoltageV: Volt;
  coefficientPctPerC: number;
  cellTemperatureC: Celsius;
}): Volt {
  return (
    input.stcVoltageV *
    (1 + (input.coefficientPctPerC / 100) * (input.cellTemperatureC - STC_CELL_TEMPERATURE_C))
  );
}

/**
 * ENG-F02: Voc no frio. Usa a **temperatura mínima do local** como temperatura de célula (célula não está
 * mais fria que o ar e, ao amanhecer, ainda sem irradiância).
 */
export const vocColdV = (input: {
  vocStcV: Volt;
  betaVocPctPerC: number;
  minAmbientC: Celsius;
}): Volt =>
  voltageAtTemperatureV({
    stcVoltageV: input.vocStcV,
    coefficientPctPerC: input.betaVocPctPerC,
    cellTemperatureC: input.minAmbientC,
  });

/**
 * ENG-F03: Vmpp no frio e no quente. Sem coeficiente próprio de Vmpp, usa β de Voc (premissa registrada em
 * `coefficientSource`, para o memorial e o snapshot).
 */
export function vmppRangeV(input: {
  vmppStcV: Volt;
  betaVmppPctPerC?: number | undefined;
  betaVocPctPerC: number;
  minAmbientC: Celsius;
  maxCellC: Celsius;
}): { coldV: Volt; hotV: Volt; coefficientSource: 'BETA_VMPP' | 'BETA_VOC_ASSUMED' } {
  const beta = input.betaVmppPctPerC ?? input.betaVocPctPerC;
  return {
    coldV: voltageAtTemperatureV({
      stcVoltageV: input.vmppStcV,
      coefficientPctPerC: beta,
      cellTemperatureC: input.minAmbientC,
    }),
    hotV: voltageAtTemperatureV({
      stcVoltageV: input.vmppStcV,
      coefficientPctPerC: beta,
      cellTemperatureC: input.maxCellC,
    }),
    coefficientSource: input.betaVmppPctPerC === undefined ? 'BETA_VOC_ASSUMED' : 'BETA_VMPP',
  };
}

/** Corrente de curto-circuito do módulo na temperatura de célula: `Isc(T) = Isc_stc × (1 + α/100 × (T − 25))`. */
export const iscAtTemperatureA = (input: {
  iscStcA: number;
  alphaIscPctPerC: number;
  cellTemperatureC: Celsius;
}): number =>
  input.iscStcA *
  (1 + (input.alphaIscPctPerC / 100) * (input.cellTemperatureC - STC_CELL_TEMPERATURE_C));
