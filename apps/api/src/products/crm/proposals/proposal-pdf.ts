import PDFDocument from 'pdfkit';
import type { ProposalContent } from './proposal-content';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (value: number, digits = 0) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const money = (cents: number) => brl.format(cents / 100).replace(/\u00a0/g, ' ');
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DEFAULT_COLOR = '#002362';

export interface PdfLogo {
  buffer: Buffer;
}

/**
 * PDF da proposta, gerado só a partir do snapshot (o que o cliente vê na página): nunca tem custos nem margem.
 * Usa as fontes padrão do PDF (Helvetica), que cobrem o português.
 */
export function buildProposalPdf(content: ProposalContent, logo?: PdfLogo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: `Proposta — ${content.title}`,
        Author: content.tenantName,
        Subject: content.projectCode,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const color = content.brand.primaryColor ?? DEFAULT_COLOR;
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Cabeçalho com a marca da empresa.
    doc.rect(0, 0, doc.page.width, 84).fill(color);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(content.tenantName, left, 30, { width: width - 120 });
    if (logo) {
      try {
        doc.image(logo.buffer, doc.page.width - left - 100, 14, { fit: [100, 56], align: 'right' });
      } catch {
        // imagem inválida: segue só com o nome
      }
    }

    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('Proposta comercial', left, 110);
    doc.font('Helvetica').fontSize(11).fillColor('#444444');
    doc.text(content.title);
    doc.text(`Cliente: ${content.customerName}`);
    doc.text(
      `Project ID: ${content.projectCode} · Versão ${content.version} · Válida até ${date(content.validUntil)}`,
    );
    doc.moveDown(1);

    const row = (label: string, value: string, y: number, x: number, w: number) => {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#666666')
        .text(label.toUpperCase(), x, y, { width: w });
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor('#111111')
        .text(value, x, y + 12, { width: w });
    };

    content.scenarios.forEach((s, index) => {
      if (doc.y > doc.page.height - 330) doc.addPage();
      const top = doc.y + 8;
      doc.roundedRect(left, top, width, 22, 4).fill(color);
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(`${s.label || `Cenário ${index + 1}`}`, left + 10, top + 5);
      let y = top + 36;
      const col = width / 3;
      const cells: [string, string][] = [
        ['Potência instalada', `${num(s.installedPowerKwp, 2)} kWp`],
        ['Módulos', `${num(s.moduleCount)}`],
        ['Área estimada', `${num(s.estimatedAreaM2, 1)} m²`],
        ['Geração anual', `${num(s.annualGenerationKwh)} kWh`],
        ['Consumo médio mensal', `${num(s.averageMonthlyConsumptionKwh)} kWh`],
        ['Compensação', `${num(s.compensationRatio * 100)}%`],
        ['Investimento', money(s.priceCents)],
        ['Economia no 1º ano', money(s.firstYearSavingsCents)],
        [
          'Retorno do investimento',
          s.simplePaybackYears === null
            ? 'Sem retorno no período'
            : `${num(s.simplePaybackYears, 1)} anos`,
        ],
      ];
      cells.forEach(([label, value], i) => {
        row(label, value, y + Math.floor(i / 3) * 42, left + (i % 3) * col, col - 8);
      });
      y += 3 * 42 + 4;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#444444')
        .text(
          `Economia estimada em ${s.horizonYears} anos: ${money(s.accumulatedSavingsCents)}`,
          left,
          y,
          { width },
        );
      y = doc.y + 8;
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#666666')
        .text('GERAÇÃO MENSAL ESTIMADA (kWh)', left, y);
      y += 14;
      const cell = width / 6;
      s.monthlyGenerationKwh.forEach((kwh, m) => {
        const cx = left + (m % 6) * cell;
        const cy = y + Math.floor(m / 6) * 30;
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#666666')
          .text(MONTHS[m] ?? '', cx, cy, { width: cell });
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#111111')
          .text(num(kwh), cx, cy + 10, { width: cell });
      });
      doc.y = y + 66;
    });

    if (content.conditions.paymentTerms || content.conditions.notes) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#111111')
        .text('Condições comerciais', left, doc.y + 6);
      doc.font('Helvetica').fontSize(10).fillColor('#444444');
      if (content.conditions.paymentTerms)
        doc.text(`Pagamento: ${content.conditions.paymentTerms}`, { width });
      if (content.conditions.notes) doc.text(content.conditions.notes, { width });
      doc.moveDown(0.5);
    }

    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.moveDown(0.5);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#777777')
      .text(content.disclaimer, left, doc.y, { width });
    doc.moveDown(0.5);
    doc.text(
      `Gerada em ${date(content.generatedAt)} · ${content.tenantName} · ${content.projectCode}`,
      { width },
    );
    doc.end();
  });
}
