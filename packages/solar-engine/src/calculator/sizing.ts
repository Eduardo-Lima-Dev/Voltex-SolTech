import { DAYS_IN_YEAR, kwpToWp, wpToKwp } from '../units/index.js';

/**
 * Potência FV necessária (kWp) para gerar, em média, o consumo mensal a compensar:
 * (consumo × 12 / 365) / (HSP × PR).
 */
export const requiredPowerKwp = (
  compensableMonthlyKwh: number,
  averageHsp: number,
  performanceRatio: number,
): number => {
  if (averageHsp <= 0 || performanceRatio <= 0)
    throw new RangeError('requiredPowerKwp: HSP e PR devem ser positivos');
  const dailyKwh = (compensableMonthlyKwh * 12) / DAYS_IN_YEAR;
  return dailyKwh / (averageHsp * performanceRatio);
};

/** Número de módulos, arredondado para cima. Zero quando não há potência necessária. */
export const moduleCount = (powerKwp: number, modulePowerWp: number): number => {
  if (modulePowerWp <= 0) throw new RangeError('moduleCount: potência do módulo deve ser positiva');
  if (powerKwp <= 0) return 0;
  // Pequena tolerância para evitar que ruído de ponto flutuante adicione um módulo inteiro.
  return Math.ceil(kwpToWp(powerKwp) / modulePowerWp - 1e-9);
};

export const installedPowerKwp = (modules: number, modulePowerWp: number): number =>
  wpToKwp(modules * modulePowerWp);

export const estimatedAreaM2 = (modules: number, moduleAreaM2: number): number =>
  modules * moduleAreaM2;
