import { GenerationClass } from '@voltex/shared';

export interface ClassificationLimits {
  /** Limite superior da microgeração, em kW. */
  microgenerationMaxKw: number;
  /** Limite superior da minigeração, em kW. */
  minigenerationMaxKw: number;
}

/**
 * Classe da geração por potência instalada (EnergIF EF-M06, p. 67: micro ≤ 75 kW; mini > 75 kW e ≤ 5 MW; usina > 5 MW).
 * Limites vêm do Rules Engine (a regulação pode mudar). Usamos a potência CC dos módulos (kWp) como aproximação:
 * a regulação trata da potência instalada de geração, que pode ser limitada pelo inversor (a confirmar).
 */
export const classifyGeneration = (
  installedPowerKwp: number,
  limits: ClassificationLimits,
): GenerationClass => {
  if (installedPowerKwp <= limits.microgenerationMaxKw) return GenerationClass.MICRO;
  if (installedPowerKwp <= limits.minigenerationMaxKw) return GenerationClass.MINI;
  return GenerationClass.UTILITY;
};
