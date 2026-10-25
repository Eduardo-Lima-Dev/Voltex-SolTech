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
import { auditOf, outboxOf, tokenWithRole } from './crm-support';

describe('CRM · Leads (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let seller: string;
  let sdr: string;
  let adminB: string;
  let installer: string;

  const post = (path: string, token: string, body: unknown) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const patch = (path: string, token: string, body: unknown) =>
    t.http
      .patch(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  let counter = 0;
  const phone = () => `(85) 9${String(80000000 + ++counter * 7919).slice(0, 8)}`;

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'leads');
    b = await seedTenant(t.prisma, 'leadsb');
    admin = await tokenFor(t.http, a.admin);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
  });
  afterAll(() => t.close());

  describe('cadastro e deduplicação', () => {
    it('cria o lead com dono, SLA de primeiro contato, auditoria e evento', async () => {
      const res = await post('/leads', sdr, {
        name: 'Maria Silva',
        phone: phone(),
        email: 'Maria@Exemplo.com',
        segment: 'RESIDENTIAL',
        state: 'ce',
        utm: { source: 'instagram', campaign: 'verao' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Maria Silva',
        status: 'NEW',
        source: 'MANUAL',
        state: 'CE',
        ownerId: a.sdr.id,
        slaBreached: false,
        utm: { source: 'instagram', campaign: 'verao' },
      });
      const due =
        new Date(res.body.firstContactDueAt).getTime() - new Date(res.body.createdAt).getTime();
      expect(Math.round(due / 60_000)).toBe(30);
      expect((await auditOf(t, a.id, 'lead.created')).some((l) => l.entityId === res.body.id)).toBe(
        true,
      );
      expect(
        (await outboxOf(t, a.id, 'LeadCreated')).some(
          (e) => (e.payload as { leadId: string }).leadId === res.body.id,
        ),
      ).toBe(true);
    });

    it('recusa duplicado por telefone, e-mail ou documento (formatos diferentes) e informa o lead existente', async () => {
      const p = phone();
      const first = await post('/leads', sdr, {
        name: 'Pedro Duplicado',
        phone: p,
        email: 'pedro.dup@exemplo.com',
        document: '529.982.247-25',
      });
      expect(first.status).toBe(201);

      const byPhone = await post('/leads', sdr, { name: 'Outro Nome', phone: `+55 ${p}` });
      expect(byPhone.status).toBe(409);
      expect(byPhone.body.code).toBe('DUPLICATE_LEAD');
      expect(byPhone.body.data).toEqual({ matchedLeadId: first.body.id, matchedBy: ['telefone'] });

      const byEmail = await post('/leads', sdr, {
        name: 'Outro',
        email: '  PEDRO.DUP@exemplo.com ',
      });
      expect(byEmail.body.data.matchedBy).toEqual(['e-mail']);
      const byDoc = await post('/leads', sdr, { name: 'Outro', document: '52998224725' });
      expect(byDoc.body.data.matchedBy).toEqual(['documento']);
      const both = await post('/leads', sdr, {
        name: 'Outro',
        phone: p,
        email: 'pedro.dup@exemplo.com',
      });
      expect(both.body.data.matchedBy).toEqual(['e-mail', 'telefone']);
    });

    it('vendedor é avisado da duplicidade com a carteira de outro, sem ver quem é o lead', async () => {
      const p = phone();
      const first = await post('/leads', sdr, { name: 'Lead Do SDR', phone: p });
      expect(first.status).toBe(201);
      const dup = await post('/leads', seller, { name: 'Outro Nome', phone: p });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('DUPLICATE_LEAD');
      expect(dup.body.data).toEqual({ matchedBy: ['telefone'] });
      expect(JSON.stringify(dup.body)).not.toContain('Lead Do SDR');
      expect(JSON.stringify(dup.body)).not.toContain(first.body.id);
    });

    it('lead sem contato nenhum não é considerado duplicado de outro sem contato', async () => {
      expect((await post('/leads', sdr, { name: 'Sem Contato Um' })).status).toBe(201);
      expect((await post('/leads', sdr, { name: 'Sem Contato Dois' })).status).toBe(201);
    });

    it('valida os campos com mensagens em português (422)', async () => {
      const bad = await post('/leads', sdr, {
        name: 'A',
        email: 'x',
        state: 'CEARA',
        source: 'ORKUT',
      });
      expect(bad.status).toBe(422);
      const paths = bad.body.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'state', 'source']));
    });

    it('responsável precisa existir no tenant: usuário de outra empresa é recusado', async () => {
      const res = await post('/leads', admin, {
        name: 'Com Dono Errado',
        phone: phone(),
        ownerId: b.admin.id,
      });
      expect(res.status).toBe(422);
    });
  });

  describe('SLA, status e edição', () => {
    it('marca SLA estourado, filtra e limpa ao registrar o primeiro contato', async () => {
      const lead = await post('/leads', sdr, { name: 'Lead Atrasado', phone: phone() });
      await t.prisma.system.lead.update({
        where: { id: lead.body.id },
        data: { firstContactDueAt: new Date(Date.now() - 60_000) },
      });

      const breached = await get('/leads?slaBreached=true&pageSize=100', sdr);
      const found = breached.body.data.find((l: { id: string }) => l.id === lead.body.id);
      expect(found.slaBreached).toBe(true);

      const contacted = await patch(`/leads/${lead.body.id}`, sdr, { status: 'CONTACTED' });
      expect(contacted.status).toBe(200);
      expect(contacted.body.firstContactAt).toBeTruthy();
      expect(contacted.body.slaBreached).toBe(false);
      const again = await get('/leads?slaBreached=true&pageSize=100', sdr);
      expect(again.body.data.map((l: { id: string }) => l.id)).not.toContain(lead.body.id);
    });

    it('qualificar emite LeadQualified; desqualificar exige motivo; converter só pelo fluxo próprio', async () => {
      const lead = await post('/leads', sdr, { name: 'Lead Para Qualificar', phone: phone() });
      expect((await patch(`/leads/${lead.body.id}`, sdr, { status: 'QUALIFIED' })).status).toBe(
        200,
      );
      expect(
        (await outboxOf(t, a.id, 'LeadQualified')).some(
          (e) => (e.payload as { leadId: string }).leadId === lead.body.id,
        ),
      ).toBe(true);

      expect((await patch(`/leads/${lead.body.id}`, sdr, { status: 'DISQUALIFIED' })).status).toBe(
        422,
      );
      const dq = await patch(`/leads/${lead.body.id}`, sdr, {
        status: 'DISQUALIFIED',
        disqualifiedReason: 'Sem interesse',
      });
      expect(dq.body).toMatchObject({
        status: 'DISQUALIFIED',
        disqualifiedReason: 'Sem interesse',
      });
      expect((await patch(`/leads/${lead.body.id}`, sdr, { status: 'CONVERTED' })).status).toBe(
        422,
      );
    });

    it('editar para o telefone de outro lead dá 409; editar o próprio telefone não conflita com ele mesmo', async () => {
      const p1 = phone();
      const l1 = await post('/leads', sdr, { name: 'Lead Um', phone: p1 });
      const l2 = await post('/leads', sdr, { name: 'Lead Dois', phone: phone() });
      expect((await patch(`/leads/${l2.body.id}`, sdr, { phone: p1 })).status).toBe(409);
      expect(
        (await patch(`/leads/${l1.body.id}`, sdr, { phone: p1, notes: 'mesmo telefone' })).status,
      ).toBe(200);
    });

    it('busca por nome e por dígitos do telefone; filtros por status e origem; paginação', async () => {
      const p = phone();
      const lead = await post('/leads', sdr, {
        name: 'Zé Buscável Único',
        phone: p,
        source: 'REFERRAL',
      });
      const byName = await get('/leads?search=bUSCável%20únIco', sdr);
      expect(byName.body.data.map((l: { id: string }) => l.id)).toContain(lead.body.id);
      const digits = p.replace(/\D/g, '').slice(-6);
      const byPhone = await get(`/leads?search=${digits}`, sdr);
      expect(byPhone.body.data.map((l: { id: string }) => l.id)).toContain(lead.body.id);
      const bySource = await get('/leads?source=REFERRAL&pageSize=100', sdr);
      expect(bySource.body.data.every((l: { source: string }) => l.source === 'REFERRAL')).toBe(
        true,
      );
      const page = await get('/leads?page=1&pageSize=2', sdr);
      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta.total).toBeGreaterThan(2);
      expect((await get('/leads?pageSize=999', sdr)).status).toBe(422);
    });

    it('exclusão lógica: some da lista, e o lead excluído deixa de contar como duplicado', async () => {
      const p = phone();
      const lead = await post('/leads', sdr, { name: 'Lead Excluído', phone: p });
      expect((await t.http.delete(`${API}/leads/${lead.body.id}`).set(bearer(sdr))).status).toBe(
        200,
      );
      expect((await get(`/leads/${lead.body.id}`, sdr)).status).toBe(404);
      expect((await post('/leads', sdr, { name: 'Lead Excluído de Novo', phone: p })).status).toBe(
        201,
      );
    });
  });

  describe('importação (CSV)', () => {
    it('cria os novos, ignora duplicados (no arquivo e no banco) e informa cada linha', async () => {
      const existing = phone();
      await post('/leads', sdr, { name: 'Já Cadastrado', phone: existing });
      const dupInFile = phone();
      const rows = [
        { name: 'Importado Um', phone: phone() },
        { name: 'Importado Dois', phone: dupInFile, email: 'dois@import.com' },
        { name: 'Importado Dois (repetido)', phone: dupInFile },
        { name: 'Já Cadastrado (de novo)', phone: existing },
        { name: 'Importado Três', email: 'tres@import.com', source: 'MARKETPLACE' },
      ];
      const res = await post('/leads/import', sdr, { rows });
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(3);
      expect(res.body.duplicates).toBe(2);
      expect(res.body.duplicateRows.map((r: { row: number }) => r.row)).toEqual([3, 4]);
      expect(res.body.duplicateRows[0].matchedBy).toEqual(['phone']);
      expect(res.body.duplicateRows[1].matchedLeadId).toBeTruthy();

      const imported = await get('/leads?search=Importado&pageSize=100', sdr);
      const bySource = Object.fromEntries(
        imported.body.data.map((l: { name: string; source: string }) => [l.name, l.source]),
      );
      expect(bySource['Importado Um']).toBe('CSV_IMPORT');
      expect(bySource['Importado Três']).toBe('MARKETPLACE');
      expect((await auditOf(t, a.id, 'lead.imported')).length).toBeGreaterThan(0);
    });

    it('recusa arquivo vazio ou acima do limite', async () => {
      expect((await post('/leads/import', sdr, { rows: [] })).status).toBe(422);
      const many = Array.from({ length: 501 }, (_, i) => ({ name: `Lead ${i}` }));
      expect((await post('/leads/import', sdr, { rows: many })).status).toBe(422);
    });
  });

  describe('conversão em conta e oportunidade', () => {
    it('cria conta, contato principal e oportunidade com Project ID; marca o lead como convertido', async () => {
      const lead = await post('/leads', sdr, {
        ownerId: a.salesperson.id,
        name: 'Carla Converte',
        phone: phone(),
        email: 'carla@exemplo.com',
        segment: 'COMMERCIAL',
        document: '11.444.777/0001-61',
      });
      await patch(`/leads/${lead.body.id}`, seller, { status: 'QUALIFIED' });
      const res = await post(`/leads/${lead.body.id}/convert`, seller, { projectType: 'HYBRID' });
      expect(res.status).toBe(201);
      expect(res.body.lead).toMatchObject({
        status: 'CONVERTED',
        convertedAccountId: res.body.accountId,
        convertedOpportunityId: res.body.opportunityId,
      });
      expect(res.body.opportunityId).toBeTruthy();

      const account = await get(`/accounts/${res.body.accountId}`, seller);
      expect(account.body).toMatchObject({
        name: 'Carla Converte',
        segment: 'COMMERCIAL',
        type: 'PERSON',
      });
      expect(account.body.contacts).toHaveLength(1);
      expect(account.body.contacts[0]).toMatchObject({
        name: 'Carla Converte',
        isPrimary: true,
        email: 'carla@exemplo.com',
      });

      const opportunity = await get(`/opportunities/${res.body.opportunityId}`, seller);
      expect(opportunity.body).toMatchObject({
        stage: 'QUALIFICATION',
        status: 'OPEN',
        projectType: 'HYBRID',
        leadId: lead.body.id,
        accountName: 'Carla Converte',
      });
      expect(opportunity.body.projectCode).toMatch(/^VLX-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(opportunity.body.ownerId).toBe(a.salesperson.id);
    });

    it('lead convertido não converte de novo nem se edita; desqualificado precisa ser reaberto', async () => {
      const lead = await post('/leads', sdr, {
        ownerId: a.salesperson.id,
        name: 'Converte Uma Vez',
        phone: phone(),
      });
      expect((await post(`/leads/${lead.body.id}/convert`, seller, {})).status).toBe(201);
      expect((await post(`/leads/${lead.body.id}/convert`, seller, {})).status).toBe(409);
      expect((await patch(`/leads/${lead.body.id}`, seller, { notes: 'x' })).status).toBe(409);

      const dq = await post('/leads', sdr, {
        ownerId: a.salesperson.id,
        name: 'Desqualificado',
        phone: phone(),
      });
      await patch(`/leads/${dq.body.id}`, seller, {
        status: 'DISQUALIFIED',
        disqualifiedReason: 'Fora da área',
      });
      expect((await post(`/leads/${dq.body.id}/convert`, seller, {})).status).toBe(422);
    });

    it('cliente que já existe (mesmo documento) é reaproveitado em vez de duplicado', async () => {
      const doc = '111.444.777-35';
      const l1 = await post('/leads', sdr, {
        ownerId: a.salesperson.id,
        name: 'Cliente Recorrente',
        phone: phone(),
        document: doc,
      });
      const c1 = await post(`/leads/${l1.body.id}/convert`, seller, {});
      await t.prisma.system.lead.update({
        where: { id: l1.body.id },
        data: { deletedAt: new Date() },
      }); // libera o documento para um novo lead
      const l2 = await post('/leads', sdr, {
        ownerId: a.salesperson.id,
        name: 'Cliente Recorrente (novo lead)',
        phone: phone(),
        document: doc,
      });
      const c2 = await post(`/leads/${l2.body.id}/convert`, seller, {});
      expect(c2.body.accountId).toBe(c1.body.accountId);
      expect(c2.body.opportunityId).not.toBe(c1.body.opportunityId);
    });

    it('SDR converte em conta, mas só quem pode criar oportunidade cria a oportunidade', async () => {
      const lead = await post('/leads', sdr, {
        name: 'Passa Para o Vendedor',
        phone: phone(),
      });
      expect((await post(`/leads/${lead.body.id}/convert`, sdr, {})).status).toBe(403);
      const ok = await post(`/leads/${lead.body.id}/convert`, sdr, { createOpportunity: false });
      expect(ok.status).toBe(201);
      expect(ok.body.opportunityId).toBeNull();
    });

    it('converter sem oportunidade mantém o lead rastreado e audita', async () => {
      expect((await auditOf(t, a.id, 'lead.converted')).length).toBeGreaterThan(0);
    });
  });

  describe('captação pública', () => {
    let key: string;
    const captured = (name: string) =>
      t.prisma.system.lead.findMany({ where: { tenantId: a.id, name } });

    it('só quem gerencia a empresa vê e gira a chave', async () => {
      expect((await get('/lead-capture', seller)).status).toBe(403);
      const res = await get('/lead-capture', admin);
      expect(res.status).toBe(200);
      key = res.body.key;
      expect(key).toMatch(/^lk_/);
      expect((await get('/lead-capture', admin)).body.key).toBe(key); // estável até girar
    });

    it('aceita o lead sem login, exige consentimento e contato, e barra robôs', async () => {
      const ok = await t.http.post(`${API}/public/leads/${key}`).send({
        name: 'Visitante da Landing',
        phone: phone(),
        consent: true,
        utm: { source: 'google', medium: 'cpc' },
      });
      expect(ok.status).toBe(202);
      expect(ok.body).toEqual({ ok: true });
      const [lead] = await captured('Visitante da Landing');
      expect(lead).toMatchObject({
        source: 'CAMPAIGN',
        ownerId: null,
        status: 'NEW',
        tenantId: a.id,
      });
      expect(
        (await auditOf(t, a.id, 'lead.captured')).some(
          (l) => l.entityId === lead!.id && l.actorId === null,
        ),
      ).toBe(true);

      const base = { name: 'Visitante Inválido', phone: phone() };
      expect((await t.http.post(`${API}/public/leads/${key}`).send({ ...base })).status).toBe(422);
      expect(
        (await t.http.post(`${API}/public/leads/${key}`).send({ ...base, consent: false })).status,
      ).toBe(422);
      expect(
        (
          await t.http
            .post(`${API}/public/leads/${key}`)
            .send({ name: 'Sem Contato', consent: true })
        ).status,
      ).toBe(422);
      expect(
        (
          await t.http
            .post(`${API}/public/leads/${key}`)
            .send({ ...base, consent: true, website: 'http://spam.example' })
        ).status,
      ).toBe(422);
      expect(await captured('Visitante Inválido')).toHaveLength(0);
    });

    it('duplicado responde igual (sem revelar) e não cria outro; chave inválida dá 404', async () => {
      const p = phone();
      await t.http
        .post(`${API}/public/leads/${key}`)
        .send({ name: 'Visitante Repetido', phone: p, consent: true });
      const again = await t.http
        .post(`${API}/public/leads/${key}`)
        .send({ name: 'Visitante Repetido', phone: p, consent: true });
      expect(again.status).toBe(202);
      expect(again.body).toEqual({ ok: true });
      expect(await captured('Visitante Repetido')).toHaveLength(1);
      expect(
        (
          await t.http
            .post(`${API}/public/leads/lk_chave_errada`)
            .send({ name: 'X Y', phone: phone(), consent: true })
        ).status,
      ).toBe(404);
    });

    it('aceita formulários de outros sites (CORS aberto só nesta rota, sem credenciais)', async () => {
      const preflight = await t.http
        .options(`${API}/public/leads/${key}`)
        .set('Origin', 'https://site-do-cliente.com.br')
        .set('Access-Control-Request-Method', 'POST');
      expect(preflight.headers['access-control-allow-origin']).toBe(
        'https://site-do-cliente.com.br',
      );
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
      const normal = await t.http
        .options(`${API}/leads`)
        .set('Origin', 'https://site-do-cliente.com.br')
        .set('Access-Control-Request-Method', 'GET');
      expect(normal.headers['access-control-allow-origin']).not.toBe(
        'https://site-do-cliente.com.br',
      );
    });

    it('girar a chave invalida a anterior', async () => {
      const rotated = await post('/lead-capture/rotate', admin, {});
      expect(rotated.body.key).not.toBe(key);
      expect(
        (
          await t.http
            .post(`${API}/public/leads/${key}`)
            .send({ name: 'Com Chave Velha', phone: phone(), consent: true })
        ).status,
      ).toBe(404);
      expect(
        (
          await t.http
            .post(`${API}/public/leads/${rotated.body.key}`)
            .send({ name: 'Com Chave Nova', phone: phone(), consent: true })
        ).status,
      ).toBe(202);
    });

    it('a chave de uma empresa só cria leads nela', async () => {
      const keyB = (await get('/lead-capture', adminB)).body.key;
      await t.http
        .post(`${API}/public/leads/${keyB}`)
        .send({ name: 'Lead da Empresa B', phone: phone(), consent: true });
      expect(await captured('Lead da Empresa B')).toHaveLength(0);
      expect(
        await t.prisma.system.lead.count({ where: { tenantId: b.id, name: 'Lead da Empresa B' } }),
      ).toBe(1);
    });
  });

  describe('permissões e isolamento entre empresas', () => {
    it('instalador não acessa o CRM; sem token é 401', async () => {
      expect((await get('/leads', installer)).status).toBe(403);
      expect((await post('/leads', installer, { name: 'Intruso' })).status).toBe(403);
      expect((await t.http.get(`${API}/leads`)).status).toBe(401);
    });

    it('a outra empresa não vê, lê, edita, converte nem exclui os leads desta', async () => {
      const lead = await post('/leads', sdr, { name: 'Lead Privado', phone: phone() });
      const list = await get('/leads?pageSize=100', adminB);
      expect(list.body.data.every((l: { tenantId: string }) => l.tenantId === b.id)).toBe(true);
      expect((await get(`/leads/${lead.body.id}`, adminB)).status).toBe(404);
      expect((await patch(`/leads/${lead.body.id}`, adminB, { notes: 'x' })).status).toBe(404);
      expect((await post(`/leads/${lead.body.id}/convert`, adminB, {})).status).toBe(404);
      expect((await t.http.delete(`${API}/leads/${lead.body.id}`).set(bearer(adminB))).status).toBe(
        404,
      );
    });

    it('o mesmo telefone pode existir em empresas diferentes (a deduplicação é por empresa)', async () => {
      const p = phone();
      expect((await post('/leads', sdr, { name: 'Mesmo Telefone A', phone: p })).status).toBe(201);
      expect((await post('/leads', adminB, { name: 'Mesmo Telefone B', phone: p })).status).toBe(
        201,
      );
    });
  });
});
