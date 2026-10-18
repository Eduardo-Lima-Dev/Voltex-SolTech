import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  pdfBuffer,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';

const pdf = { filename: 'fatura.pdf', contentType: 'application/pdf' };

describe('documentos (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'docs');
    token = await tokenFor(t.http, tenant.salesperson);
  });
  afterAll(() => t.close());

  const upload = (
    buffer: Buffer = pdfBuffer(),
    file = pdf,
    fields: Record<string, string> = {},
    auth = token,
  ) => {
    let req = t.http.post(`${API}/documents`).set(bearer(auth));
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return req.attach('file', buffer, file);
  };

  it('envia um PDF, calcula o checksum e vincula a uma entidade', async () => {
    const content = pdfBuffer('conteudo-da-fatura');
    const res = await upload(content, pdf, { entityType: 'Opportunity', entityId: 'opp-123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenantId: tenant.id,
      filename: 'fatura.pdf',
      mimeType: 'application/pdf',
      sizeBytes: content.length,
      version: 1,
      entityType: 'Opportunity',
      entityId: 'opp-123',
      uploadedById: tenant.salesperson.id,
    });
    expect(res.body.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body).not.toHaveProperty('storageKey');
  });

  it('o link de download entrega exatamente o arquivo enviado e expira', async () => {
    const content = pdfBuffer('bytes-exatos-123');
    const doc = await upload(content);
    const res = await t.http.get(`${API}/documents/${doc.body.id}/download-url`).set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(300);

    const downloaded = await fetch(res.body.url);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-disposition')).toContain('fatura.pdf');
    expect(Buffer.from(await downloaded.arrayBuffer()).equals(content)).toBe(true);
  });

  it('lista com filtro por entidade e pagina', async () => {
    await upload(pdfBuffer('a'), pdf, { entityType: 'Lead', entityId: 'lead-9' });
    await upload(pdfBuffer('b'), pdf, { entityType: 'Lead', entityId: 'lead-9' });
    const res = await t.http
      .get(`${API}/documents?entityType=Lead&entityId=lead-9&pageSize=1`)
      .set(bearer(token));
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(res.body.data).toHaveLength(1);
  });

  it('nova versão mantém o grupo, sobe o número e herda o vínculo', async () => {
    const v1 = await upload(pdfBuffer('v1'), pdf, { entityType: 'Project', entityId: 'p-1' });
    const v2 = await upload(
      pdfBuffer('v2'),
      { filename: 'fatura-v2.pdf', contentType: 'application/pdf' },
      { replacesDocumentId: v1.body.id },
    );
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({
      version: 2,
      groupId: v1.body.groupId,
      entityType: 'Project',
      entityId: 'p-1',
    });

    const versions = await t.http.get(`${API}/documents/${v1.body.id}/versions`).set(bearer(token));
    expect(versions.body.map((d: { version: number }) => d.version)).toEqual([2, 1]);
  });

  it('exclui logicamente e passa a responder 404', async () => {
    const doc = await upload();
    expect((await t.http.delete(`${API}/documents/${doc.body.id}`).set(bearer(token))).status).toBe(
      200,
    );
    expect((await t.http.get(`${API}/documents/${doc.body.id}`).set(bearer(token))).status).toBe(
      404,
    );
    expect(
      (await t.http.get(`${API}/documents/${doc.body.id}/download-url`).set(bearer(token))).status,
    ).toBe(404);
    expect(await t.prisma.system.document.findUnique({ where: { id: doc.body.id } })).toMatchObject(
      { deletedAt: expect.any(Date) },
    );
  });

  describe('validação', () => {
    it('415 para tipo não permitido e para conteúdo que não bate com o tipo', async () => {
      const exe = await upload(Buffer.from('MZ\u0090\u0000'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      });
      expect(exe.status).toBe(415);
      const fake = await upload(Buffer.from('<html>nao sou pdf</html>'), {
        filename: 'fatura.pdf',
        contentType: 'application/pdf',
      });
      expect(fake.status).toBe(415);
    });

    it('400 sem arquivo, com arquivo vazio e com vínculo incompleto', async () => {
      const none = await t.http
        .post(`${API}/documents`)
        .set(bearer(token))
        .field('entityType', 'Lead');
      expect(none.status).toBe(400);
      expect((await upload(Buffer.alloc(0), pdf)).status).toBe(400);
      expect((await upload(pdfBuffer(), pdf, { entityType: 'Lead' })).status).toBe(400);
    });

    it('sanitiza o nome do arquivo (sem path traversal)', async () => {
      const res = await upload(pdfBuffer(), {
        filename: '../../etc/passwd.pdf',
        contentType: 'application/pdf',
      });
      expect(res.status).toBe(201);
      expect(res.body.filename).toBe('passwd.pdf');
      const row = await t.prisma.system.document.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.storageKey).not.toContain('..');
      expect(row.storageKey.startsWith(`${tenant.id}/`)).toBe(true);
    });

    it('UUID inválido em :id dá 400', async () => {
      expect((await t.http.get(`${API}/documents/abc`).set(bearer(token))).status).toBe(400);
    });
  });

  describe('permissões', () => {
    it('perfil somente-leitura lista mas não envia nem exclui', async () => {
      const partner = await t.prisma.system.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Parceiro',
          email: `parceiro.${tenant.id.slice(0, 6)}@docs.test`,
          passwordHash: (
            await t.prisma.system.user.findUniqueOrThrow({ where: { id: tenant.owner.id } })
          ).passwordHash,
          role: 'PARTNER',
        },
      });
      const partnerToken = await tokenFor(t.http, {
        id: partner.id,
        email: partner.email,
        role: 'PARTNER',
      });
      expect((await t.http.get(`${API}/documents`).set(bearer(partnerToken))).status).toBe(200);
      expect((await upload(pdfBuffer(), pdf, {}, partnerToken)).status).toBe(403);
      const doc = await upload();
      expect(
        (await t.http.delete(`${API}/documents/${doc.body.id}`).set(bearer(partnerToken))).status,
      ).toBe(403);
    });

    it('exige autenticação', async () => {
      expect((await t.http.get(`${API}/documents`)).status).toBe(401);
      expect((await t.http.post(`${API}/documents`).attach('file', pdfBuffer(), pdf)).status).toBe(
        401,
      );
    });
  });

  describe('integração com eventos e auditoria', () => {
    it('grava auditoria e evento DocumentUploaded no outbox, na mesma transação do registro', async () => {
      const doc = await upload();
      const audit = await t.prisma.system.auditLog.findFirst({
        where: { tenantId: tenant.id, action: 'document.uploaded', entityId: doc.body.id },
      });
      expect(audit).toMatchObject({ actorId: tenant.salesperson.id, entity: 'Document' });
      const event = await t.prisma.system.outboxEvent.findFirst({
        where: { tenantId: tenant.id, type: 'DocumentUploaded' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event?.payload).toMatchObject({ documentId: doc.body.id, version: 1 });
    });
  });
});

describe('limite de tamanho do upload (e2e)', () => {
  it('413 quando o arquivo passa de UPLOAD_MAX_BYTES', async () => {
    const t = await createTestApp({ UPLOAD_MAX_BYTES: '2048' });
    try {
      const tenant = await seedTenant(t.prisma, 'limite');
      const token = await tokenFor(t.http, tenant.owner);
      const big = await t.http
        .post(`${API}/documents`)
        .set(bearer(token))
        .attach('file', pdfBuffer('x'.repeat(4096)), pdf);
      expect(big.status).toBe(413);
      expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
      const small = await t.http
        .post(`${API}/documents`)
        .set(bearer(token))
        .attach('file', pdfBuffer(), pdf);
      expect(small.status).toBe(201);
    } finally {
      await t.close();
    }
  });
});
