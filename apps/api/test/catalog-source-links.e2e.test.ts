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

const BASE = 'https://203.0.113.50/downloads';
const PAGE1 = `<html><body><table><thead><tr><th>Arquivo</th><th>Marca</th></tr></thead><tbody>
<tr><td>Ficha técnica Módulo Jinko JKM550M-72HL4</td><td>Jinko</td><td><a href="/files/jkm550.pdf">Baixar</a></td></tr>
<tr><td>Ficha técnica Inversor Growatt MIN 5000TL-X</td><td>Growatt</td><td><a href="/files/min5000.pdf">Baixar</a></td></tr>
<tr><td>Cabo solar 6 mm2</td><td>Prysmian</td><td><a href="/files/cabo6.pdf">Baixar</a></td></tr>
</tbody></table><a href="/downloads?page=2" rel="next">Próxima</a></body></html>`;
const PAGE2 = `<html><body><ul><li>Disjuntor 32 A — <a href="/files/disj32.pdf">Ficha técnica</a></li>
<li><a href="/files/jkm550.pan">Jinko JKM550M .PAN</a></li><li><a href="/sobre">Sobre nós</a></li></ul></body></html>`;

describe('Catálogo: fontes por link e busca unificada (e2e, respostas gravadas)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let engineer: string;
  let seller: string;
  let adminB: string;
  let linkId = '';
  const calls: string[] = [];
  let pdf: Buffer;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    t = await createTestApp({ DATA_HUB_ENABLED_SOURCES: '' });
    const { DataHubHttp } = await import('../src/platform/data-hub/data-hub-http');
    const http = t.app.get(DataHubHttp) as InstanceType<typeof DataHubHttp>;
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
    http.getBuffer = async (url) => {
      calls.push(url);
      if (url === BASE) return { body: Buffer.from(PAGE1), contentType: 'text/html' };
      if (url === 'https://203.0.113.50/downloads?page=2')
        return { body: Buffer.from(PAGE2), contentType: 'text/html' };
      if (url === 'https://203.0.113.50/files/jkm550.pdf')
        return { body: pdf, contentType: 'application/pdf' };
      if (url === 'https://203.0.113.52/produtos')
        return {
          body: Buffer.from(
            '<html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
          ),
          contentType: 'text/html',
        };
      if (url === 'https://203.0.113.51/ficha.pdf')
        return { body: pdf, contentType: 'application/pdf' };
      throw new Error(`sem resposta gravada: ${url}`);
    };
    a = await seedTenant(t.prisma, 'lnk');
    b = await seedTenant(t.prisma, 'lnkb');
    engineer = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
  });
  afterAll(() => t.close());

  it('cadastra a fonte por link, analisa a página e as seguintes e cataloga os arquivos com a classificação', async () => {
    const res = await post('/catalog/source-links', engineer, {
      url: BASE,
      label: 'Distribuidor Exemplo',
    });
    expect(res.status).toBe(201);
    linkId = res.body.id;
    expect(res.body).toMatchObject({
      label: 'Distribuidor Exemplo',
      status: 'ACTIVE',
      pagesRead: 2,
      documentCount: 5,
    });
    expect(res.body.byEquipment).toMatchObject({ MODULE: 2, INVERTER: 1, CABLE: 1, PROTECTION: 1 });
    expect(calls).toEqual([BASE, 'https://203.0.113.50/downloads?page=2']);

    const docs = await get(`/catalog/source-links/${linkId}/documents?pageSize=50`, engineer);
    expect(docs.body.data).toHaveLength(5);
    const jinko = docs.body.data.find(
      (d: { fileType: string; title: string }) => d.fileType === 'pdf' && /Jinko/.test(d.title),
    );
    expect(jinko).toMatchObject({
      brand: 'Jinko',
      equipmentHint: 'MODULE',
      docType: 'DATASHEET',
      url: 'https://203.0.113.50/files/jkm550.pdf',
    });
    expect(jinko.reasons.join(' ')).toMatch(/Marca/);
    const pan = docs.body.data.find((d: { fileType: string }) => d.fileType === 'pan');
    expect(pan).toMatchObject({ equipmentHint: 'MODULE' });
    expect(
      (await get(`/catalog/source-links/${linkId}/documents?equipment=CABLE`, engineer)).body.data,
    ).toHaveLength(1);
    expect(
      (await get(`/catalog/source-links/${linkId}/documents?fileType=pan`, engineer)).body.data,
    ).toHaveLength(1);
  });

  it('repetir o endereço é recusado; analisar de novo não duplica', async () => {
    expect((await post('/catalog/source-links', engineer, { url: BASE })).status).toBe(409);
    const again = await post(`/catalog/source-links/${linkId}/analyze`, engineer);
    expect(again.body.documentCount).toBe(5);
  });

  it('endereço direto de arquivo vira uma fonte de um documento', async () => {
    const res = await post('/catalog/source-links', engineer, {
      url: 'https://203.0.113.51/ficha.pdf',
    });
    expect(res.status).toBe(201);
    expect(res.body.documentCount).toBe(1);
  });

  it('página montada por JavaScript: explica que os links não aparecem e o que fazer', async () => {
    const res = await post('/catalog/source-links', engineer, {
      url: 'https://203.0.113.52/produtos',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'ERROR', documentCount: 0 });
    expect(res.body.lastError).toMatch(/montada por JavaScript/);
  });

  it('endereço interno é recusado (SSRF) e página sem arquivos vira erro explicado', async () => {
    expect(
      (await post('/catalog/source-links', engineer, { url: 'http://127.0.0.1/x' })).status,
    ).toBe(400);
    expect(
      (await post('/catalog/source-links', engineer, { url: 'http://localhost/x' })).status,
    ).toBe(400);
  });

  it('a busca unificada mostra de onde vem cada resultado', async () => {
    await post('/catalog/items', engineer, {
      kind: 'MODULE',
      manufacturer: 'Jinko',
      model: 'JKM550 (meu)',
      spec: {
        technology: 'MONO_SI',
        pmaxWp: 550,
        vmppV: 41.7,
        imppA: 13.19,
        vocV: 49.7,
        iscA: 13.98,
        betaVocPctPerC: -0.27,
        alphaIscPctPerC: 0.05,
        gammaPmaxPctPerC: -0.34,
        lengthMm: 2278,
        widthMm: 1134,
      },
    });
    const res = await get('/catalog/search?q=jinko', engineer);
    expect(res.status).toBe(200);
    const origins = res.body.map((r: { origin: string }) => r.origin);
    expect(origins[0]).toBe('CATALOG');
    expect(origins).toContain('LINK');
    const link = res.body.find((r: { origin: string }) => r.origin === 'LINK');
    expect(link).toMatchObject({ sourceLabel: 'Distribuidor Exemplo', kind: 'MODULE' });
    const filtered = await get('/catalog/search?q=jinko&kind=INVERTER', engineer);
    expect(filtered.body).toEqual([]);
    expect((await get('/catalog/search?q=j', engineer)).status).toBe(422);
  });

  it('prévia de PDF de uma fonte por link usa o leitor e devolve candidatos com a marca; nada é gravado', async () => {
    const docs = await get(
      `/catalog/source-links/${linkId}/documents?search=Jinko&fileType=pdf`,
      engineer,
    );
    const res = await post(
      `/catalog/source-links/documents/${docs.body.data[0].id}/preview`,
      engineer,
    );
    expect(res.status).toBe(200);
    expect(res.body.candidates[0]).toMatchObject({
      kind: 'MODULE',
      manufacturer: 'Jinko',
      origin: 'DATASHEET_PDF',
    });
    expect(res.body.candidates[0].spec).toMatchObject({ pmaxWp: 550 });
    expect(res.body.notes[0]).toMatch(/Fonte: Distribuidor Exemplo/);
    expect(
      (await get('/catalog/items?search=JKM550M&pageSize=50', engineer)).body.data.every(
        (i: { model: string }) => i.model.includes('(meu)'),
      ),
    ).toBe(true);
  });

  it('isolamento e permissões: outra empresa não vê a fonte; vendedor não acessa; remover apaga os documentos', async () => {
    expect((await get('/catalog/source-links', adminB)).body).toEqual([]);
    expect(
      (await get('/catalog/search?q=jinko', adminB)).body.every(
        (r: { origin: string }) => r.origin !== 'LINK',
      ),
    ).toBe(true);
    expect((await get('/catalog/source-links', seller)).status).toBe(403);
    expect((await post('/catalog/source-links', seller, { url: BASE })).status).toBe(403);
    expect(
      (await t.http.delete(`${API}/catalog/source-links/${linkId}`).set(bearer(adminB))).status,
    ).toBe(404);
    const del = await t.http.delete(`${API}/catalog/source-links/${linkId}`).set(bearer(engineer));
    expect(del.status).toBe(200);
    expect(await t.prisma.system.catalogSourceDocument.count({ where: { linkId } })).toBe(0);
  });
});
