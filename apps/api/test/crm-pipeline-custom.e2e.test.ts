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
import { auditOf } from './crm-support';

describe('CRM · Funil personalizado por empresa (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let seller: string;
  let adminB: string;

  const send = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    token: string,
    body?: object,
  ) =>
    t.http[method](`${API}${path}`)
      .set(bearer(token))
      .send(body ?? {});
  type Column = {
    stage: { key: string; hidden: boolean };
    customStage: { id: string; name: string } | null;
    total: number;
    items: { id: string; customStageName: string | null }[];
  };
  const board = async (token = seller) =>
    (await send('get', '/opportunities/board', token)).body.columns as Column[];
  const newOpp = async () => {
    const acc = (await send('post', '/accounts', seller, { name: `Cliente ${Date.now()}` })).body;
    return (await send('post', '/opportunities', seller, { accountId: acc.id })).body;
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'funil');
    b = await seedTenant(t.prisma, 'funilb');
    admin = await tokenFor(t.http, a.admin);
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
  });
  afterAll(() => t.close());

  it('administrador cria, renomeia e apaga colunas; vendedor só lê', async () => {
    const created = await send('post', '/pipeline/custom-stages', admin, {
      name: 'Visita técnica',
      baseStage: 'QUALIFICATION',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Visita técnica', baseStage: 'QUALIFICATION' });

    expect(
      (await send('post', '/pipeline/custom-stages', seller, { name: 'Xis', baseStage: 'QUOTING' }))
        .status,
    ).toBe(403);
    expect(
      (await send('post', '/pipeline/custom-stages', admin, { name: 'Ganho 2', baseStage: 'WON' }))
        .status,
    ).toBe(422);
    expect((await send('get', '/pipeline/custom-stages', seller)).body).toHaveLength(1);
    expect((await send('get', '/pipeline/custom-stages', adminB)).body).toHaveLength(0);

    const renamed = await send('patch', `/pipeline/custom-stages/${created.body.id}`, admin, {
      name: 'Visita agendada',
    });
    expect(renamed.body.name).toBe('Visita agendada');
    expect((await auditOf(t, a.id, 'pipeline.custom_stage_created')).length).toBeGreaterThan(0);
  });

  it('a coluna nova aparece logo depois da etapa-base e o negócio muda de coluna sem mudar de etapa', async () => {
    const custom = (await send('get', '/pipeline/custom-stages', seller)).body[0];
    const opp = await newOpp();
    await send('post', `/opportunities/${opp.id}/stage`, seller, { stage: 'FIRST_CONTACT' });
    await send('post', `/opportunities/${opp.id}/stage`, seller, { stage: 'QUALIFICATION' });

    const moved = await send('post', `/opportunities/${opp.id}/stage`, seller, {
      stage: 'QUALIFICATION',
      customStageId: custom.id,
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      stage: 'QUALIFICATION',
      customStageId: custom.id,
      customStageName: 'Visita agendada',
    });

    const cols = await board();
    const keys = cols.map((c) => `${c.stage.key}${c.customStage ? '*' : ''}`);
    expect(keys.indexOf('QUALIFICATION*')).toBe(keys.indexOf('QUALIFICATION') + 1);
    expect(cols.find((c) => c.customStage?.id === custom.id)?.items.map((i) => i.id)).toEqual([
      opp.id,
    ]);
    expect(cols.find((c) => !c.customStage && c.stage.key === 'QUALIFICATION')?.total).toBe(0);

    // A coluna precisa ser da etapa-base informada.
    expect(
      (
        await send('post', `/opportunities/${opp.id}/stage`, seller, {
          stage: 'QUOTING',
          customStageId: custom.id,
        })
      ).status,
    ).toBe(422);
    // Voltar para a coluna padrão da mesma etapa.
    const back = await send('post', `/opportunities/${opp.id}/stage`, seller, {
      stage: 'QUALIFICATION',
    });
    expect(back.body.customStageId).toBeNull();
    // E de novo para a personalizada; mudar de etapa depois sai dela e segue as regras de sempre.
    await send('post', `/opportunities/${opp.id}/stage`, seller, {
      stage: 'QUALIFICATION',
      customStageId: custom.id,
    });
    const next = await send('post', `/opportunities/${opp.id}/stage`, seller, {
      stage: 'BILL_PENDING',
    });
    expect(next.body).toMatchObject({ stage: 'BILL_PENDING', customStageId: null });
    const skip = await send('post', `/opportunities/${opp.id}/stage`, seller, {
      stage: 'CONTRACT',
    });
    expect(skip.status).toBe(422);
  });

  it('apagar a coluna devolve os negócios para a coluna padrão da etapa', async () => {
    const custom = (
      await send('post', '/pipeline/custom-stages', admin, {
        name: 'Provisória',
        baseStage: 'NEW_LEAD',
      })
    ).body;
    const opp = await newOpp();
    await send('post', `/opportunities/${opp.id}/stage`, seller, {
      stage: 'NEW_LEAD',
      customStageId: custom.id,
    });
    const removed = await send('delete', `/pipeline/custom-stages/${custom.id}`, admin);
    expect(removed.body).toMatchObject({ id: custom.id, movedBack: 1 });
    const cols = await board();
    expect(cols.find((c) => c.customStage?.id === custom.id)).toBeUndefined();
    expect(
      cols.find((c) => !c.customStage && c.stage.key === 'NEW_LEAD')?.items.map((i) => i.id),
    ).toContain(opp.id);
  });

  it('etapa escondida some do quadro enquanto está vazia e reaparece se receber negócios', async () => {
    const stages = (await send('get', '/pipeline', seller)).body as { id: string; key: string }[];
    const preSizing = stages.find((s) => s.key === 'PRE_SIZING')!;
    const hidden = await send('patch', `/pipeline/stages/${preSizing.id}`, admin, { hidden: true });
    expect(hidden.body.hidden).toBe(true);
    expect((await board()).some((c) => c.stage.key === 'PRE_SIZING')).toBe(false);
    expect((await board(adminB)).some((c) => c.stage.key === 'PRE_SIZING')).toBe(true);

    const opp = await newOpp();
    for (const stage of ['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING', 'PRE_SIZING'])
      expect((await send('post', `/opportunities/${opp.id}/stage`, seller, { stage })).status).toBe(
        200,
      );
    const col = (await board()).find((c) => c.stage.key === 'PRE_SIZING');
    expect(col?.items.map((i) => i.id)).toEqual([opp.id]);

    await send('patch', `/pipeline/stages/${preSizing.id}`, admin, { hidden: false });
    expect((await board()).some((c) => c.stage.key === 'PRE_SIZING')).toBe(true);
  });
});
