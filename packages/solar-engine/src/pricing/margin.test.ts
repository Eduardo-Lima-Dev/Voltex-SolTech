import { describe, expect, it } from 'vitest';
import { updateQuoteSchema } from './request.js';
import {
  MARGIN_ALGORITHM_VERSION,
  calculateMargin,
  marginStatus,
  minimumPriceForMargin,
  quoteCostsSchema,
  quoteItemSchema,
  type QuoteItem,
} from './margin.js';

const costs = (o: Record<string, number> = {}) => quoteCostsSchema.parse(o);
const items: QuoteItem[] = [
  { category: 'MODULE', description: 'Módulo 550 Wp', quantity: 8, unitCostCents: 60_000 },
  { category: 'INVERTER', description: 'Inversor 5 kW', quantity: 1, unitCostCents: 250_000 },
  { category: 'STRUCTURE', description: 'Estrutura cerâmica', quantity: 1, unitCostCents: 120_000 },
];
// materiais = 8×60.000 + 250.000 + 120.000 = 850.000

describe('calculateMargin', () => {
  it('caso de referência com todas as parcelas', () => {
    const result = calculateMargin({
      priceCents: 1_980_000,
      items,
      costs: costs({
        freightCents: 40_000,
        installationCents: 200_000,
        travelCents: 20_000,
        otherCostsCents: 10_000,
        commissionRate: 0.05,
        taxRate: 0.06,
        financingRate: 0.02,
        contingencyRate: 0.03,
      }),
    });
    expect(result).toMatchObject({
      algorithmVersion: MARGIN_ALGORITHM_VERSION,
      materialsCents: 850_000,
      directCostsCents: 1_120_000, // 850.000 + 40.000 + 200.000 + 20.000 + 10.000
      contingencyCents: 33_600, // 3% de 1.120.000
      commissionCents: 99_000, // 5% de 1.980.000
      taxesCents: 118_800, // 6%
      financingCents: 39_600, // 2%
      totalCostsCents: 1_411_000,
      contributionMarginCents: 569_000,
    });
    expect(result.marginRate).toBeCloseTo(569_000 / 1_980_000, 10);
    expect(result.markupRate).toBeCloseTo(1_980_000 / 1_411_000 - 1, 10);
  });

  it('sem taxas, a margem é preço menos materiais e custos fixos', () => {
    const result = calculateMargin({ priceCents: 1_000_000, items, costs: costs() });
    expect(result.contributionMarginCents).toBe(150_000);
    expect(result.marginRate).toBeCloseTo(0.15, 10);
  });

  it('margem negativa quando o preço não cobre o custo', () => {
    const result = calculateMargin({ priceCents: 800_000, items, costs: costs() });
    expect(result.contributionMarginCents).toBe(-50_000);
    expect(result.marginRate).toBeLessThan(0);
  });

  it('preço zero não divide por zero; sem custo não há markup', () => {
    expect(calculateMargin({ priceCents: 0, items, costs: costs() }).marginRate).toBe(0);
    const free = calculateMargin({ priceCents: 100_000, items: [], costs: costs() });
    expect(free.markupRate).toBeNull();
    expect(free.marginRate).toBe(1);
  });

  it('quantidades fracionadas arredondam por item', () => {
    const result = calculateMargin({
      priceCents: 100_000,
      items: [{ category: 'CABLE', description: 'Cabo solar', quantity: 12.5, unitCostCents: 333 }],
      costs: costs(),
    });
    expect(result.materialsCents).toBe(4_163); // 12,5 × 333 = 4.162,5 → 4.163
  });
});

describe('minimumPriceForMargin', () => {
  const c = costs({
    commissionRate: 0.05,
    taxRate: 0.06,
    financingRate: 0.02,
    contingencyRate: 0.03,
    installationCents: 200_000,
  });

  it('o preço mínimo atinge a margem pedida, e um centavo a menos não atinge', () => {
    const min = minimumPriceForMargin(items, c, 0.2) as number;
    expect(calculateMargin({ priceCents: min, items, costs: c }).marginRate).toBeGreaterThanOrEqual(
      0.2 - 1e-12,
    );
    expect(calculateMargin({ priceCents: min - 1, items, costs: c }).marginRate).toBeLessThan(0.2);
  });

  it('com margem zero cobre exatamente o custo', () => {
    const min = minimumPriceForMargin(items, costs(), 0) as number;
    expect(min).toBe(850_000);
  });

  it('é impossível quando as taxas sobre o preço somam 100% ou mais', () => {
    expect(
      minimumPriceForMargin(
        items,
        costs({ commissionRate: 0.5, taxRate: 0.3, financingRate: 0.1 }),
        0.1,
      ),
    ).toBeNull();
    expect(minimumPriceForMargin(items, costs(), 1)).toBeNull();
  });
});

describe('marginStatus', () => {
  it('compara com o mínimo da política; sem política bloqueia', () => {
    expect(marginStatus(0.25, 0.2)).toBe('WITHIN_POLICY');
    expect(marginStatus(0.2, 0.2)).toBe('WITHIN_POLICY');
    expect(marginStatus(0.1999, 0.2)).toBe('BELOW_POLICY');
    expect(marginStatus(0.5, null)).toBe('NO_POLICY');
    expect(marginStatus(-0.1, 0)).toBe('BELOW_POLICY');
  });
});

describe('schemas', () => {
  it('item exige descrição, quantidade positiva e custo inteiro', () => {
    expect(quoteItemSchema.safeParse(items[0]).success).toBe(true);
    expect(quoteItemSchema.safeParse({ ...items[0], quantity: 0 }).success).toBe(false);
    expect(quoteItemSchema.safeParse({ ...items[0], unitCostCents: 10.5 }).success).toBe(false);
    expect(quoteItemSchema.safeParse({ ...items[0], category: 'OUTRA' }).success).toBe(false);
    expect(quoteItemSchema.safeParse({ ...items[0], description: 'x' }).success).toBe(false);
  });

  it('custos têm padrão zero e taxas entre 0 e 1', () => {
    expect(quoteCostsSchema.parse({})).toMatchObject({
      freightCents: 0,
      commissionRate: 0,
      contingencyRate: 0,
    });
    expect(quoteCostsSchema.safeParse({ taxRate: 1.5 }).success).toBe(false);
    expect(quoteCostsSchema.safeParse({ freightCents: -1 }).success).toBe(false);
  });
});

describe('atualização parcial dos custos', () => {
  it('não reaplica padrões: só os campos enviados aparecem', () => {
    expect(updateQuoteSchema.parse({ costs: { freightCents: 50_000 } }).costs).toEqual({
      freightCents: 50_000,
    });
    expect(updateQuoteSchema.parse({}).costs).toBeUndefined();
  });
});
