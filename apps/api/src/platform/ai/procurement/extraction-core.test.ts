import { describe, expect, it } from 'vitest';
import {
  chunkText,
  confirmsInSource,
  normalizeDate,
  numbersIn,
  parseRowsJson,
  toPriceCsv,
  validateRows,
} from './extraction-core';

const SOURCE = [
  'Distribuidora Sol Ltda - Tabela de preços',
  'Módulo Fab X MOD-550  código 1234  R$ 612,50  validade 31/12/2099',
  'Inversor Fab Y INV-5K  código 99  R$ 5.490,00',
].join('\n');

describe('procurement · núcleo', () => {
  it('lê números em pt-BR e en', () => {
    expect(numbersIn('R$ 5.490,00')).toEqual([5490]);
    expect(numbersIn('612,50')).toEqual([612.5]);
    expect(numbersIn('1,234.50 e 1234.5')).toEqual([1234.5, 1234.5]);
    expect(numbersIn('1.234')).toEqual([1234]);
  });

  it('só confirma a linha se o trecho está no documento e traz o preço', () => {
    const row = (excerpt: string, priceReais: number) => ({
      manufacturer: 'Fab X',
      model: 'MOD-550',
      description: '',
      supplier: '',
      sku: '',
      priceReais,
      validFrom: '',
      validTo: '',
      excerpt,
    });
    const real = 'Módulo Fab X MOD-550  código 1234  R$ 612,50';
    expect(confirmsInSource(row(real, 612.5), SOURCE)).toBe(true);
    expect(confirmsInSource(row(real, 700), SOURCE)).toBe(false);
    expect(confirmsInSource(row('Módulo inventado R$ 10,00', 10), SOURCE)).toBe(false);
    expect(confirmsInSource(row('', 612.5), SOURCE)).toBe(false);
  });

  it('descarta o que o modelo inventou, tolera cerca de código e remove repetidas', () => {
    const good = {
      manufacturer: 'Fab Y',
      model: 'INV-5K',
      priceReais: 5490,
      validFrom: '2026-10-01',
      excerpt: 'Inversor Fab Y INV-5K  código 99  R$ 5.490,00',
    };
    const raw = parseRowsJson(
      '```json\n' +
        JSON.stringify({
          rows: [
            good,
            good,
            { ...good, model: 'X', priceReais: 1, excerpt: 'não existe R$ 1,00' },
            { lixo: true },
          ],
        }) +
        '\n```',
    );
    const out = validateRows(raw, SOURCE);
    expect(out.rows).toHaveLength(1);
    expect(out.discarded).toBe(2);
    expect(out.rows[0]!.validFrom).toBe('01/10/2026');
    expect(parseRowsJson('sem json')).toEqual([]);
  });

  it('quebra por linha, respeita o limite de pedaços e avisa quando cortou', () => {
    const text = Array.from({ length: 10 }, (_, i) => `linha ${i} ${'x'.repeat(40)}`).join('\n');
    const { chunks, truncated } = chunkText(text, 120, 2);
    expect(chunks).toHaveLength(2);
    expect(truncated).toBe(true);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunkText('a\nb', 100, 2)).toEqual({ chunks: ['a\nb'], truncated: false });
  });

  it('gera o CSV no modelo da importação e normaliza datas', () => {
    expect(normalizeDate('2026-10-01')).toBe('01/10/2026');
    expect(normalizeDate('32/13/2026')).toBe('');
    const csv = toPriceCsv([
      {
        manufacturer: 'Fab "X"',
        model: 'M;1',
        description: '',
        supplier: 'Dist',
        sku: '',
        priceReais: 612.5,
        validFrom: '01/10/2026',
        validTo: '',
      },
    ]);
    expect(csv.split('\n')[0]).toBe(
      'fabricante;modelo;descricao;fornecedor;sku;preco_reais;vigencia_inicio;vigencia_fim',
    );
    expect(csv.split('\n')[1]).toBe('"Fab ""X""";"M 1";"";"Dist";"";612,50;01/10/2026;');
  });
});
