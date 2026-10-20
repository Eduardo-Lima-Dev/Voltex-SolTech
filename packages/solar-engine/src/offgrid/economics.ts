import type { OffgridDesign, OffgridEconomicsResult } from '@voltex/shared';
import { roundTo } from '../units/index.js';

/**
 * OFF-F09: custo do sistema isolado/híbrido. CAPEX = equipamentos do catálogo (preço vigente) + instalação e outros
 * custos informados. OPEX anual = manutenção (% do CAPEX de equipamentos) + combustível + energia da rede. A troca do
 * banco entra no fluxo a cada `vida` anos. Custo nivelado = VP dos custos ÷ VP da energia entregue.
 * Memorial: `docs/06-calculos/offgrid-economia.md`.
 */
export const OFFGRID_ECONOMICS_VERSION = 'offgrid-economics-1.0.0';

export interface OffgridLine {
  id: string | null;
  description: string;
  quantity: number;
  /** Categoria: `BATTERY` entra na troca periódica. */
  category: 'MODULE' | 'BATTERY' | 'CONTROLLER' | 'INVERTER' | 'GENERATOR';
}

export interface OffgridPrice {
  unitCostCents: number;
}

export function evaluateOffgridEconomics(input: {
  lines: OffgridLine[];
  prices: Record<string, OffgridPrice | undefined>;
  economics: OffgridDesign['economics'];
  servedKwhPerYear: number;
  fuelLitersPerYear: number;
  fuelPriceCentsPerLiter: number;
  gridKwhPerYear: number;
  gridTariffCentsPerKwh: number;
  batteryLifeYears: number | null;
}): OffgridEconomicsResult {
  const items: OffgridEconomicsResult['capexItems'] = [];
  const missing: string[] = [];
  let equipmentCents = 0;
  let batteryCents = 0;
  for (const line of input.lines) {
    const price = line.id ? input.prices[line.id] : undefined;
    if (!price) {
      missing.push(line.description);
      items.push({
        description: line.description,
        quantity: line.quantity,
        unitCostCents: null,
        totalCents: null,
      });
      continue;
    }
    const total = price.unitCostCents * line.quantity;
    equipmentCents += total;
    if (line.category === 'BATTERY') batteryCents += total;
    items.push({
      description: line.description,
      quantity: line.quantity,
      unitCostCents: price.unitCostCents,
      totalCents: total,
    });
  }
  const eco = input.economics;
  const capex = equipmentCents + eco.installationCostCents + eco.otherCostCents;
  const annualOpex = Math.round((equipmentCents * eco.maintenancePctPerYear) / 100);
  const annualFuel = Math.round(input.fuelLitersPerYear * input.fuelPriceCentsPerLiter);
  const annualGrid = Math.round(input.gridKwhPerYear * input.gridTariffCentsPerKwh);
  const rate = eco.discountRatePct / 100;
  const life = input.batteryLifeYears;
  let npvCost = capex;
  let npvEnergy = 0;
  for (let year = 1; year <= eco.horizonYears; year++) {
    const df = (1 + rate) ** -year;
    let cost = annualOpex + annualFuel + annualGrid;
    // Troca do banco no fim da vida (se a vida cair dentro do horizonte e antes do último ano).
    if (
      life &&
      life > 0 &&
      year < eco.horizonYears &&
      Math.floor(year / life) > Math.floor((year - 1) / life)
    )
      cost += batteryCents;
    npvCost += cost * df;
    npvEnergy += input.servedKwhPerYear * df;
  }
  const annualCost = annualOpex + annualFuel + annualGrid;
  const savings =
    eco.avoidedCostCentsPerKwh > 0
      ? Math.round(input.servedKwhPerYear * eco.avoidedCostCentsPerKwh - annualCost)
      : null;
  return {
    capexCents: Math.round(capex),
    capexItems: items,
    missingPrices: missing,
    annualOpexCents: annualOpex,
    annualFuelCents: annualFuel,
    annualGridCents: annualGrid,
    batteryReplacementYears: life,
    npvCostCents: Math.round(npvCost),
    lcoeCentsPerKwh: npvEnergy > 0 ? roundTo(npvCost / npvEnergy, 2) : null,
    annualSavingsCents: savings,
    paybackYears: savings && savings > 0 ? roundTo(capex / savings, 1) : null,
  };
}
