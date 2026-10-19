import { describe, expect, it } from 'vitest';
import { emptyQuoteForm, parseMoney, parseQuoteForm, parseRate, previewMargin } from './quote-form';

describe('parseMoney', () => {
  it.each([
    ['1.234,56', 123_456],
    ['1234,56', 123_456],
    ['R$ 12,5', 1_250],
    ['1234.5', 123_450],
    ['1.234', 123_400],
    ['600', 60_000],
    ['', 0],
  ])('%s → %i centavos', (text, cents) => {
    expect(parseMoney(text)).toBe(cents);
  });
  it.each(['abc', '12,34,56', '-5'])('recusa %s', (text) => {
    expect(parseMoney(text)).toBeNull();
  });
});

describe('parseRate', () => {
  it.each([
    ['5', 0.05],
    ['5,5', 0.055],
    ['5%', 0.05],
    ['100', 1],
    ['', 0],
  ])('%s → %f', (text, fraction) => {
    expect(parseRate(text)).toBeCloseTo(fraction, 6);
  });
  it.each(['101', 'x', '-1'])('recusa %s', (text) => {
    expect(parseRate(text)).toBeNull();
  });
});

describe('parseQuoteForm', () => {
  const filled = () => ({
    ...emptyQuoteForm(),
    items: [
      {
        category: 'MODULE' as const,
        description: 'Módulo 550 Wp',
        quantity: '8',
        unitCost: '600,00',
      },
      { category: 'INVERTER' as const, description: '', quantity: '1', unitCost: '' },
    ],
    freight: '400,00',
    installation: '2.000,00',
    commission: '5',
    tax: '6',
    price: '19.800,00',
  });

  it('converte para centavos e frações; linhas em branco são ignoradas', () => {
    const parsed = parseQuoteForm(filled());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.items).toEqual([
      { category: 'MODULE', description: 'Módulo 550 Wp', quantity: 8, unitCostCents: 60_000 },
    ]);
    expect(parsed.value.priceCents).toBe(1_980_000);
    expect(parsed.costs).toMatchObject({
      freightCents: 40_000,
      installationCents: 200_000,
      commissionRate: 0.05,
      taxRate: 0.06,
    });
  });

  it('aponta o que falta: itens, linha incompleta, preço e taxas', () => {
    const empty = parseQuoteForm(emptyQuoteForm());
    expect(empty).toMatchObject({
      ok: false,
      errors: { items: expect.stringMatching(/ao menos um item/) },
    });

    const bad = parseQuoteForm({
      ...filled(),
      items: [{ category: 'MODULE', description: 'Módulo', quantity: '0', unitCost: '10' }],
      tax: '150',
      price: '',
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.itemRows[0]).toMatch(/Quantidade/);
    expect(bad.errors.fields.tax).toMatch(/0 a 100/);
    expect(bad.errors.fields.price).toMatch(/preço/);
  });

  it('a prévia usa o mesmo motor do servidor (margem de contribuição)', () => {
    const margin = previewMargin({
      ...filled(),
      items: [{ category: 'MODULE', description: 'Kit', quantity: '1', unitCost: '10.000,00' }],
      freight: '',
      installation: '',
      commission: '',
      tax: '',
      price: '20.000,00',
    });
    expect(margin?.marginRate).toBeCloseTo(0.5, 6);
    expect(previewMargin(emptyQuoteForm())).toBeNull();
  });
});
