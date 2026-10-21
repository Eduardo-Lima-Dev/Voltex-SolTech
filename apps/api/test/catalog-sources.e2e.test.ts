import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';
import { textPdf, tokenWithRole } from './crm-support';

const LISTING = readFileSync(
  resolve(__dirname, '../../../packages/solar-engine/src/io/fixtures/techlux-download.html'),
  'utf8',
);

describe('Catálogo: fontes na internet, busca e prévia (e2e, respostas gravadas)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let engineer: string;
  let adminB: string;
  let seller: string;
  const calls: string[] = [];
  let pdf: Buffer;
  let pdfUrl = '';

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    t = await createTestApp({ DATA_HUB_ENABLED_SOURCES: 'techlux' });
    const { DataHubHttp } = await import('../src/platform/data-hub/data-hub-http');
    const http = t.app.get(DataHubHttp) as InstanceType<typeof DataHubHttp>;
    http.getBuffer = async (url) => {
      calls.push(url);
      if (url === 'https://techlux.com.br/download?page=1')
        return { body: Buffer.from(LISTING), contentType: 'text/html' };
      if (url.startsWith('https://techlux.com.br/download?page='))
        return { body: Buffer.from('<html></html>'), contentType: 'text/html' };
      if (url === pdfUrl) return { body: pdf, contentType: 'application/pdf' };
      throw new Error(`sem resposta gravada: ${url}`);
    };
    pdf = await textPdf(
      [
        'Maximum Power (Pmax) 550 W',
        'Voltage at Maximum Power (Vmp) 41.7 V',
        'Current at Maximum Power (Imp) 13.19 A',
        'Open Circuit Voltage (Voc) 49.7 V',
        'Short Circuit Current (Isc) 13.98 A',
        'Dimensions 2278 x 1134 x 35 mm',
      ].join('\n'),
    );
    a = await seedTenant(t.prisma, 'src');
    b = await seedTenant(t.prisma, 'srcb');
    engineer = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
  });
  afterAll(() => t.close());

  it('lista as fontes de catálogo com licença, situação e contagem', async () => {
    const res = await get('/catalog/sources', engineer);
    expect(res.status).toBe(200);
    const keys = res.body.map((s: { key: string }) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['techlux', 'cec-library']));
    const techlux = res.body.find((s: { key: string }) => s.key === 'techlux');
    expect(techlux).toMatchObject({
      enabled: true,
      mode: 'documents',
      documentCount: 0,
      licenseStatus: 'PENDING_REVIEW',
    });
    expect(res.body.find((s: { key: string }) => s.key === 'cec-library')).toMatchObject({
      enabled: false,
      mode: 'library',
    });
  });

  it('atualizar lê a listagem pública (página a página) e guarda só os links', async () => {
    const res = await post('/catalog/sources/techlux/refresh', engineer);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pages: 1, found: 5, created: 5 });
    expect(calls).toEqual([
      'https://techlux.com.br/download?page=1',
      'https://techlux.com.br/download?page=2',
    ]);
    // Repetir não duplica.
    const again = await post('/catalog/sources/techlux/refresh', engineer);
    expect(again.body).toMatchObject({ found: 5, created: 0 });
    const sources = await get('/catalog/sources', engineer);
    expect(sources.body.find((s: { key: string }) => s.key === 'techlux')).toMatchObject({
      documentCount: 5,
    });
  });

  it('busca por marca/modelo e por tipo, paginada', async () => {
    const all = await get('/catalog/sources/techlux/documents', engineer);
    expect(all.body.data).toHaveLength(5);
    const deye = await get('/catalog/sources/techlux/documents?search=deye', engineer);
    expect(deye.body.data.length).toBeGreaterThan(0);
    expect(
      deye.body.data.every((d: { title: string; brand: string }) =>
        /deye/i.test(`${d.title}${d.brand}`),
      ),
    ).toBe(true);
    const none = await get('/catalog/sources/techlux/documents?search=zzzz', engineer);
    expect(none.body.data).toEqual([]);
    expect(
      (await get('/catalog/sources/techlux/documents?equipment=INVERTER', engineer)).body.data,
    ).toHaveLength(5);
    expect(
      (await get('/catalog/sources/techlux/documents?docType=Manual', engineer)).body.data,
    ).toEqual([]);
    expect(all.body.data[0]).toMatchObject({
      docType: 'Datasheet',
      pdfUrl: expect.stringMatching(/^https:\/\/techlux\.com\.br\//),
    });
  });

  it('prévia de ficha de inversor cujo layout não é reconhecido: explica, sem inventar um módulo; nada é gravado', async () => {
    const doc = (await get('/catalog/sources/techlux/documents?search=chint', engineer)).body
      .data[0];
    pdfUrl = doc.pdfUrl;
    const res = await post(`/catalog/sources/documents/${doc.id}/preview`, engineer);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
    expect(res.body.errors[0].message).toMatch(
      /Não reconheci a tabela de especificações de inversor/,
    );
    expect(res.body.notes[0]).toMatch(/Fonte: .*techlux\.com\.br/);
    expect((await get('/catalog/items?pageSize=50', engineer)).body.data).toEqual([]);
  });

  it('prévia de ficha de módulo: lê o PDF baixado, devolve candidatos com a marca da fonte e a origem do PDF', async () => {
    const doc = (await get('/catalog/sources/techlux/documents?search=chint', engineer)).body
      .data[0];
    pdfUrl = doc.pdfUrl;
    // O palpite do tipo vem da listagem: ajustado aqui para exercitar o caminho de módulo.
    const row = await t.prisma.system.externalRecord.findUniqueOrThrow({ where: { id: doc.id } });
    await t.prisma.system.externalRecord.update({
      where: { id: doc.id },
      data: { spec: { ...(row.spec as object), equipmentHint: 'MODULE' } },
    });
    const res = await post(`/catalog/sources/documents/${doc.id}/preview`, engineer);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0]).toMatchObject({
      kind: 'MODULE',
      origin: 'DATASHEET_PDF',
      manufacturer: doc.brand,
    });
    expect(res.body.candidates[0].spec).toMatchObject({ pmaxWp: 550 });
    expect((await get('/catalog/items?pageSize=50', engineer)).body.data).toEqual([]);
  });

  it('permissões e isolamento: vendedor não vê o catálogo; atualizar e prévia exigem gestão; fonte desconhecida dá 404', async () => {
    expect((await get('/catalog/sources', seller)).status).toBe(403);
    expect((await post('/catalog/sources/techlux/refresh', seller)).status).toBe(403);
    expect((await post('/catalog/sources/nao-existe/refresh', engineer)).status).toBe(404);
    // Dados globais: outra empresa enxerga a mesma lista (sem dado de empresa nela).
    expect((await get('/catalog/sources/techlux/documents', adminB)).body.data).toHaveLength(5);
  });

  it('com a fonte desligada no servidor, atualizar é recusado com explicação', async () => {
    const off = await createTestApp({ DATA_HUB_ENABLED_SOURCES: '' });
    try {
      const token = await tokenFor(off.http, a.admin);
      const res = await off.http.post(`${API}/catalog/sources/techlux/refresh`).set(bearer(token));
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/desligada/);
    } finally {
      await off.close();
    }
  });
});
