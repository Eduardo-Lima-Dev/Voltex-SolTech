import { OFFGRID_DESIGN_PARAMETERS, type OffgridDesignParameter } from '@voltex/shared';

/**
 * Parâmetros da regra `offgrid.design`. **Não há valor oficial no código**: sem regra ativa o motor calcula com os
 * valores provisórios abaixo (exemplos do Manual CRESESB 2014 e de prática comum, para o projetista ver o resultado),
 * mas marca cada um como pendente e a aprovação fica travada até a regra existir e ser revisada pelo responsável técnico.
 */
export const OFFGRID_PROVISIONAL_PARAMETERS: Record<OffgridDesignParameter, number> = {
  red1Default: 0.75,
  red2Default: 0.9,
  batteryEfficiencyDefault: 0.86,
  inverterEfficiencyMin: 0.85,
  autonomyMinDays: 2,
  dodMaxLeadFlooded: 50,
  dodMaxLeadVrla: 50,
  dodMaxStationary: 80,
  dodMaxLithium: 80,
  controllerCurrentFactor: 1.25,
  vocColdFactor: 1,
  inverterSurgeMargin: 0.25,
  maxBatteriesParallel: 4,
  maxChargeCRate: 0.2,
  lolpMaxPct: 5,
  chargeVoltageFactor: 1.2,
  pvOtherLossFactor: 0.95,
};

export type OffgridParams = Record<OffgridDesignParameter, number>;

export interface ResolvedParameters {
  params: OffgridParams;
  /** Parâmetros que a regra não trouxe e foram preenchidos com o valor provisório. */
  missing: OffgridDesignParameter[];
}

export function resolveParameters(
  given: Record<string, number | undefined> | undefined,
): ResolvedParameters {
  const params = { ...OFFGRID_PROVISIONAL_PARAMETERS };
  const missing: OffgridDesignParameter[] = [];
  for (const key of Object.keys(OFFGRID_DESIGN_PARAMETERS) as OffgridDesignParameter[]) {
    const value = given?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) params[key] = value;
    else missing.push(key);
  }
  return { params, missing };
}
