import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { PdfTextBillParser } from './pdf-text-bill-parser';
import { LOW_CONFIDENCE_THRESHOLD, extractBillFields, overallConfidence } from './bill-parser';

/** Texto SINTÉTICO no estilo de uma fatura brasileira. Não é de nenhuma distribuidora real. */
const SAMPLE = `
ENERGIA ELÉTRICA DO NORTE S.A.
Nome: JOAO DA SILVA
Unidade Consumidora: 12345678-9
Grupo B   Classe: RESIDENCIAL   Fornecimento: BIFÁSICO
Mês de referência: 08/2026
Vencimento: 15/09/2026
Total a pagar R$ 1.234,56

HISTÓRICO DE CONSUMO
SET/25 410
OUT/25 395
NOV/25 380
DEZ/25 520
JAN/26 610
FEV/26 590
MAR/26 480
ABR/26 450
MAI/26 430
JUN/26 400
JUL/26 405
AGO/26 1.020
`;

describe('extractBillFields', () => {
  const fields = extractBillFields(SAMPLE, ['Energia Elétrica do Norte', 'Outra Distribuidora']);

  it('lê UC, referência, vencimento, total, ligação e grupo', () => {
    expect(fields.ucNumber?.value).toBe('12345678-9');
    expect(fields.referenceMonth?.value).toBe('2026-08');
    expect(fields.dueDate?.value).toBe('2026-09-15');
    expect(fields.totalAmountCents?.value).toBe(123_456);
    expect(fields.phaseSystem?.value).toBe('TWO_PHASE');
    expect(fields.customerGroup?.value).toBe('B');
    expect(fields.customerName?.value).toBe('JOAO DA SILVA');
  });

  it('lê o histórico de 12 meses em ordem, com milhar em ponto', () => {
    const history = fields.consumptionHistory?.value ?? [];
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ month: '2025-09', kwh: 410 });
    expect(history.at(-1)).toEqual({ month: '2026-08', kwh: 1020 });
    expect(fields.consumptionHistory?.confidence).toBe(0.8);
  });

  it('reconhece só a distribuidora cadastrada pelo tenant', () => {
    expect(fields.distributorName?.value).toBe('Energia Elétrica do Norte');
    expect(
      extractBillFields(SAMPLE, ['Distribuidora Inexistente']).distributorName,
    ).toBeUndefined();
    expect(extractBillFields(SAMPLE, []).distributorName).toBeUndefined();
  });

  it('cada campo traz uma confiança; nome do cliente é o menos confiável (destacado na revisão)', () => {
    for (const field of Object.values(fields))
      expect((field as { confidence: number }).confidence).toBeGreaterThan(0);
    expect(fields.customerName!.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(fields.ucNumber!.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD);
    const overall = overallConfidence(fields);
    expect(overall).toBeGreaterThan(0.6);
    expect(overall).toBeLessThan(0.95);
  });

  it('aceita meses numéricos (08/2026 480) e UC rotulada como instalação', () => {
    const text =
      'Instalação: 7001234\nHistórico de consumo\n06/2026 300\n07/2026 320\n08/2026 340\nVencimento: 10/09/2026';
    const parsed = extractBillFields(text);
    expect(parsed.ucNumber?.value).toBe('7001234');
    expect(parsed.ucNumber?.confidence).toBe(0.7);
    expect(parsed.consumptionHistory?.value.map((p) => p.kwh)).toEqual([300, 320, 340]);
    expect(parsed.consumptionHistory?.confidence).toBe(0.65);
    // a data de vencimento (10/09/2026) não vira ponto de consumo
    expect(parsed.consumptionHistory?.value).toHaveLength(3);
  });

  it('com menos de 2 meses não inventa histórico; texto vazio não devolve nada', () => {
    expect(extractBillFields('AGO/26 480').consumptionHistory).toBeUndefined();
    expect(extractBillFields('')).toEqual({});
    expect(overallConfidence({})).toBeNull();
  });

  it('reconhece grupo A por código de subgrupo e ligação trifásica', () => {
    const parsed = extractBillFields('Subgrupo A4 Verde  TRIFÁSICO');
    expect(parsed.customerGroup?.value).toBe('A');
    expect(parsed.phaseSystem?.value).toBe('THREE_PHASE');
  });
});

describe('PdfTextBillParser', () => {
  const makePdf = (text: string) =>
    new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.fontSize(10).text(text);
      doc.end();
    });

  it('lê o texto de um PDF de verdade e extrai os campos', async () => {
    const parser = new PdfTextBillParser();
    const result = await parser.parse({
      buffer: await makePdf(SAMPLE),
      mimeType: 'application/pdf',
      distributorNames: ['Energia Elétrica do Norte'],
    });
    expect(result.parserName).toBe('pdf-text-heuristic');
    expect(result.textLength).toBeGreaterThan(100);
    expect(result.fields.ucNumber?.value).toBe('12345678-9');
    expect(result.fields.consumptionHistory?.value).toHaveLength(12);
  });

  it('imagem e PDF corrompido não quebram: voltam sem campos', async () => {
    const parser = new PdfTextBillParser();
    const image = await parser.parse({
      buffer: Buffer.from([0x89, 0x50]),
      mimeType: 'image/png',
      distributorNames: [],
    });
    expect(image).toMatchObject({ fields: {}, textLength: 0 });
    const broken = await parser.parse({
      buffer: Buffer.from('%PDF-1.4 lixo'),
      mimeType: 'application/pdf',
      distributorNames: [],
    });
    expect(broken).toMatchObject({ fields: {}, textLength: 0 });
  });
});
