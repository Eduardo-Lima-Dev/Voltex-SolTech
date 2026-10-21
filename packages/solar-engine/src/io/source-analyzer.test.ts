import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSourcePage, classifyDocument, fileTypeOf } from './source-analyzer.js';

describe('tipo do arquivo pelo endereço', () => {
  it('reconhece PDF, CSV, PAN e OND (com ou sem parâmetros) e ignora o resto', () => {
    expect(fileTypeOf('https://x.com/a/B.PDF?v=2')).toBe('pdf');
    expect(fileTypeOf('https://x.com/modulo.pan')).toBe('pan');
    expect(fileTypeOf('https://x.com/inv.OND')).toBe('ond');
    expect(fileTypeOf('https://x.com/lista.csv#x')).toBe('csv');
    expect(fileTypeOf('https://x.com/pagina.html')).toBeNull();
    expect(fileTypeOf('https://x.com/produto')).toBeNull();
  });
});

describe('classificação de um documento', () => {
  it('datasheet de inversor com marca conhecida: confiança alta e motivos', () => {
    const r = classifyDocument({
      title: 'Ficha técnica Inversor Growatt MIN 5000TL-X',
      url: 'https://x.com/min.pdf',
    });
    expect(r).toMatchObject({
      docType: 'DATASHEET',
      equipmentHint: 'INVERTER',
      brand: 'Growatt',
      confidence: 'HIGH',
    });
    expect(r.reasons.join(' ')).toMatch(/ficha técnica/);
  });
  it('arquivos do PVsyst: .PAN é módulo e .OND é inversor, mesmo sem texto', () => {
    expect(classifyDocument({ title: 'JKM550', url: 'https://x.com/a.pan' })).toMatchObject({
      equipmentHint: 'MODULE',
      docType: 'DATASHEET',
    });
    expect(classifyDocument({ title: 'X', url: 'https://x.com/a.ond' })).toMatchObject({
      equipmentHint: 'INVERTER',
    });
  });
  it('manual, certificado, cabo e proteção', () => {
    expect(
      classifyDocument({ title: 'Manual do usuário Inversor', url: 'https://x.com/m.pdf' }).docType,
    ).toBe('MANUAL');
    expect(
      classifyDocument({ title: 'Registro INMETRO', url: 'https://x.com/r.pdf' }).docType,
    ).toBe('CERTIFICATE');
    expect(
      classifyDocument({ title: 'Cabo solar 6 mm2 1,8 kV', url: 'https://x.com/c.pdf' })
        .equipmentHint,
    ).toBe('CABLE');
    expect(
      classifyDocument({ title: 'Disjuntor 32 A curva C', url: 'https://x.com/d.pdf' })
        .equipmentHint,
    ).toBe('PROTECTION');
    expect(classifyDocument({ title: 'Lista de preços', url: 'https://x.com/l.csv' }).docType).toBe(
      'SPREADSHEET',
    );
  });
  it('sem pistas: arquivo genérico com confiança baixa', () => {
    expect(classifyDocument({ title: 'xyz', url: 'https://x.com/abc123.pdf' })).toMatchObject({
      docType: 'FILE',
      equipmentHint: 'OTHER',
      confidence: 'LOW',
    });
  });
});

describe('página de listagem', () => {
  it('tabela do Techlux: tipo, título, marca, PDF e página do produto', () => {
    const html = readFileSync(resolve(__dirname, 'fixtures/techlux-download.html'), 'utf8');
    const page = analyzeSourcePage(html, 'https://techlux.com.br/download?page=3');
    expect(page.documents).toHaveLength(5);
    const doc = page.documents[0]!;
    expect(doc).toMatchObject({ fileType: 'pdf', equipmentHint: 'INVERTER', docType: 'DATASHEET' });
    expect(doc.title).toMatch(/Inversor Chint Power/);
    expect(doc.brand).toMatch(/Chint/i);
    expect(doc.productUrl).toMatch(/techlux\.com\.br\/produto\//);
    expect(page.nextPages.length).toBeGreaterThan(0);
  });

  it('lista simples de links: usa o texto do link, o trecho ao redor e resolve endereços relativos', () => {
    const html = `
      <h2>Módulos</h2>
      <ul>
        <li>Módulo Canadian Solar 550 W — <a href="/files/cs550.pdf">Baixar</a></li>
        <li><a href="arquivos/jinko.PAN">Jinko JKM550M .PAN</a></li>
        <li><a href="mailto:a@b.com">contato</a> <a href="/sobre">Sobre</a></li>
      </ul>
      <a href="?page=2" rel="next">Próxima</a>`;
    const r = analyzeSourcePage(html, 'https://loja.com/downloads/lista');
    expect(r.documents.map((d) => d.url)).toEqual([
      'https://loja.com/files/cs550.pdf',
      'https://loja.com/downloads/arquivos/jinko.PAN',
    ]);
    expect(r.documents[0]).toMatchObject({ brand: 'Canadian Solar', equipmentHint: 'MODULE' });
    expect(r.documents[1]).toMatchObject({
      fileType: 'pan',
      equipmentHint: 'MODULE',
      brand: 'Jinko',
    });
    expect(r.nextPages).toEqual(['https://loja.com/downloads/lista?page=2']);
  });

  it('não duplica o mesmo arquivo e ignora links de outros tipos', () => {
    const html =
      '<a href="/a.pdf">Ficha técnica A</a><a href="/a.pdf">de novo</a><a href="/b.zip">zip</a>';
    expect(analyzeSourcePage(html, 'https://x.com/').documents).toHaveLength(1);
  });

  it('HTML sem arquivos devolve vazio', () => {
    expect(analyzeSourcePage('<p>nada</p>', 'https://x.com/')).toEqual({
      documents: [],
      nextPages: [],
    });
  });
});

describe('tipos off-grid no classificador', () => {
  it('reconhece bateria, controlador de carga e gerador pelo texto', () => {
    const hint = (title: string) =>
      classifyDocument({ url: 'https://exemplo.com/x.pdf', title }).equipmentHint;
    expect(hint('Datasheet bateria estacionária LiFePO4 100Ah')).toBe('BATTERY');
    expect(hint('Datasheet controlador de carga MPPT 60A')).toBe('CHARGE_CONTROLLER');
    expect(hint('Datasheet gerador a diesel 5kVA')).toBe('GENERATOR');
  });
});
