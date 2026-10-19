import { z } from 'zod';

/**
 * Margem de contribuição de uma cotação (Margin Guard). Funções puras, em centavos (inteiros).
 *
 * Modelo (documentado em docs/06-calculos/margem.md):
 *   custo direto   = materiais (BOM) + frete + instalação + deslocamento + outros
 *   contingência   = custo direto × taxa de contingência
 *   comissão       = preço × taxa de comissão
 *   impostos       = preço × alíquota efetiva informada pela empresa
 *   custo financ.  = preço × taxa de custo financeiro
 *   margem         = preço − (custo direto + contingência + comissão + impostos + custo financeiro)
 *   margem %       = margem ÷ preço
 *
 * A alíquota de impostos é uma **entrada da empresa** (regime tributário varia): o motor não presume nenhuma.
 */
export const MARGIN_ALGORITHM_VERSION = 'margin-1.0.0';

export const QUOTE_ITEM_CATEGORIES = [
  'MODULE',
  'INVERTER',
  'STRUCTURE',
  'PROTECTION',
  'CABLE',
  'OTHER_MATERIAL',
] as const;
export type QuoteItemCategory = (typeof QUOTE_ITEM_CATEGORIES)[number];

const rate = z.number().min(0).max(1);

export const quoteItemSchema = z.object({
  category: z.enum(QUOTE_ITEM_CATEGORIES),
  description: z.string().trim().min(2).max(160),
  quantity: z.number().positive().max(1_000_000),
  /** Custo unitário em centavos. */
  unitCostCents: z.number().int().min(0),
});
export type QuoteItem = z.infer<typeof quoteItemSchema>;

/*
 * Atenção: a base NÃO tem valores padrão. Um `.partial()` sobre campos com `.default()` reaplica o padrão e zeraria os
 * custos já informados numa atualização parcial; por isso a atualização parte de `quoteCostsBase`.
 */
export const quoteCostsBase = z.object({
  freightCents: z.number().int().min(0),
  installationCents: z.number().int().min(0),
  travelCents: z.number().int().min(0),
  otherCostsCents: z.number().int().min(0),
  /** Fração do preço (0,05 = 5%). */
  commissionRate: rate,
  taxRate: rate,
  financingRate: rate,
  /** Fração do custo direto (0,03 = 3%). */
  contingencyRate: rate,
});
export const quoteCostsSchema = z.object({
  freightCents: quoteCostsBase.shape.freightCents.default(0),
  installationCents: quoteCostsBase.shape.installationCents.default(0),
  travelCents: quoteCostsBase.shape.travelCents.default(0),
  otherCostsCents: quoteCostsBase.shape.otherCostsCents.default(0),
  commissionRate: rate.default(0),
  taxRate: rate.default(0),
  financingRate: rate.default(0),
  contingencyRate: rate.default(0),
});
export type QuoteCosts = z.output<typeof quoteCostsSchema>;
export type QuoteCostsInput = z.input<typeof quoteCostsSchema>;

export interface MarginInput {
  priceCents: number;
  items: readonly QuoteItem[];
  costs: QuoteCosts;
}

export interface MarginBreakdown {
  algorithmVersion: string;
  priceCents: number;
  materialsCents: number;
  directCostsCents: number;
  contingencyCents: number;
  commissionCents: number;
  taxesCents: number;
  financingCents: number;
  totalCostsCents: number;
  contributionMarginCents: number;
  /** Fração do preço (0,25 = 25%). 0 quando o preço é zero. */
  marginRate: number;
  /** Quanto o preço está acima do custo total (fração). `null` sem custo. */
  markupRate: number | null;
}

const round = (value: number) => Math.round(value);

export function calculateMargin({ priceCents, items, costs }: MarginInput): MarginBreakdown {
  const materialsCents = items.reduce(
    (sum, item) => sum + round(item.quantity * item.unitCostCents),
    0,
  );
  const directCostsCents =
    materialsCents +
    costs.freightCents +
    costs.installationCents +
    costs.travelCents +
    costs.otherCostsCents;
  const contingencyCents = round(directCostsCents * costs.contingencyRate);
  const commissionCents = round(priceCents * costs.commissionRate);
  const taxesCents = round(priceCents * costs.taxRate);
  const financingCents = round(priceCents * costs.financingRate);
  const totalCostsCents =
    directCostsCents + contingencyCents + commissionCents + taxesCents + financingCents;
  const contributionMarginCents = priceCents - totalCostsCents;
  return {
    algorithmVersion: MARGIN_ALGORITHM_VERSION,
    priceCents,
    materialsCents,
    directCostsCents,
    contingencyCents,
    commissionCents,
    taxesCents,
    financingCents,
    totalCostsCents,
    contributionMarginCents,
    marginRate: priceCents > 0 ? contributionMarginCents / priceCents : 0,
    markupRate: totalCostsCents > 0 ? priceCents / totalCostsCents - 1 : null,
  };
}

/**
 * Menor preço (em centavos, arredondado para cima) que atinge a margem mínima. `null` quando é impossível:
 * as taxas sobre o preço (comissão + impostos + custo financeiro + margem) somam 100% ou mais.
 */
export function minimumPriceForMargin(
  items: readonly QuoteItem[],
  costs: QuoteCosts,
  minMarginRate: number,
): number | null {
  const direct =
    items.reduce((sum, item) => sum + round(item.quantity * item.unitCostCents), 0) +
    costs.freightCents +
    costs.installationCents +
    costs.travelCents +
    costs.otherCostsCents;
  const fixed = direct * (1 + costs.contingencyRate);
  const denominator =
    1 - costs.commissionRate - costs.taxRate - costs.financingRate - minMarginRate;
  if (denominator <= 1e-9) return null;
  let price = Math.ceil(fixed / denominator);
  // O arredondamento de cada parcela pode deixar a margem um centavo abaixo: sobe até atingir.
  while (
    calculateMargin({ priceCents: price, items, costs }).marginRate < minMarginRate - 1e-12 &&
    price < fixed * 1000 + 1
  )
    price += 1;
  return price;
}

export type MarginStatus = 'WITHIN_POLICY' | 'BELOW_POLICY' | 'NO_POLICY';

/** Compara a margem com o mínimo da política (fração). Sem política, o resultado é `NO_POLICY` (bloqueia a proposta). */
export const marginStatus = (marginRate: number, minMarginRate: number | null): MarginStatus =>
  minMarginRate === null
    ? 'NO_POLICY'
    : marginRate + 1e-12 >= minMarginRate
      ? 'WITHIN_POLICY'
      : 'BELOW_POLICY';
