import PDFDocument from 'pdfkit';

/** PDF do contrato a partir do texto já preenchido (Helvetica cobre o português). */
export function buildContractPdf(input: {
  title: string;
  subtitle: string;
  body: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: input.title, Subject: input.subtitle },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const [first = '', ...rest] = input.body.split('\n');
    doc.font('Helvetica-Bold').fontSize(14).text(first, { align: 'center' });
    doc.moveDown(0.8).font('Helvetica').fontSize(10.5);
    for (const line of rest) {
      const heading = /^\d+\.\s+[A-ZÀ-Ú ]+$/.test(line.trim());
      doc
        .font(heading ? 'Helvetica-Bold' : 'Helvetica')
        .text(line.length ? line : ' ', { lineGap: 2 });
    }
    doc.end();
  });
}
