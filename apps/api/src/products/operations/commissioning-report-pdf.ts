import PDFDocument from 'pdfkit';
import { INTERNAL_TEST_RULE_WARNING, type CommissioningRecordDto } from '@voltex/shared';

const RESULT_LABEL: Record<string, string> = {
  PENDING: 'Sem registro',
  PENDING_RULE: 'Sem regra para julgar',
  PENDING_DATA: 'Sem dado',
  PASS: 'Conforme',
  FAIL: 'Reprovado',
  NOT_APPLICABLE: 'Não se aplica',
};

const n = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

export interface CommissioningReportInput {
  projectCode: string;
  accountName: string;
  siteLabel: string | null;
  record: CommissioningRecordDto;
  /** Nome de quem enviou, de quem decidiu e o momento. */
  submittedBy: string | null;
  decidedBy: string | null;
  generatedAt: Date;
}

/**
 * Relatório de comissionamento (a "conclusão" que o livro EnergIF cita na p. 194), gerado dos ensaios já gravados.
 * Registra os ensaios, as condições e quem aprovou; **não é ART/TRT nem laudo assinado**: o responsável técnico segue
 * respondendo pelo projeto e pela obra.
 */
export function buildCommissioningReportPdf(input: CommissioningReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { record: r } = input;
    const doc = new PDFDocument({
      size: 'A4',
      margin: 46,
      info: {
        Title: `Relatório de comissionamento — ${input.projectCode}`,
        Subject: `Tentativa ${r.attempt}`,
        Author: 'Voltex SolTech',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const ensure = (space: number) => {
      if (doc.y > doc.page.height - space) doc.addPage();
    };
    const heading = (text: string) => {
      ensure(115);
      doc.moveDown(0.75).font('Helvetica-Bold').fontSize(13).fillColor('#002362').text(text);
      doc.moveDown(0.25).fillColor('#111');
    };
    const line = (label: string, value: string) => {
      ensure(60);
      doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
      doc.font('Helvetica').fontSize(9).text(value);
    };

    doc.rect(0, 0, doc.page.width, 78).fill('#002362');
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('Relatório de comissionamento', 46, 26);
    doc
      .fillColor('#111')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(input.accountName, 46, 100, { width });
    line('Projeto', input.projectCode);
    if (input.siteLabel) line('Local', input.siteLabel);
    line(
      'Tentativa',
      `${r.attempt} · nível ${r.level === 'EXTENDED' ? 'ampliado (categorias 1 e 2)' : 'padrão (categoria 1)'}`,
    );
    line(
      'Emitido em',
      input.generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    );

    if (r.provisional) {
      heading('Modelo provisório');
      doc
        .fillColor('#92400e')
        .font('Helvetica')
        .fontSize(9)
        .text(r.ruleNote ?? 'Sem regra de comissionamento ativa.', { width });
      doc.fillColor('#111');
    }
    if (r.internalTestRule) {
      heading('Regra de teste interno');
      doc
        .fillColor('#b91c1c')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(INTERNAL_TEST_RULE_WARNING, { width });
      doc.fillColor('#111');
    }

    heading('Regra aplicada');
    line('Referência', r.ruleRef);
    if (r.ruleReviewedBy) line('Revisada por', r.ruleReviewedBy);

    heading('Condições da medição');
    line(
      'Irradiância',
      r.conditions.irradianceWm2 != null ? `${n(r.conditions.irradianceWm2, 0)} W/m²` : '—',
    );
    line(
      'Temperatura do módulo',
      r.conditions.moduleTempC != null ? `${n(r.conditions.moduleTempC, 1)} °C` : '—',
    );
    line(
      'Temperatura ambiente',
      r.conditions.ambientC != null ? `${n(r.conditions.ambientC, 1)} °C` : '—',
    );

    heading('Resumo');
    const c = r.summary.counts;
    line('Ensaios', String(r.summary.total));
    line('Conformes', String(c.PASS));
    line('Reprovados', String(c.FAIL));
    line('Sem regra ou sem dado para julgar', String(c.PENDING_RULE + c.PENDING_DATA));
    line('Sem registro', String(c.PENDING));
    line('Não se aplicam', String(c.NOT_APPLICABLE));

    heading('Ensaios');
    let group = '';
    for (const t of r.tests) {
      if (t.group !== group) {
        group = t.group;
        ensure(120);
        doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).fillColor('#002362').text(group);
        doc.fillColor('#111');
      }
      ensure(95);
      const color = t.result === 'FAIL' ? '#b91c1c' : t.result === 'PASS' ? '#166534' : '#92400e';
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#111')
        .text(`${t.label}`, { width, continued: false });
      doc.font('Helvetica').fontSize(8).fillColor('#555').text(t.subjectLabel, { width });
      const parts: string[] = [];
      if (t.kind === 'MEASURE') {
        parts.push(
          `medido: ${t.measuredValue !== null ? `${n(t.measuredValue)} ${t.unit ?? ''}` : '—'}`,
        );
        if (t.expectedValue !== null) parts.push(`esperado: ${n(t.expectedValue)} ${t.unit ?? ''}`);
        if (t.deviationPct !== null) parts.push(`desvio: ${n(t.deviationPct, 1)} %`);
        if (t.tolerancePct !== null) parts.push(`tolerância: ${n(t.tolerancePct, 1)} %`);
        if (t.min !== null) parts.push(`mín.: ${n(t.min)}`);
        if (t.max !== null) parts.push(`máx.: ${n(t.max)}`);
      }
      doc
        .fillColor(color)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text([RESULT_LABEL[t.result] ?? t.result, ...parts].join(' · '), { width });
      if (t.basis)
        doc.fillColor('#555').font('Helvetica').fontSize(7).text(`Cálculo: ${t.basis}`, { width });
      if (t.reason) doc.fillColor('#555').font('Helvetica').fontSize(7).text(t.reason, { width });
      if (t.note)
        doc
          .fillColor('#555')
          .font('Helvetica-Oblique')
          .fontSize(7)
          .text(`Obs.: ${t.note}`, { width });
      doc.fillColor('#111').moveDown(0.3);
    }

    if (r.notes.length > 0 || r.skipped.length > 0) {
      heading('Avisos');
      for (const note of r.notes) doc.font('Helvetica').fontSize(8).text(`• ${note}`, { width });
      for (const s of r.skipped)
        doc
          .font('Helvetica')
          .fontSize(8)
          .text(`• Ensaio ${s.code} não gerado: ${s.reason}.`, { width });
    }

    heading('Responsáveis');
    line('Enviado para revisão por', input.submittedBy ?? '—');
    line(
      'Decisão',
      r.status === 'APPROVED' ? 'Aprovado' : r.status === 'REJECTED' ? 'Reprovado' : 'Pendente',
    );
    line('Decidido por', input.decidedBy ?? '—');
    if (r.decisionNote) line('Observação', r.decisionNote);

    ensure(120);
    doc
      .moveDown(1.2)
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#555')
      .text(
        'Este relatório registra os ensaios feitos em campo e a decisão do responsável técnico. Não é ART, TRT ou RRT e não substitui o laudo assinado pelo profissional habilitado.',
        { width },
      );
    doc.end();
  });
}
