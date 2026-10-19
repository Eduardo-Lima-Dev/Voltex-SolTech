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

const source = [{ type: 'INTERNAL_POLICY', reference: 'Política interna de teste' }];

describe('Rules Engine e dados de referência (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;
  let admin: string;
  let seller: string;
  let sdr: string;

  const post = (path: string, token: string, body: unknown) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'rules');
    admin = await tokenFor(t.http, tenant.admin);
    seller = await tokenFor(t.http, tenant.salesperson);
    sdr = await tokenFor(t.http, tenant.sdr);
  });
  afterAll(() => t.close());

  describe('regras versionadas', () => {
    it('cria rascunhos com versão crescente e exige ao menos uma fonte', async () => {
      const v1 = await post('/rules', admin, {
        definition: {
          thresholds: { hspMax: 7 },
          availabilityCostKwh: { SINGLE_PHASE: 30, THREE_PHASE: 100 },
        },
        sources: source,
      });
      expect(v1.status).toBe(201);
      expect(v1.body).toMatchObject({
        version: 1,
        status: 'DRAFT',
        key: 'calculator.rules',
        createdById: tenant.admin.id,
      });
      const v2 = await post('/rules', admin, { definition: {}, sources: source });
      expect(v2.body.version).toBe(2);

      expect((await post('/rules', admin, { definition: {}, sources: [] })).status).toBe(422);
      expect(
        (
          await post('/rules', admin, {
            definition: { thresholds: { hspMax: 'alto' } },
            sources: source,
          })
        ).status,
      ).toBe(422);
      expect(
        (await post('/rules', admin, { key: 'outra.chave', definition: {}, sources: source }))
          .status,
      ).toBe(422);
    });

    it('ativar exige o responsável pela revisão e aposenta a versão ativa anterior', async () => {
      const first = await post('/rules', admin, {
        definition: { availabilityCostKwh: { SINGLE_PHASE: 30 } },
        sources: source,
      });
      expect((await post(`/rules/${first.body.id}/activate`, admin, {})).status).toBe(422);
      expect(
        (await post(`/rules/${first.body.id}/activate`, admin, { reviewedBy: 'x' })).status,
      ).toBe(422);

      const activated = await post(`/rules/${first.body.id}/activate`, admin, {
        reviewedBy: 'Eng. Maria Souza (CREA 123)',
      });
      expect(activated.status).toBe(200);
      expect(activated.body).toMatchObject({
        status: 'ACTIVE',
        reviewedBy: 'Eng. Maria Souza (CREA 123)',
      });
      expect(activated.body.reviewedAt).toBeTruthy();
      expect(activated.body.validFrom).toBeTruthy();

      const second = await post('/rules', admin, {
        definition: { availabilityCostKwh: { SINGLE_PHASE: 50 } },
        sources: source,
      });
      await post(`/rules/${second.body.id}/activate`, admin, {
        reviewedBy: 'Eng. Maria Souza (CREA 123)',
      });

      const list = await t.http.get(`${API}/rules`).set(bearer(admin));
      const byId = new Map(
        list.body.map((r: { id: string; status: string; validTo: string | null }) => [r.id, r]),
      );
      expect((byId.get(first.body.id) as { status: string; validTo: string | null }).status).toBe(
        'RETIRED',
      );
      expect((byId.get(first.body.id) as { validTo: string | null }).validTo).toBeTruthy();
      expect((byId.get(second.body.id) as { status: string }).status).toBe('ACTIVE');
      expect(list.body.filter((r: { status: string }) => r.status === 'ACTIVE')).toHaveLength(1);

      const effective = await t.http.get(`${API}/rules/effective`).set(bearer(admin));
      expect(effective.body.ref).toBe(`${second.body.id}@${second.body.version}`);
      expect(effective.body.availabilityCostKwh).toEqual({ SINGLE_PHASE: 50 });

      // o calculador (qualquer perfil) enxerga a regra em vigor
      const config = await t.http.get(`${API}/calculations/quick/config`).set(bearer(seller));
      expect(config.body.ruleSetRef).toBe(effective.body.ref);
      expect(config.body.availabilityCostKwh.SINGLE_PHASE).toBe(50);
      expect(config.body.thresholds.microgenerationMaxKw).toBe(75); // não definido na regra: padrão do produto

      expect(
        await t.prisma.system.auditLog.findFirst({
          where: { tenantId: tenant.id, action: 'rule.activated', entityId: second.body.id },
        }),
      ).not.toBeNull();
    });

    it('regra ativada é imutável (definição, fontes, revisor) e não pode ser excluída', async () => {
      const draft = await post('/rules', admin, { definition: {}, sources: source });
      await post(`/rules/${draft.body.id}/activate`, admin, {
        reviewedBy: 'Eng. Maria Souza (CREA 123)',
      });

      await expect(
        t.prisma.system.ruleSet.update({
          where: { id: draft.body.id },
          data: { definition: { thresholds: { hspMax: 99 } } },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.ruleSet.update({
          where: { id: draft.body.id },
          data: { reviewedBy: 'outra pessoa' },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.ruleSet.delete({ where: { id: draft.body.id } }),
      ).rejects.toThrow(/excluída/);
      expect((await t.http.delete(`${API}/rules/${draft.body.id}`).set(bearer(admin))).status).toBe(
        409,
      );
      expect(
        (
          await post(`/rules/${draft.body.id}/activate`, admin, {
            reviewedBy: 'Eng. Maria Souza (CREA 123)',
          })
        ).status,
      ).toBe(409);
    });

    it('rascunho pode ser excluído; só uma versão ativa por chave (garantido no banco)', async () => {
      const draft = await post('/rules', admin, { definition: {}, sources: source });
      expect((await t.http.delete(`${API}/rules/${draft.body.id}`).set(bearer(admin))).status).toBe(
        200,
      );
      expect(
        (await t.http.get(`${API}/rules`).set(bearer(admin))).body.map((r: { id: string }) => r.id),
      ).not.toContain(draft.body.id);

      const active = await t.prisma.system.ruleSet.findFirstOrThrow({
        where: { tenantId: tenant.id, status: 'ACTIVE' },
      });
      const intruder = await t.prisma.system.ruleSet.create({
        data: { tenantId: tenant.id, key: active.key, version: 999, definition: {}, sources: [] },
      });
      await expect(
        t.prisma.system.ruleSet.update({
          where: { id: intruder.id },
          data: {
            status: 'ACTIVE',
            reviewedBy: 'x',
            reviewedAt: new Date(),
            validFrom: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('permissões: ler exige platform.rule.read; gerenciar exige platform.rule.manage', async () => {
      expect((await t.http.get(`${API}/rules`).set(bearer(seller))).status).toBe(403);
      expect((await post('/rules', seller, { definition: {}, sources: source })).status).toBe(403);
      const engineer = await t.prisma.system.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Engenharia',
          email: `eng.${tenant.id.slice(0, 6)}@rules.test`,
          passwordHash: (
            await t.prisma.system.user.findUniqueOrThrow({ where: { id: tenant.owner.id } })
          ).passwordHash,
          role: 'ENGINEERING',
        },
      });
      const engToken = await tokenFor(t.http, {
        id: engineer.id,
        email: engineer.email,
        role: 'ENGINEERING',
      });
      expect((await t.http.get(`${API}/rules`).set(bearer(engToken))).status).toBe(200);
      expect((await post('/rules', engToken, { definition: {}, sources: source })).status).toBe(
        403,
      );
    });
  });

  describe('concessionárias e tarifas', () => {
    it('CRUD de concessionária, nome único por empresa e bloqueio de exclusão com tarifas', async () => {
      const dist = await post('/distributors', admin, { name: 'Enel Ceará', state: 'ce' });
      expect(dist.status).toBe(201);
      expect(dist.body.state).toBe('CE');
      expect((await post('/distributors', admin, { name: 'Enel Ceará' })).status).toBe(409);
      expect(
        (
          await t.http
            .patch(`${API}/distributors/${dist.body.id}`)
            .set(bearer(admin))
            .send({ name: 'Enel Distribuição Ceará' })
        ).body.name,
      ).toBe('Enel Distribuição Ceará');

      await post('/tariffs', admin, {
        distributorId: dist.body.id,
        customerGroup: 'B',
        modality: 'Convencional',
        energyCentsPerKwh: 95.543,
        validFrom: '2026-01-01',
        source: 'fatura',
      });
      expect(
        (await t.http.delete(`${API}/distributors/${dist.body.id}`).set(bearer(admin))).status,
      ).toBe(409);
      const empty = await post('/distributors', admin, { name: 'Sem tarifas' });
      expect(
        (await t.http.delete(`${API}/distributors/${empty.body.id}`).set(bearer(admin))).status,
      ).toBe(200);
      expect(
        (await t.http.get(`${API}/distributors`).set(bearer(seller))).body.map(
          (d: { id: string }) => d.id,
        ),
      ).not.toContain(empty.body.id);
    });

    it('tarifa com vigência, fração de centavo, filtros e exclusão lógica', async () => {
      const dist = await post('/distributors', admin, { name: 'Distribuidora Tarifas' });
      const t1 = await post('/tariffs', admin, {
        distributorId: dist.body.id,
        customerGroup: 'B',
        energyCentsPerKwh: 95.543,
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2026-06-01',
        source: 'REH 1',
      });
      expect(t1.status).toBe(201);
      expect(t1.body.energyCentsPerKwh).toBe(95.543);
      expect(t1.body.validTo).toBe('2026-06-01T00:00:00.000Z');
      await post('/tariffs', admin, {
        distributorId: dist.body.id,
        customerGroup: 'A',
        energyCentsPerKwh: 60,
        validFrom: '2026-01-01',
        source: 'REH 2',
      });

      const onlyB = await t.http
        .get(`${API}/tariffs?distributorId=${dist.body.id}&customerGroup=B`)
        .set(bearer(sdr));
      expect(onlyB.body).toHaveLength(1);
      expect((await t.http.delete(`${API}/tariffs/${t1.body.id}`).set(bearer(admin))).status).toBe(
        200,
      );
      expect(
        (await t.http.get(`${API}/tariffs?distributorId=${dist.body.id}`).set(bearer(admin))).body,
      ).toHaveLength(1);
      expect(await t.prisma.system.tariff.findUnique({ where: { id: t1.body.id } })).toMatchObject({
        deletedAt: expect.any(Date),
      });
    });

    it('valida tarifa: valor positivo, fonte obrigatória, vigência coerente, concessionária existente', async () => {
      const dist = await post('/distributors', admin, { name: 'Distribuidora Validação' });
      const base = {
        distributorId: dist.body.id,
        customerGroup: 'B',
        energyCentsPerKwh: 90,
        validFrom: '2026-01-01',
        source: 'x1',
      };
      expect((await post('/tariffs', admin, { ...base, energyCentsPerKwh: 0 })).status).toBe(422);
      expect((await post('/tariffs', admin, { ...base, source: '' })).status).toBe(422);
      expect((await post('/tariffs', admin, { ...base, customerGroup: 'C' })).status).toBe(422);
      expect((await post('/tariffs', admin, { ...base, validFrom: 'ontem' })).status).toBe(422);
      expect((await post('/tariffs', admin, { ...base, validTo: '2025-12-31' })).status).toBe(400);
      expect(
        (
          await post('/tariffs', admin, {
            ...base,
            distributorId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(404);
    });

    it('somente quem gerencia regras escreve; quem calcula lê', async () => {
      expect((await post('/distributors', seller, { name: 'Intrusa' })).status).toBe(403);
      expect((await post('/tariffs', sdr, {})).status).toBe(403);
      expect((await t.http.get(`${API}/distributors`).set(bearer(sdr))).status).toBe(200);
      expect((await t.http.get(`${API}/tariffs`).set(bearer(seller))).status).toBe(200);
    });
  });

  describe('recurso solar (HSP)', () => {
    const hsp = (v = 5) => Array<number>(12).fill(v);

    it('exige a origem do dado e os 12 meses, com valores plausíveis', async () => {
      const ok = await post('/solar-resources', admin, {
        name: 'Fortaleza',
        state: 'ce',
        latitude: -3.73,
        longitude: -38.52,
        hspMonthly: hsp(5.6),
        source: 'CRESESB SunData',
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        name: 'Fortaleza',
        state: 'CE',
        plane: 'Plano horizontal',
        source: 'CRESESB SunData',
      });
      expect(ok.body.hspMonthly).toHaveLength(12);

      expect(
        (await post('/solar-resources', admin, { name: 'Sem origem', hspMonthly: hsp() })).status,
      ).toBe(422);
      expect(
        (
          await post('/solar-resources', admin, {
            name: 'Onze meses',
            hspMonthly: hsp().slice(1),
            source: 'x1',
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/solar-resources', admin, {
            name: 'Zero',
            hspMonthly: [0, ...hsp().slice(1)],
            source: 'x1',
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/solar-resources', admin, {
            name: 'Absurdo',
            hspMonthly: [99, ...hsp().slice(1)],
            source: 'x1',
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/solar-resources', admin, {
            name: 'Lat',
            latitude: 120,
            hspMonthly: hsp(),
            source: 'x1',
          })
        ).status,
      ).toBe(422);
    });

    it('o mesmo local (nome + UF) é atualizado, não duplicado', async () => {
      await post('/solar-resources', admin, {
        name: 'Recife',
        state: 'PE',
        hspMonthly: hsp(5.2),
        source: 'v1 teste',
      });
      const again = await post('/solar-resources', admin, {
        name: 'Recife',
        state: 'PE',
        hspMonthly: hsp(5.4),
        source: 'v2 teste',
      });
      expect(again.status).toBe(201);
      const found = await t.http.get(`${API}/solar-resources?search=recife`).set(bearer(seller));
      expect(found.body.data).toHaveLength(1);
      expect(found.body.data[0].source).toBe('v2 teste');
      expect(found.body.data[0].hspMonthly[0]).toBe(5.4);
    });

    it('importação em lote cria e atualiza, informa os totais e audita', async () => {
      const rows = [
        { name: 'Natal', state: 'RN', hspMonthly: hsp(5.7), source: 'CRESESB SunData' },
        { name: 'Recife', state: 'PE', hspMonthly: hsp(5.5), source: 'v3 teste' },
        { name: 'João Pessoa', state: 'PB', hspMonthly: hsp(5.3), source: 'CRESESB SunData' },
      ];
      const res = await post('/solar-resources/import', admin, { rows });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ created: 2, updated: 1 });
      expect(
        await t.prisma.system.auditLog.findFirst({
          where: { tenantId: tenant.id, action: 'solar_resource.imported' },
        }),
      ).not.toBeNull();
      expect((await post('/solar-resources/import', admin, { rows: [] })).status).toBe(422);
      expect(
        (
          await post('/solar-resources/import', admin, {
            rows: [{ name: 'Ruim', hspMonthly: [1], source: 'x1' }],
          })
        ).status,
      ).toBe(422);
    });

    it('lista paginada com busca; exclusão lógica; escrita restrita', async () => {
      const page = await t.http.get(`${API}/solar-resources?page=1&pageSize=2`).set(bearer(seller));
      expect(page.body.meta).toMatchObject({ page: 1, pageSize: 2 });
      expect(page.body.data.length).toBeLessThanOrEqual(2);
      const one = await post('/solar-resources', admin, {
        name: 'Para Excluir',
        hspMonthly: hsp(),
        source: 'x1',
      });
      expect(
        (await t.http.delete(`${API}/solar-resources/${one.body.id}`).set(bearer(admin))).status,
      ).toBe(200);
      expect(
        (await t.http.get(`${API}/solar-resources/${one.body.id}`).set(bearer(admin))).status,
      ).toBe(404);
      expect(
        (
          await post('/solar-resources', seller, {
            name: 'Intruso',
            hspMonthly: hsp(),
            source: 'x1',
          })
        ).status,
      ).toBe(403);
      expect(
        (await t.http.delete(`${API}/solar-resources/${one.body.id}`).set(bearer(seller))).status,
      ).toBe(403);
    });
  });
});
