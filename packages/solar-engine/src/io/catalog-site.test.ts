import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { equipmentHint, parseCatalogSiteDownloads } from './catalog-site.js';

const html = readFileSync(resolve(__dirname, 'fixtures/techlux-download.html'), 'utf8');

describe('listagem de downloads de uma distribuidora', () => {
  const docs = parseCatalogSiteDownloads(html, 'https://techlux.com.br/download');

  it('lê tipo, título, marca e os endereços do PDF e do produto', () => {
    expect(docs).toHaveLength(5);
    expect(docs[0]).toMatchObject({
      docType: 'Datasheet',
      brand: expect.any(String),
      equipmentHint: 'INVERTER',
    });
    expect(docs[0]?.title).toMatch(/^Inversor Chint Power/);
    expect(docs[0]?.pdfUrl).toMatch(
      /^https:\/\/techlux\.com\.br\/storage\/products\/\d+\/[\w-]+\.pdf$/,
    );
    expect(docs[0]?.productUrl).toMatch(/^https:\/\/techlux\.com\.br\/produto\//);
  });

  it('linhas sem PDF ou sem título são ignoradas; HTML sem tabela devolve lista vazia', () => {
    expect(parseCatalogSiteDownloads('<p>nada</p>', 'https://x.com')).toEqual([]);
    expect(
      parseCatalogSiteDownloads(
        '<table><tr><td><p class="font-weight-bold">Manual</p></td></tr></table>',
        'https://x.com',
      ),
    ).toEqual([]);
  });

  it('endereços relativos viram absolutos e entidades HTML são decodificadas', () => {
    const [doc] = parseCatalogSiteDownloads(
      '<tr><td><p class="m-0 font-weight-bold">Datasheet</p><p class="m-0 text-muted">Módulo A&amp;B 550 W</p></td><td>Marca &amp; Cia</td><td><a href="/files/a.pdf">x</a></td></tr>',
      'https://loja.com/download',
    );
    expect(doc).toMatchObject({
      title: 'Módulo A&B 550 W',
      brand: 'Marca & Cia',
      pdfUrl: 'https://loja.com/files/a.pdf',
      productUrl: null,
      equipmentHint: 'MODULE',
    });
  });

  it('palpite do tipo pelo título', () => {
    expect(equipmentHint('Microinversor Hoymiles HMS-800')).toBe('INVERTER');
    expect(equipmentHint('Painel Solar 550W')).toBe('MODULE');
    expect(equipmentHint('Bateria 48V')).toBe('OTHER');
  });
});
