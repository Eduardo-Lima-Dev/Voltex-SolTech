import PDFDocument from 'pdfkit';
import type {
  EngineeringDesign,
  EngineeringResults,
  EngineeringVersionStatus,
} from '@voltex/shared';

const n = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface EngineeringReportInput {
  projectCode: string;
  projectName: string;
  version: number;
  status: EngineeringVersionStatus;
  design: EngineeringDesign;
  results: EngineeringResults;
}

/**
 * Memorial técnico legível e reproduzível. Não é ART nem substitui um projeto elétrico assinado.
 * O arquivo é deliberadamente gerado do desenho e resultado já persistidos, sem consultas externas.
 */
export function buildEngineeringReportPdf(input: EngineeringReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 46,
      info: {
        Title: `Memorial técnico — ${input.projectCode}`,
        Subject: `Versão ${input.version}`,
        Author: 'Voltex SolTech',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const heading = (text: string) => {
      if (doc.y > doc.page.height - 115) doc.addPage();
      doc.moveDown(0.75).font('Helvetica-Bold').fontSize(14).fillColor('#002362').text(text);
      doc.moveDown(0.25).fillColor('#111');
    };
    const line = (label: string, value: string) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
      doc.font('Helvetica').fontSize(9).text(value);
    };

    doc.rect(0, 0, doc.page.width, 78).fill('#002362');
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('Memorial técnico solar', 46, 26);
    doc
      .fillColor('#111')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(input.projectName, 46, 100, { width });
    line('Projeto', input.projectCode);
    line('Versão', `${input.version} · ${input.status}`);
    if (input.status !== 'APPROVED') {
      doc
        .moveDown(0.7)
        .fillColor('#a82020')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('RASCUNHO PARA REVISÃO — não substitui projeto elétrico assinado.');
    }

    heading('Local e premissas');
    line(
      'Coordenadas',
      `${n(input.design.site.latitude, 5)}, ${n(input.design.site.longitude, 5)}`,
    );
    line(
      'Localidade',
      [input.design.site.city, input.design.site.state].filter(Boolean).join(' / ') ||
        'Não informada',
    );
    line(
      'Temperatura mínima de projeto',
      `${n(input.design.site.designTminC, 1)} °C · ${input.design.site.designTemperatureSource ?? 'fonte não informada'}`,
    );
    line('Superfícies', `${input.design.surfaces.length}`);

    heading('Compatibilidade e proteções');
    line('Compatibilidade', input.results.compatibility.status);
    line('Proteções', input.results.protection.status);
    line('Cabos', input.results.cables.status);
    for (const check of input.results.compatibility.inverters.flatMap((item) => item.checks)) {
      if (check.outcome !== 'PASS') line(`${check.code} (${check.outcome})`, check.message);
    }

    heading('Geração e conexão');
    const simulation = input.results.simulation;
    line('Simulação', simulation?.status ?? 'PENDENTE');
    line('Geração anual', `${n(simulation?.energyKwh, 0)} kWh`);
    line('Clipping', `${n(simulation?.clippingKwh, 0)} kWh`);
    line(
      'Performance ratio',
      simulation?.performanceRatio === null || simulation?.performanceRatio === undefined
        ? '—'
        : `${n(simulation.performanceRatio * 100, 1)}%`,
    );
    line('Conexão', input.results.connection?.status ?? 'PENDENTE');
    for (const finding of input.results.connection?.findings ?? [])
      line(finding.code, finding.message);

    heading('Lista de materiais');
    for (const item of input.results.bom.lines) {
      line(item.description, `${n(item.quantity, 2)} ${item.unit} · ${money(item.totalCents)}`);
    }
    line('Total de materiais', money(input.results.bom.totalCents));

    heading('Viabilidade econômica');
    const economics = input.results.economics;
    line('Status', economics?.status ?? 'PENDENTE');
    line('CAPEX', money(economics?.capexCents));
    line(
      'Payback simples',
      economics?.simplePaybackYears === null || economics?.simplePaybackYears === undefined
        ? '—'
        : `${n(economics.simplePaybackYears, 1)} anos`,
    );
    line('VPL', money(economics?.npvCents));
    line(
      'TIR',
      economics?.irrPct === null || economics?.irrPct === undefined
        ? '—'
        : `${n(economics.irrPct, 2)}%`,
    );
    line(
      'LCOE',
      economics?.lcoeCentsPerKwh === null || economics?.lcoeCentsPerKwh === undefined
        ? '—'
        : `${n(economics.lcoeCentsPerKwh / 100, 3)} R$/kWh`,
    );

    heading('Rastreabilidade');
    line(
      'Algoritmos',
      Object.entries(input.results.algorithmVersions)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' · ') || 'Não informado',
    );
    if (input.results.pending.length > 0) {
      line(
        'Pendências',
        input.results.pending.map((item) => `${item.code}: ${item.message}`).join(' | '),
      );
    }
    doc
      .moveDown(1)
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555')
      .text(
        'Memorial gerado a partir da versão persistida do Solar Engine Studio. Fontes, regras e equipamentos usados permanecem registrados no snapshot aprovado.',
        { width },
      );
    doc.end();
  });
}

/** PDF do unifilar preliminar; a geometria completa continua disponível no SVG/DXF. */
export function buildSingleLinePdf(input: EngineeringReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 42 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#002362')
      .text('Diagrama unifilar preliminar');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#222')
      .text(`${input.projectCode} · ${input.projectName} · versão ${input.version}`);
    doc
      .moveDown(0.5)
      .fillColor('#a82020')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('RASCUNHO PARA REVISÃO — não substitui projeto elétrico assinado.');

    const y = 250;
    const box = (x: number, title: string, body: string) => {
      doc.roundedRect(x, y, 130, 72, 5).lineWidth(1.2).strokeColor('#002362').stroke();
      doc
        .fillColor('#002362')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(title, x + 8, y + 12, {
          width: 114,
          align: 'center',
        });
      doc
        .fillColor('#222')
        .font('Helvetica')
        .fontSize(8)
        .text(body, x + 8, y + 32, {
          width: 114,
          align: 'center',
        });
    };
    const arrow = (x1: number, x2: number) => {
      const mid = y + 36;
      doc.moveTo(x1, mid).lineTo(x2, mid).strokeColor('#002362').stroke();
      doc
        .moveTo(x2, mid)
        .lineTo(x2 - 7, mid - 4)
        .lineTo(x2 - 7, mid + 4)
        .fill('#002362');
    };
    const modules = input.results.totals.moduleCount ?? 0;
    const power = input.results.totals.powerKwp;
    const inverterCount = input.design.inverters.length;
    box(48, 'ARRANJO FV', `${modules} módulos\n${n(power, 3)} kWp CC`);
    arrow(178, 222);
    box(222, 'INVERSOR', `${inverterCount} unidade(s)\n${input.results.compatibility.status}`);
    arrow(352, 396);
    box(
      396,
      'PROTEÇÕES',
      `${input.results.protection.items.length} item(ns)\n${input.results.protection.status}`,
    );
    arrow(526, 570);
    box(
      570,
      'REDE / UC',
      `${input.results.connection?.status ?? 'PENDENTE'}\n${n(power, 3)} kW referência`,
    );
    doc
      .moveDown(13)
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555')
      .text(
        `Cabos: ${input.results.cables.status}. Exportação SVG e DXF preserva o mesmo conteúdo técnico.`,
      );
    doc.end();
  });
}
