import { voltageAtTemperatureV } from '../engine/thermal.js';
import { STC_CELL_TEMPERATURE_C } from '../engine/thermal.js';
import type { StringElectrical } from './types.js';

/**
 * Tensão de circuito aberto esperada de uma string na temperatura do módulo medida: `Ns × Voc_mod(T)`, com
 * `Voc_mod(T) = Voc_stc × (1 + β/100 × (T − 25))` (mesma correção linear do Engine, ENG-F02). A tensão de uma
 * string em série é a soma das tensões dos módulos (EnergIF EF-M11, p. 41–42).
 */
export function expectedStringVocV(electrical: StringElectrical, moduleTempC: number): number {
  return (
    electrical.modulesInSeries *
    voltageAtTemperatureV({
      stcVoltageV: electrical.vocStcV,
      coefficientPctPerC: electrical.betaVocPctPerC,
      cellTemperatureC: moduleTempC,
    })
  );
}

/**
 * Corrente de curto-circuito esperada da string na irradiância e temperatura medidas:
 * `Isc = Isc_stc × (G / 1000) × (1 + α/100 × (T − 25))`. Modelo linear de primeira ordem (a corrente cresce com a
 * irradiância e pouco com a temperatura); a corrente de uma string em série é a de um módulo (EF-M11).
 */
export function expectedStringIscA(
  electrical: StringElectrical,
  irradianceWm2: number,
  moduleTempC: number,
): number {
  return (
    electrical.iscStcA *
    (irradianceWm2 / 1000) *
    (1 + (electrical.alphaIscPctPerC / 100) * (moduleTempC - STC_CELL_TEMPERATURE_C))
  );
}
