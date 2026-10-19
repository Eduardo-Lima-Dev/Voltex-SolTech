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

describe('CRM · Contas, imóveis e unidades consumidoras (e2e)', () => {
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
  const del = (path: string, token: string) => t.http.delete(`${API}${path}`).set(bearer(token));

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'acct');
    b = await seedTenant(t.prisma, 'acctb');
    admin = await tokenFor(t.http, a.admin);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
  });
  afterAll(() => t.close());

  const account = async (name = 'Conta Teste', extra: Record<string, unknown> = {}) =>
    (await post('/accounts', seller, { name, ...extra })).body;

  describe('contas', () => {
    it('cria, edita, busca por nome/documento e pagina', async () => {
      const created = await post('/accounts', seller, {
        name: 'Indústria Alfa Ltda',
        type: 'COMPANY',
        document: '11.444.777/0001-61',
        segment: 'INDUSTRIAL',
        email: 'Contato@Alfa.com',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        type: 'COMPANY',
        segment: 'INDUSTRIAL',
        email: 'contato@alfa.com',
      });
      expect(
        (await auditOf(t, a.id, 'account.created')).some((l) => l.entityId === created.body.id),
      ).toBe(true);

      expect(
        (await patch(`/accounts/${created.body.id}`, seller, { notes: 'Cliente estratégico' })).body
          .notes,
      ).toBe('Cliente estratégico');
      const byName = await get('/accounts?search=alfa', seller);
      expect(byName.body.data.map((x: { id: string }) => x.id)).toContain(created.body.id);
      const byDoc = await get('/accounts?search=444777', seller);
      expect(byDoc.body.data.map((x: { id: string }) => x.id)).toContain(created.body.id);
      expect((await get('/accounts?page=1&pageSize=1', seller)).body.data).toHaveLength(1);
    });

    it('recusa documento repetido e informa a conta existente', async () => {
      const first = await account('Titular do Documento', { document: '111.444.777-35' });
      const dup = await post('/accounts', seller, { name: 'Outra Conta', document: '11144477735' });
      expect(dup.status).toBe(409);
      expect(dup.body).toMatchObject({
        code: 'DUPLICATE_ACCOUNT',
        data: { matchedAccountId: first.id },
      });
      const other = await account('Conta Sem Documento');
      expect(
        (await patch(`/accounts/${other.id}`, seller, { document: '111.444.777-35' })).status,
      ).toBe(409);
      expect(
        (
          await patch(`/accounts/${first.id}`, seller, {
            document: '111.444.777-35',
            notes: 'mesmo documento',
          })
        ).status,
      ).toBe(200);
    });

    it('não exclui conta com oportunidade aberta; exclui depois de encerrar', async () => {
      const acc = await account('Conta Com Negócio');
      const opp = await post('/opportunities', seller, { accountId: acc.id });
      expect((await del(`/accounts/${acc.id}`, seller)).status).toBe(409);
      await post(`/opportunities/${opp.body.id}/stage`, seller, {
        stage: 'LOST',
        lostReason: 'Desistiu',
      });
      expect((await del(`/accounts/${acc.id}`, seller)).status).toBe(200);
      expect((await get(`/accounts/${acc.id}`, seller)).status).toBe(404);
    });
  });

  describe('edição parcial preserva os dados existentes', () => {
    it('renomear não apaga tipo da conta, contato principal, intake do imóvel nem grupo da UC', async () => {
      const acc = (await post('/accounts', seller, { name: 'Conta Preservada', type: 'COMPANY' }))
        .body;
      const contact = (
        await post(`/accounts/${acc.id}/contacts`, seller, {
          name: 'Contato Principal',
          isPrimary: true,
        })
      ).body;
      const site = (
        await post(`/accounts/${acc.id}/sites`, seller, {
          name: 'Imóvel',
          city: 'Fortaleza',
          state: 'CE',
          intake: { shading: 'RELEVANT', tiltDegrees: 12 },
        })
      ).body;
      const unit = (
        await post(`/accounts/${acc.id}/consumer-units`, seller, {
          number: '31313131',
          customerGroup: 'A',
          phaseSystem: 'THREE_PHASE',
        })
      ).body;

      expect(
        (await patch(`/accounts/${acc.id}`, seller, { name: 'Conta Renomeada' })).body.type,
      ).toBe('COMPANY');
      expect(
        (await patch(`/contacts/${contact.id}`, seller, { name: 'Contato Renomeado' })).body
          .isPrimary,
      ).toBe(true);
      expect(
        (await patch(`/sites/${site.id}`, seller, { name: 'Imóvel Renomeado' })).body.intake,
      ).toEqual({ shading: 'RELEVANT', tiltDegrees: 12 });
      const updatedUnit = (
        await patch(`/consumer-units/${unit.id}`, seller, { consumerClass: 'Industrial' })
      ).body;
      expect(updatedUnit).toMatchObject({
        customerGroup: 'A',
        phaseSystem: 'THREE_PHASE',
        consumerClass: 'Industrial',
      });
    });
  });

  describe('contatos', () => {
    it('só um contato principal por conta: o novo principal substitui o anterior', async () => {
      const acc = await account('Conta de Contatos');
      const c1 = await post(`/accounts/${acc.id}/contacts`, seller, {
        name: 'Primeiro Contato',
        phone: '(85) 98888-1111',
        isPrimary: true,
      });
      const c2 = await post(`/accounts/${acc.id}/contacts`, seller, {
        name: 'Segundo Contato',
        roleTitle: 'Financeiro',
        isPrimary: true,
      });
      expect(c1.status).toBe(201);
      expect(c2.body).toMatchObject({ isPrimary: true, roleTitle: 'Financeiro' });

      let detail = await get(`/accounts/${acc.id}`, seller);
      expect(
        detail.body.contacts.map((c: { name: string; isPrimary: boolean }) => [
          c.name,
          c.isPrimary,
        ]),
      ).toEqual([
        ['Segundo Contato', true],
        ['Primeiro Contato', false],
      ]);
      await patch(`/contacts/${c1.body.id}`, seller, { isPrimary: true });
      detail = await get(`/accounts/${acc.id}`, seller);
      expect(detail.body.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary)).toHaveLength(
        1,
      );
      expect(detail.body.contacts[0].name).toBe('Primeiro Contato');

      expect((await del(`/contacts/${c2.body.id}`, seller)).status).toBe(200);
      expect((await get(`/accounts/${acc.id}`, seller)).body.contacts).toHaveLength(1);
      expect((await patch(`/contacts/${c2.body.id}`, seller, { name: 'Já excluído' })).status).toBe(
        404,
      );
    });
  });

  describe('imóveis e intake técnico', () => {
    const site = {
      name: 'Residência',
      city: 'Fortaleza',
      state: 'ce',
      latitude: -3.73,
      longitude: -38.52,
    };

    it('guarda o intake técnico (orientação, inclinação, sombreamento, padrão de entrada)', async () => {
      const acc = await account('Conta com Imóvel');
      const created = await post(`/accounts/${acc.id}/sites`, seller, {
        ...site,
        intake: {
          roofType: 'CERAMIC',
          roofAzimuthDegrees: 0,
          tiltDegrees: 15,
          shading: 'LOW',
          availableAreaM2: 40,
          entryBreakerAmps: 63,
          groundingAdequate: true,
          technicalVisitRequired: false,
        },
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        state: 'CE',
        latitude: -3.73,
        intake: {
          roofType: 'CERAMIC',
          shading: 'LOW',
          entryBreakerAmps: 63,
          groundingAdequate: true,
        },
      });
      expect((await get(`/accounts/${acc.id}`, seller)).body.sites).toHaveLength(1);
    });

    it('valida o intake: azimute, inclinação, sombreamento e coordenadas fora da faixa (422)', async () => {
      const acc = await account('Conta Intake Inválido');
      for (const intake of [
        { roofAzimuthDegrees: 360 },
        { tiltDegrees: 120 },
        { shading: 'MUITO' },
        { availableAreaM2: -5 },
      ]) {
        expect((await post(`/accounts/${acc.id}/sites`, seller, { ...site, intake })).status).toBe(
          422,
        );
      }
      expect(
        (await post(`/accounts/${acc.id}/sites`, seller, { ...site, latitude: 120 })).status,
      ).toBe(422);
    });

    it('alterar o intake ou a localização avisa as oportunidades abertas do imóvel (premissas mudaram)', async () => {
      const acc = await account('Conta Premissas');
      const s = (
        await post(`/accounts/${acc.id}/sites`, seller, { ...site, intake: { shading: 'NONE' } })
      ).body;
      const opp = (await post('/opportunities', seller, { accountId: acc.id, siteId: s.id })).body;
      const before = (await outboxOf(t, a.id, 'OpportunityPremisesChanged')).length;

      await patch(`/sites/${s.id}`, seller, { name: 'Só o nome mudou' });
      expect((await outboxOf(t, a.id, 'OpportunityPremisesChanged')).length).toBe(before);

      await patch(`/sites/${s.id}`, seller, { intake: { shading: 'RELEVANT' } });
      const events = await outboxOf(t, a.id, 'OpportunityPremisesChanged');
      expect(events.length).toBe(before + 1);
      expect(events.at(-1)).toMatchObject({ projectCode: opp.projectCode });
      expect(events.at(-1)!.payload).toMatchObject({
        opportunityId: opp.id,
        reason: 'site_intake_changed',
      });
    });

    it('não exclui imóvel usado por oportunidade aberta', async () => {
      const acc = await account('Conta Imóvel Usado');
      const s = (await post(`/accounts/${acc.id}/sites`, seller, site)).body;
      await post('/opportunities', seller, { accountId: acc.id, siteId: s.id });
      expect((await del(`/sites/${s.id}`, seller)).status).toBe(409);
      const free = (await post(`/accounts/${acc.id}/sites`, seller, { ...site, name: 'Livre' }))
        .body;
      expect((await del(`/sites/${free.id}`, seller)).status).toBe(200);
    });
  });

  describe('unidades consumidoras', () => {
    it('registra UC com concessionária, grupo, ligação e classe; confere vínculos', async () => {
      const acc = await account('Conta com UC');
      const dist = (
        await post('/distributors', admin, { name: 'Distribuidora da UC', state: 'CE' })
      ).body;
      const site = (
        await post(`/accounts/${acc.id}/sites`, seller, {
          name: 'Casa',
          city: 'Fortaleza',
          state: 'CE',
        })
      ).body;

      const unit = await post(`/accounts/${acc.id}/consumer-units`, seller, {
        number: '12345678',
        distributorId: dist.id,
        siteId: site.id,
        customerGroup: 'B',
        phaseSystem: 'THREE_PHASE',
        consumerClass: 'Residencial',
      });
      expect(unit.status).toBe(201);
      expect(unit.body).toMatchObject({
        number: '12345678',
        distributorName: 'Distribuidora da UC',
        customerGroup: 'B',
        phaseSystem: 'THREE_PHASE',
        siteId: site.id,
      });

      expect(
        (
          await post(`/accounts/${acc.id}/consumer-units`, seller, {
            number: '999888',
            distributorId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(422);
      const otherAcc = await account('Outra Conta');
      const otherSite = (
        await post(`/accounts/${otherAcc.id}/sites`, seller, {
          name: 'Casa 2',
          city: 'Fortaleza',
          state: 'CE',
        })
      ).body;
      expect(
        (
          await post(`/accounts/${acc.id}/consumer-units`, seller, {
            number: '777666',
            siteId: otherSite.id,
          })
        ).status,
      ).toBe(422);
      expect(
        (await post(`/accounts/${acc.id}/consumer-units`, seller, { number: '1' })).status,
      ).toBe(422);
      expect((await get(`/accounts/${acc.id}`, seller)).body.consumerUnits).toHaveLength(1);
    });

    it('mudar grupo ou ligação da UC avisa as oportunidades abertas; não exclui UC em uso', async () => {
      const acc = await account('Conta UC Premissas');
      const unit = (
        await post(`/accounts/${acc.id}/consumer-units`, seller, {
          number: '55443322',
          customerGroup: 'B',
        })
      ).body;
      const opp = (
        await post('/opportunities', seller, { accountId: acc.id, consumerUnitId: unit.id })
      ).body;
      const before = (await outboxOf(t, a.id, 'OpportunityPremisesChanged')).length;
      await patch(`/consumer-units/${unit.id}`, seller, { consumerClass: 'Comercial' });
      expect((await outboxOf(t, a.id, 'OpportunityPremisesChanged')).length).toBe(before);
      await patch(`/consumer-units/${unit.id}`, seller, { customerGroup: 'A' });
      const events = await outboxOf(t, a.id, 'OpportunityPremisesChanged');
      expect(events.at(-1)!.payload).toMatchObject({
        opportunityId: opp.id,
        reason: 'consumer_unit_changed',
      });
      expect((await del(`/consumer-units/${unit.id}`, seller)).status).toBe(409);
    });
  });

  describe('permissões e isolamento', () => {
    it('SDR escreve contas; instalador não acessa; sem token é 401', async () => {
      expect((await post('/accounts', sdr, { name: 'Conta do SDR' })).status).toBe(201);
      expect((await get('/accounts', installer)).status).toBe(403);
      expect((await t.http.get(`${API}/accounts`)).status).toBe(401);
    });

    it('outra empresa não vê nem altera contas, contatos, imóveis e UCs desta', async () => {
      const acc = await account('Conta Privada');
      const contact = (
        await post(`/accounts/${acc.id}/contacts`, seller, { name: 'Contato Privado' })
      ).body;
      const site = (
        await post(`/accounts/${acc.id}/sites`, seller, {
          name: 'Imóvel',
          city: 'Recife',
          state: 'PE',
        })
      ).body;
      const unit = (await post(`/accounts/${acc.id}/consumer-units`, seller, { number: '4040404' }))
        .body;

      expect(
        (await get('/accounts?pageSize=100', adminB)).body.data.every(
          (x: { tenantId: string }) => x.tenantId === b.id,
        ),
      ).toBe(true);
      expect((await get(`/accounts/${acc.id}`, adminB)).status).toBe(404);
      expect((await patch(`/accounts/${acc.id}`, adminB, { notes: 'x' })).status).toBe(404);
      expect((await post(`/accounts/${acc.id}/contacts`, adminB, { name: 'Invasor' })).status).toBe(
        404,
      );
      expect((await patch(`/contacts/${contact.id}`, adminB, { name: 'Nome novo' })).status).toBe(
        404,
      );
      expect((await patch(`/sites/${site.id}`, adminB, { name: 'Nome novo' })).status).toBe(404);
      expect((await patch(`/consumer-units/${unit.id}`, adminB, { number: '999' })).status).toBe(
        404,
      );
      expect((await post('/opportunities', adminB, { accountId: acc.id })).status).toBe(422);
    });
  });
});
