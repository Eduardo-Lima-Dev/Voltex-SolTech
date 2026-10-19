import {
  QUOTE_ITEM_CATEGORIES,
  calculateMargin,
  type MarginBreakdown,
  type QuoteCosts,
  type QuoteItem,
  type QuoteItemCategory,
  type SaveQuoteInput,
} from '@voltex/solar-engine';
import type { QuoteDto } from '@voltex/shared';

/** Estado do formulário de cotação: tudo texto, como o usuário digita (R$ e %). */
export interface QuoteItemRow {
  category: QuoteItemCategory;
  description: string;
  quantity: string;
  unitCost: string;
}

export interface QuoteFormState {
  title: string;
  items: QuoteItemRow[];
  freight: string;
  installation: string;
  travel: string;
  other: string;
  commission: string;
  tax: string;
  financing: string;
  contingency: string;
  price: string;
}

export const emptyItem = (category: QuoteItemCategory = 'MODULE'): QuoteItemRow => ({
  category,
  description: '',
  quantity: '1',
  unitCost: '',
});

export const emptyQuoteForm = (): QuoteFormState => ({
  title: '',
  items: [emptyItem('MODULE'), emptyItem('INVERTER'), emptyItem('STRUCTURE')],
  freight: '',
  installation: '',
  travel: '',
  other: '',
  commission: '',
  tax: '',
  financing: '',
  contingency: '',
  price: '',
});

/** "1.234,56" · "1234,56" · "R$ 12,5" · "1234.5" → centavos. Vazio vale zero; texto inválido, `null`. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/R\$|\s/g, '');
  if (clean === '') return 0;
  let normalized: string;
  if (clean.includes(',')) normalized = clean.replace(/\./g, '').replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(clean)) normalized = clean;
  else normalized = clean.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** "5" · "5,5" · "5%" → 0,05 · 0,055. Vazio vale zero; fora de 0–100% ou inválido, `null`. */
export function parseRate(text: string): number | null {
  const clean = text.replace(/%|\s/g, '').replace(',', '.');
  if (clean === '') return 0;
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const value = Number(clean);
  return value > 100 ? null : Math.round(value * 100) / 10_000;
}

const parseQuantity = (text: string): number | null => {
  const clean = text.replace(',', '.').trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const value = Number(clean);
  return value > 0 ? value : null;
};

const money = (cents: number) =>
  cents === 0
    ? ''
    : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = (fraction: number) =>
  fraction === 0 ? '' : String(Math.round(fraction * 10_000) / 100).replace('.', ',');

export function quoteToForm(quote: QuoteDto): QuoteFormState {
  return {
    title: quote.title ?? '',
    items: quote.items.map((i) => ({
      category: i.category as QuoteItemCategory,
      description: i.description,
      quantity: String(i.quantity).replace('.', ','),
      unitCost: money(i.unitCostCents),
    })),
    freight: money(quote.costs.freightCents),
    installation: money(quote.costs.installationCents),
    travel: money(quote.costs.travelCents),
    other: money(quote.costs.otherCostsCents),
    commission: rate(quote.costs.commissionRate),
    tax: rate(quote.costs.taxRate),
    financing: rate(quote.costs.financingRate),
    contingency: rate(quote.costs.contingencyRate),
    price: money(quote.priceCents),
  };
}

export interface QuoteFormErrors {
  items?: string;
  itemRows: Record<number, string>;
  fields: Partial<Record<keyof QuoteFormState, string>>;
}

export type QuoteParseResult =
  | { ok: true; value: SaveQuoteInput & { items: QuoteItem[] }; costs: QuoteCosts }
  | { ok: false; errors: QuoteFormErrors };

export function parseQuoteForm(form: QuoteFormState): QuoteParseResult {
  const errors: QuoteFormErrors = { itemRows: {}, fields: {} };

  const items: QuoteItem[] = [];
  const filled = form.items.filter((row) => row.description.trim() || row.unitCost.trim());
  if (filled.length === 0) errors.items = 'Informe ao menos um item da lista de materiais';
  filled.forEach((row, index) => {
    const quantity = parseQuantity(row.quantity);
    const unitCostCents = parseMoney(row.unitCost);
    if (row.description.trim().length < 2) errors.itemRows[index] = 'Descreva o item';
    else if (quantity === null) errors.itemRows[index] = 'Quantidade inválida';
    else if (unitCostCents === null) errors.itemRows[index] = 'Custo unitário inválido';
    else
      items.push({
        category: row.category,
        description: row.description.trim(),
        quantity,
        unitCostCents,
      });
  });

  const cents = (key: 'freight' | 'installation' | 'travel' | 'other' | 'price') => {
    const value = parseMoney(form[key]);
    if (value === null) errors.fields[key] = 'Valor inválido';
    return value ?? 0;
  };
  const fraction = (key: 'commission' | 'tax' | 'financing' | 'contingency') => {
    const value = parseRate(form[key]);
    if (value === null) errors.fields[key] = 'Use um percentual de 0 a 100';
    return value ?? 0;
  };
  const costs: QuoteCosts = {
    freightCents: cents('freight'),
    installationCents: cents('installation'),
    travelCents: cents('travel'),
    otherCostsCents: cents('other'),
    commissionRate: fraction('commission'),
    taxRate: fraction('tax'),
    financingRate: fraction('financing'),
    contingencyRate: fraction('contingency'),
  };
  const priceCents = cents('price');
  if (!errors.fields.price && priceCents <= 0) errors.fields.price = 'Informe o preço de venda';

  if (
    errors.items ||
    Object.keys(errors.itemRows).length > 0 ||
    Object.keys(errors.fields).length > 0
  )
    return { ok: false, errors };
  return {
    ok: true,
    costs,
    value: { title: form.title.trim() || undefined, items, costs, priceCents },
  };
}

/** Margem para mostrar enquanto digita (o servidor recalcula ao salvar). */
export function previewMargin(form: QuoteFormState): MarginBreakdown | null {
  const parsed = parseQuoteForm(form);
  return parsed.ok
    ? calculateMargin({
        priceCents: parsed.value.priceCents,
        items: parsed.value.items,
        costs: parsed.costs,
      })
    : null;
}

export { QUOTE_ITEM_CATEGORIES };
