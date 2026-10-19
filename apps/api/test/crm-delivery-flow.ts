import { API, bearer } from './helpers';
import {
  buildOpportunity,
  referenceQuote,
  type BuildOptions,
  type Flow,
  type Ready,
} from './crm-flow';

/** Política de margem geral de 20% (a cotação de referência rende ~28,7%). */
export async function ensureMarginPolicy(f: Flow, manager: string): Promise<void> {
  await f.t.prisma.system.marginPolicy.updateMany({
    where: { tenantId: f.tenant.id },
    data: { deletedAt: new Date() },
  });
  await f.t.http
    .post(`${API}/margin-policies`)
    .set(bearer(manager))
    .send({ name: 'Mínimo geral', minMarginRate: 0.2 });
}

export interface AcceptedDeal extends Ready {
  proposalId: string;
  quoteId: string;
  token: string;
}

/** Leva uma oportunidade até o aceite da proposta (etapa Contrato): triagem → cotação → proposta → envio → aceite. */
export async function acceptedDeal(
  f: Flow,
  options: BuildOptions & { quotes?: number; accept?: boolean } = {},
): Promise<AcceptedDeal> {
  const post = (path: string, body: unknown = {}) =>
    f.t.http
      .post(`${API}${path}`)
      .set(bearer(f.seller))
      .send(body as object);
  const ready = await buildOpportunity(f, options);
  await post(`/opportunities/${ready.opportunityId}/guard/evaluate`);
  await post(`/opportunities/${ready.opportunityId}/stage`, { stage: 'QUOTING' });
  const quoteIds: string[] = [];
  for (let i = 0; i < (options.quotes ?? 1); i++) {
    const quote = await post(
      `/opportunities/${ready.opportunityId}/quotes`,
      referenceQuote(
        i === 0 ? {} : { title: `Cenário ${i + 1}`, priceCents: 2_000_000 + i * 100_000 },
      ),
    );
    quoteIds.push(quote.body.id);
  }
  const labels = quoteIds.length > 1 ? { labels: quoteIds.map((_, i) => `Opção ${i + 1}`) } : {};
  const proposal = await post(`/opportunities/${ready.opportunityId}/proposals`, {
    quoteIds,
    paymentTerms: '30% de entrada + 6x',
    ...labels,
  });
  const sent = await post(`/proposals/${proposal.body.id}/send`);
  const token = (sent.body.publicUrl as string).split('/p/')[1] as string;
  if (options.accept !== false)
    await f.t.http
      .post(`${API}/public/proposals/${token}/accept`)
      .send({ name: 'Maria da Silva', acknowledge: true });
  return { ...ready, proposalId: proposal.body.id, quoteId: quoteIds[0] as string, token };
}

export interface SignedDeal extends AcceptedDeal {
  contractId: string;
  projectId: string;
}

/** Aceite → contrato → assinatura: devolve o projeto criado. */
export async function signedDeal(
  f: Flow,
  manager: string,
  options: BuildOptions & { quotes?: number } = {},
): Promise<SignedDeal> {
  const { textPdf } = await import('./crm-support');
  const deal = await acceptedDeal(f, options);
  const contract = await f.t.http
    .post(`${API}/opportunities/${deal.opportunityId}/contracts`)
    .set(bearer(manager))
    .send({});
  if (contract.status !== 201)
    throw new Error(`contrato: ${contract.status} ${JSON.stringify(contract.body)}`);
  const signed = await f.t.http
    .post(`${API}/contracts/${contract.body.id}/sign`)
    .set(bearer(manager))
    .attach('file', await textPdf('Contrato assinado'), {
      filename: 'assinado.pdf',
      contentType: 'application/pdf',
    });
  if (signed.status !== 200)
    throw new Error(`assinatura: ${signed.status} ${JSON.stringify(signed.body)}`);
  return { ...deal, contractId: contract.body.id, projectId: signed.body.projectId };
}
