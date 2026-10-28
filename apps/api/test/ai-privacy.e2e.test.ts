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

/** LGPD das conversas do assistente (Fase 12J): retenção, eliminação do titular citado e exportação. */
describe('IA · LGPD das conversas (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let owner: string;
  let accountId: string;
  let accountName: string;

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const put = (path: string, token: string, body: unknown) =>
    t.http
      .put(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  /** Uma conversa guardada, como o assistente a grava: título mascarado e pseudônimos com o id de quem foi citado. */
  const conversation = async (
    over: { updatedAt?: Date; cites?: string | null; text?: string } = {},
  ) => {
    const conv = await t.prisma.system.aiConversation.create({
      data: {
        tenantId: a.id,
        userId: a.owner.id,
        title: 'Quanto [CLIENTE_1] já pagou?',
        pseudonyms: over.cites
          ? [{ alias: '[CLIENTE_1]', kind: 'CLIENTE', entityId: over.cites, name: accountName }]
          : [],
        updatedAt: over.updatedAt,
      },
    });
    await t.prisma.system.aiMessage.createMany({
      data: [
        {
          tenantId: a.id,
          conversationId: conv.id,
          role: 'USER',
          text: over.text ?? 'Quanto [CLIENTE_1] já pagou?',
          maskedText: 'Quanto [CLIENTE_1] já pagou?',
        },
        {
          tenantId: a.id,
          conversationId: conv.id,
          role: 'ASSISTANT',
          text: 'Resposta',
          maskedText: 'Resposta {{F1}}',
        },
      ],
    });
    return conv.id;
  };
  const exists = async (id: string) =>
    (await t.prisma.system.aiConversation.count({ where: { id } })) === 1;

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'iaprivacy');
    owner = await tokenFor(t.http, a.owner);
    const manager = await tokenFor(t.http, a.manager);
    const seller = await tokenFor(t.http, a.salesperson);
    const flow: Flow = { t, tenant: a, seller, admin: owner };
    await ensureMarginPolicy(flow, manager);
    // Proposta aceita e sem contrato assinado: a eliminação do titular não fica retida por prazo legal.
    const deal = await acceptedDeal(flow, { name: 'Titular Conversado' });
    await t.prisma.system.opportunity.update({
      where: { id: deal.opportunityId },
      data: { status: 'LOST', stage: 'LOST', lostReason: 'Desistiu' },
    });
    accountId = deal.accountId;
    accountName = 'Titular Conversado';
  });
  afterAll(() => t.close());

  it('o prazo de retenção apaga as conversas antigas e preserva as recentes', async () => {
    const old = await conversation({ updatedAt: new Date(Date.now() - 400 * 86_400_000) });
    const recent = await conversation();
    const saved = await put('/privacy/retention', owner, {
      unconvertedLeadsMonths: null,
      lostOpportunitiesMonths: null,
      fieldPhotosMonths: null,
      geolocationMonths: null,
      aiConversationsMonths: 12,
      signedContractsMonths: 60,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.policy.aiConversationsMonths).toBe(12);
    const { PrivacyService } = await import('../src/products/crm/privacy/privacy.service');
    const done = await t.app.get(PrivacyService).sweepAll();
    expect(done.aiConversations).toBeGreaterThanOrEqual(1);
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await t.prisma.system.aiMessage.count({ where: { conversationId: old } })).toBe(0);
    // Volta ao padrão para não afetar os outros testes.
    await put('/privacy/retention', owner, {
      unconvertedLeadsMonths: null,
      lostOpportunitiesMonths: null,
      fieldPhotosMonths: null,
      geolocationMonths: null,
      aiConversationsMonths: null,
      signedContractsMonths: 60,
    });
  });

  it('a exportação traz as conversas sem o texto com marcadores e sem o mapa de pseudônimos', async () => {
    const id = await conversation({ cites: accountId });
    const { DataExportService } = await import('../src/platform/tenancy/data-export.service');
    const { RequestContext } = await import('../src/common/context/request-context');
    const exported = await t.app
      .get(RequestContext)
      .run({ tenantId: a.id }, () => t.app.get(DataExportService).exportTenant());
    const chats = JSON.stringify(
      (exported as unknown as { data?: Record<string, unknown>; aiConversations?: unknown }).data
        ?.aiConversations ?? (exported as unknown as { aiConversations: unknown }).aiConversations,
    );
    expect(chats).toContain(id);
    expect(chats).not.toContain(accountName);
    expect(chats).not.toContain('entityId');
    const messages = JSON.stringify(
      (exported as unknown as { aiMessages?: unknown }).aiMessages ??
        (exported as unknown as { data: { aiMessages: unknown } }).data.aiMessages,
    );
    expect(messages).not.toContain('maskedText');
  });

  it('eliminar o titular apaga as conversas que o citam e mantém as outras', async () => {
    const citing = await conversation({ cites: accountId });
    const other = await conversation({ cites: null });
    const res = await post('/privacy/erasures', owner, {
      subjectType: 'ACCOUNT',
      subjectId: accountId,
      reason: 'Pedido do titular por e-mail',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.summary.conversasDaIa).toBeGreaterThanOrEqual(1);
    expect(await exists(citing)).toBe(false);
    expect(await exists(other)).toBe(true);
  });
});
