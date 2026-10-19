import PizZip from 'pizzip';
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
import { acceptedDeal, ensureMarginPolicy } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { auditOf } from './crm-support';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Monta um .docx mínimo e válido com os parágrafos dados (cada um vira um <w:p>). */
function docx(paragraphs: string[]): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = paragraphs
    .map(
      (p) =>
        `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`,
    )
    .join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
}
const text = (buffer: Buffer) => new PizZip(buffer).file('word/document.xml')!.asText();

describe('Modelo de contrato em Word (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let flow: Flow;
  let manager: string;
  let seller: string;

  const upload = (
    token: string,
    file: Buffer | null,
    name = 'modelo.docx',
    fields: Record<string, string> = {},
    type = DOCX,
  ) => {
    let req = t.http.post(`${API}/contract-template/upload`).set(bearer(token));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return file ? req.attach('file', file, { filename: name, contentType: type }) : req;
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'docx');
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.admin) };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  it('recusa arquivo que não é Word, vazio de variáveis, com variável desconhecida ou mal formado', async () => {
    expect(
      (await upload(manager, Buffer.from('texto'), 'modelo.txt', {}, 'text/plain')).status,
    ).toBe(422);
    const none = await upload(manager, docx(['Contrato sem nenhuma variável']));
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('NO_TEMPLATE_VARIABLES');
    const unknown = await upload(
      manager,
      docx(['Cliente {{cliente.nomee}} paga {{contrato.valor}}']),
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body.data.unknown).toEqual(['cliente.nomee']);
    const broken = await upload(manager, docx(['Cliente {{cliente.nome e nada mais']));
    expect(broken.status).toBe(422);
    expect(broken.body.code).toBe('INVALID_DOCX_TEMPLATE');
    expect(
      (await upload(manager, Buffer.from('PK-nao-e-um-docx-de-verdade'))).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await upload(manager, null)).status).toBeGreaterThanOrEqual(400);
    expect((await get('/contract-template', manager)).body.isDefault).toBe(true);
  });

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));

  it('só quem gerencia contratos envia o modelo; vendedor não', async () => {
    const file = docx(['Contrato de {{cliente.nome}}']);
    expect((await upload(seller, file)).status).toBe(403);
    expect(
      (await t.http.post(`${API}/contract-template/upload`).attach('file', file, 'm.docx')).status,
    ).toBe(401);
  });

  it('o modelo enviado vira a versão atual e pode ser baixado de volta', async () => {
    const file = docx([
      'CONTRATO DA EMPRESA',
      'Contratante: {{cliente.nome}}, CPF/CNPJ {{cliente.documento}}.',
      'Valor: {{contrato.valor}}. Projeto {{projeto.codigo}}.',
      'Pagamento: {{contrato.pagamento}}',
    ]);
    const res = await upload(manager, file, 'Contrato da Empresa.docx', {
      name: 'Contrato padrão 2026',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'DOCX',
      fileName: 'Contrato da Empresa.docx',
      isDefault: false,
      version: 1,
      name: 'Contrato padrão 2026',
    });
    expect(res.body.body).toContain('CONTRATO DA EMPRESA');
    expect((await auditOf(t, a.id, 'contract_template.uploaded')).length).toBeGreaterThan(0);

    const url = (await get('/contract-template/file-url', manager)).body.url as string;
    const downloaded = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect(text(downloaded)).toContain('{{cliente.nome}}');
  });

  it('gera o contrato em Word preenchendo o modelo da empresa e mantendo a formatação', async () => {
    const deal = await acceptedDeal(flow, { name: 'Cliente do Modelo Word' });
    const res = await t.http
      .post(`${API}/opportunities/${deal.opportunityId}/contracts`)
      .set(bearer(manager))
      .send({ customerDocument: '529.982.247-25' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      fileKind: 'DOCX',
      templateIsDefault: false,
      templateVersion: 1,
    });
    expect(res.body.body).toContain('Cliente do Modelo Word');
    expect(res.body.body).toContain('529.982.247-25');
    expect(res.body.body).toContain('R$ 19.800,00');
    expect(res.body.body).not.toMatch(/\{\{/);
    expect(res.body.missingVariables).toEqual(expect.arrayContaining([]));

    const url = (await get(`/contracts/${res.body.id}/pdf-url`, manager)).body.url as string;
    const file = Buffer.from(await (await fetch(url)).arrayBuffer());
    const xml = text(file);
    expect(xml).toContain('Cliente do Modelo Word');
    expect(xml).toContain('<w:b/>'); // a formatação do modelo continua lá
    expect(xml).not.toContain('{{');
    // O texto do contrato fica cifrado no banco, como nos demais.
    expect(
      (await t.prisma.system.contract.findUniqueOrThrow({ where: { id: res.body.id } })).body,
    ).toMatch(/^enc:v2:/);
  });

  it('variável sem valor sai como "(não informado)" no arquivo e fica listada', async () => {
    const deal = await acceptedDeal(flow, { name: 'Cliente Sem Documento' });
    const res = await t.http
      .post(`${API}/opportunities/${deal.opportunityId}/contracts`)
      .set(bearer(manager))
      .send({});
    expect(res.body.missingVariables).toContain('cliente.documento');
    const url = (await get(`/contracts/${res.body.id}/pdf-url`, manager)).body.url as string;
    expect(text(Buffer.from(await (await fetch(url)).arrayBuffer()))).toContain('(não informado)');
  });

  it('um novo modelo em texto volta a gerar PDF', async () => {
    const body =
      'CONTRATO EM TEXTO\n\nCliente {{cliente.nome}} paga {{contrato.valor}} pelo projeto {{projeto.codigo}}.'.padEnd(
        90,
        '.',
      );
    const published = await t.http
      .put(`${API}/contract-template`)
      .set(bearer(manager))
      .send({ name: 'Texto', body });
    expect(published.body).toMatchObject({ kind: 'TEXT', fileName: null, version: 2 });
    const deal = await acceptedDeal(flow, { name: 'Cliente Voltou ao Texto' });
    const res = await t.http
      .post(`${API}/opportunities/${deal.opportunityId}/contracts`)
      .set(bearer(manager))
      .send({});
    expect(res.body.fileKind).toBe('PDF');
  });
});
