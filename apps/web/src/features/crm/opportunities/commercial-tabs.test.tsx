import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { opportunityPageHandlers } from '@/test/crm-handlers';
import {
  API,
  makeGuard,
  makeOpportunity,
  makeProposal,
  makeQuote,
  makeSession,
} from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const opp = makeOpportunity({ stage: 'PRE_SIZING' });
const open = async (tab: string, extra: Parameters<typeof server.use> = [], role = 'OWNER') => {
  server.use(...opportunityPageHandlers(opp));
  server.use(...extra);
  renderApp(`/crm/oportunidades/${opp.id}`, { session: makeSession(role as 'OWNER') });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: tab }));
  return user;
};
const guard = (
  current: ReturnType<typeof makeGuard> | null,
  history: ReturnType<typeof makeGuard>[] = [],
) =>
  http.get(`${API}/opportunities/${opp.id}/guard`, () => HttpResponse.json({ current, history }));
const quotes = (list: ReturnType<typeof makeQuote>[]) =>
  http.get(`${API}/opportunities/${opp.id}/quotes`, () => HttpResponse.json(list));
const proposals = (list: ReturnType<typeof makeProposal>[]) =>
  http.get(`${API}/opportunities/${opp.id}/proposals`, () => HttpResponse.json(list));

describe('Oportunidade · Triagem', () => {
  it('sem avaliação, convida a avaliar; avaliar mostra o resultado', async () => {
    let evaluated = false;
    const user = await open('Triagem', [
      http.get(`${API}/opportunities/${opp.id}/guard`, () =>
        HttpResponse.json({ current: evaluated ? makeGuard() : null, history: [] }),
      ),
      http.post(`${API}/opportunities/${opp.id}/guard/evaluate`, () => {
        evaluated = true;
        return HttpResponse.json(makeGuard());
      }),
    ]);
    expect(
      await screen.findByText('Esta oportunidade ainda não foi avaliada.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avaliar triagem' }));
    expect(await screen.findByText('Triagem verde')).toBeInTheDocument();
    expect(screen.getByText('Liberada para a cotação')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Reavaliar/ })).toBeInTheDocument();
  });

  it('amarela: lista os pontos por gravidade, o que falta e permite liberar com justificativa', async () => {
    let body: Record<string, unknown> | undefined;
    const yellow = makeGuard({
      status: 'YELLOW',
      releasedForQuote: false,
      needsEngineeringReview: true,
      missingFields: ['fatura.validada'],
      checks: [
        {
          code: 'ENTRY_STANDARD_UNKNOWN',
          severity: 'INFO',
          message: 'Padrão de entrada não informado.',
          source: 'INTAKE',
        },
        {
          code: 'BILL_NOT_VALIDATED',
          severity: 'WARNING',
          message: 'A fatura ainda não foi validada.',
          source: 'BILL',
        },
      ],
    });
    const user = await open('Triagem', [
      guard(yellow),
      http.post(`${API}/opportunities/${opp.id}/guard/override`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...yellow, releasedForQuote: true });
      }),
    ]);
    expect(await screen.findByText('Triagem amarela')).toBeInTheDocument();
    expect(screen.getByText('A fatura ainda não foi validada.')).toBeInTheDocument();
    expect(screen.getByText('fatura.validada')).toBeInTheDocument();
    expect(screen.getByText('Requer revisão de engenharia.')).toBeInTheDocument();
    const warning = screen.getByText('A fatura ainda não foi validada.');
    const info = screen.getByText('Padrão de entrada não informado.');
    expect(warning.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Liberar mesmo assim/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Justificativa'), 'curto');
    await user.click(within(dialog).getByRole('button', { name: 'Liberar para a cotação' }));
    expect(await within(dialog).findByText(/mínimo de 10 caracteres/)).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.clear(within(dialog).getByLabelText('Justificativa'));
    await user.type(
      within(dialog).getByLabelText('Justificativa'),
      'Fatura chega na visita de sexta.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Liberar para a cotação' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      evaluationId: 'guard-1',
      justification: 'Fatura chega na visita de sexta.',
    });
  });

  it('desatualizada avisa o motivo e não oferece liberação; vendedor nunca vê a liberação', async () => {
    await open('Triagem', [
      guard(
        makeGuard({
          status: 'YELLOW',
          releasedForQuote: false,
          stale: true,
          invalidatedReason: 'site_intake_changed',
        }),
      ),
    ]);
    expect(
      await screen.findByText(/As premissas mudaram depois desta avaliação/),
    ).toBeInTheDocument();
    expect(screen.getByText('Desatualizada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Liberar mesmo assim/ })).not.toBeInTheDocument();
  });

  it('quem não tem a permissão de liberar não vê o botão', async () => {
    await open(
      'Triagem',
      [guard(makeGuard({ status: 'RED', releasedForQuote: false }))],
      'SALESPERSON',
    );
    expect(await screen.findByText('Triagem vermelha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Liberar mesmo assim/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reavaliar' })).toBeInTheDocument();
  });

  it('mostra quem liberou e o histórico de avaliações', async () => {
    await open('Triagem', [
      guard(
        makeGuard({
          version: 2,
          status: 'YELLOW',
          override: {
            id: 'ov-1',
            justification: 'Visita agendada.',
            decidedById: 'u2',
            decidedByName: 'Marcos Gestor',
            decidedAt: '2026-10-18T13:00:00.000Z',
          },
        }),
        [
          makeGuard({
            id: 'guard-0',
            version: 1,
            status: 'RED',
            invalidatedReason: 'novo cálculo vinculado',
          }),
        ],
      ),
    ]);
    expect(await screen.findByText(/Liberada por Marcos Gestor/)).toBeInTheDocument();
    expect(screen.getByText('Visita agendada.')).toBeInTheDocument();
    expect(screen.getByText(/v1 · Vermelha · novo cálculo vinculado/)).toBeInTheDocument();
  });
});

describe('Oportunidade · Cotação', () => {
  it('lista com situação da margem, preço mínimo e o aviso de política ausente', async () => {
    await open('Cotação', [
      quotes([
        makeQuote({
          id: 'q2',
          version: 2,
          title: 'Premium',
          marginStatus: 'BELOW_POLICY',
          minMarginRate: 0.35,
          releasedForProposal: false,
          priceCents: 1_500_000,
          margin: { ...makeQuote().margin, marginRate: 0.12 },
        }),
        makeQuote({ id: 'q1', version: 1, locked: true }),
      ]),
    ]);
    expect(await screen.findByText('v2 · Premium')).toBeInTheDocument();
    expect(screen.getByText('Abaixo do mínimo')).toBeInTheDocument();
    expect(screen.getByText('Dentro da política')).toBeInTheDocument();
    expect(screen.getByText(/pelo menos/)).toHaveTextContent('R$ 17.217,93');
    expect(screen.getByText('Em proposta')).toBeInTheDocument();
    // A cotação travada não oferece edição.
    const locked = screen.getByText('v1').closest('li')!;
    expect(within(locked).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
  });

  it('sem política da empresa, explica onde cadastrar', async () => {
    await open('Cotação', [
      quotes([
        makeQuote({
          marginStatus: 'NO_POLICY',
          minMarginRate: null,
          minPriceCents: null,
          releasedForProposal: false,
        }),
      ]),
    ]);
    expect(await screen.findByText(/ainda não definiu a margem mínima/)).toBeInTheDocument();
    expect(screen.getByText('Sem política definida')).toBeInTheDocument();
  });

  it(
    'cria cotação: valida, mostra a margem ao digitar e envia valores em centavos',
    { timeout: 30_000 },
    async () => {
      let body: Record<string, unknown> | undefined;
      const user = await open('Cotação', [
        quotes([makeQuote({ id: 'q0', title: 'Anterior' })]),
        http.post(`${API}/opportunities/${opp.id}/quotes`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeQuote({ id: 'q9', version: 2 }), { status: 201 });
        }),
      ]);
      await user.click(await screen.findByRole('button', { name: /Nova cotação/ }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Salvar cotação' }));
      expect(await within(dialog).findByText(/ao menos um item/)).toBeInTheDocument();
      expect(body).toBeUndefined();

      await user.type(within(dialog).getByLabelText('Descrição do item 1'), 'Kit fotovoltaico');
      await user.clear(within(dialog).getByLabelText('Quantidade do item 1'));
      await user.type(within(dialog).getByLabelText('Quantidade do item 1'), '1');
      await user.type(within(dialog).getByLabelText('Custo unitário do item 1 (R$)'), '10.000,00');
      await user.type(within(dialog).getByLabelText('Preço de venda (R$)'), '20.000,00');
      const preview = within(dialog).getByRole('region', { name: 'Prévia da margem' });
      await waitFor(() => expect(preview).toHaveTextContent('50%'));
      expect(preview).toHaveTextContent('mínimo 20%');

      await user.click(within(dialog).getByRole('button', { name: 'Salvar cotação' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({
        priceCents: 2_000_000,
        items: [
          {
            category: 'MODULE',
            description: 'Kit fotovoltaico',
            quantity: 1,
            unitCostCents: 1_000_000,
          },
        ],
        costs: { commissionRate: 0, freightCents: 0 },
      });
    },
  );

  it('pede aprovação quando está abaixo do mínimo, com justificativa', async () => {
    let body: Record<string, unknown> | undefined;
    const below = makeQuote({
      marginStatus: 'BELOW_POLICY',
      minMarginRate: 0.35,
      releasedForProposal: false,
    });
    const user = await open('Cotação', [
      quotes([below]),
      http.post(`${API}/quotes/quote-1/request-approval`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...below, approvalStatus: 'PENDING' });
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Pedir aprovação' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    expect(await within(dialog).findByText(/pelo menos 10 caracteres/)).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText('Justificativa'),
      'Cliente estratégico, fecha hoje.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() =>
      expect(body).toEqual({ justification: 'Cliente estratégico, fecha hoje.' }),
    );
  });

  it('com pedido pendente não oferece novo pedido', async () => {
    await open('Cotação', [
      quotes([
        makeQuote({
          marginStatus: 'BELOW_POLICY',
          approvalStatus: 'PENDING',
          releasedForProposal: false,
        }),
      ]),
    ]);
    expect(await screen.findByText('Aguardando aprovação')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir aprovação' })).not.toBeInTheDocument();
  });

  it('exclui uma cotação depois de confirmar', async () => {
    const del = vi.fn();
    const user = await open('Cotação', [
      quotes([makeQuote()]),
      http.delete(`${API}/quotes/quote-1`, () => {
        del();
        return HttpResponse.json({ id: 'quote-1' });
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Excluir cotação v1' }));
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(del).toHaveBeenCalled());
  });
});

describe('Oportunidade · Proposta', () => {
  it('lista versões com status, visualizações e aceite', async () => {
    await open('Proposta', [
      quotes([makeQuote()]),
      proposals([
        makeProposal({
          id: 'p2',
          version: 2,
          status: 'VIEWED',
          sentAt: '2026-10-18T12:00:00.000Z',
          viewCount: 3,
          firstViewedAt: '2026-10-18T14:00:00.000Z',
        }),
        makeProposal({ id: 'p1', version: 1, status: 'SUPERSEDED' }),
      ]),
    ]);
    expect(await screen.findByText('Proposta v2')).toBeInTheDocument();
    expect(screen.getByText('Visualizada')).toBeInTheDocument();
    expect(screen.getByText('Substituída')).toBeInTheDocument();
    expect(screen.getByText(/aberta 3 vezes/)).toBeInTheDocument();
    // Substituída não pode ser enviada.
    const old = screen.getByText('Proposta v1').closest('li')!;
    expect(within(old).queryByRole('button', { name: /Enviar|Reenviar/ })).not.toBeInTheDocument();
  });

  it('gera a proposta só com cotações liberadas, e pede nome quando há mais de um cenário', async () => {
    let body: Record<string, unknown> | undefined;
    const user = await open('Proposta', [
      quotes([
        makeQuote({ id: 'q-ok', version: 1 }),
        makeQuote({ id: 'q-ok2', version: 2, title: 'Premium', priceCents: 2_400_000 }),
        makeQuote({
          id: 'q-bad',
          version: 3,
          marginStatus: 'BELOW_POLICY',
          releasedForProposal: false,
        }),
      ]),
      proposals([]),
      http.post(`${API}/opportunities/${opp.id}/proposals`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeProposal(), { status: 201 });
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: /Gerar proposta/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/v3/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Gerar proposta' }));
    expect(await within(dialog).findByText('Escolha ao menos uma cotação')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: /v1/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /v2/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Gerar proposta' }));
    expect(await within(dialog).findByText('Dê um nome a cada cenário')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Nome do cenário da cotação v1'), 'Essencial');
    await user.type(within(dialog).getByLabelText('Nome do cenário da cotação v2'), 'Premium');
    await user.type(within(dialog).getByLabelText('Condições de pagamento (opcional)'), '30% + 6x');
    await user.click(within(dialog).getByRole('button', { name: 'Gerar proposta' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      quoteIds: ['q-ok', 'q-ok2'],
      labels: ['Essencial', 'Premium'],
      validityDays: 15,
      paymentTerms: '30% + 6x',
    });
  });

  it('envia e mostra o link público uma vez', async () => {
    const url = 'https://app.test/p/token-secreto-token-secreto-token-secreto-1234';
    const user = await open('Proposta', [
      quotes([makeQuote()]),
      proposals([makeProposal()]),
      http.post(`${API}/proposals/prop-1/send`, () =>
        HttpResponse.json({ ...makeProposal({ status: 'SENT' }), publicUrl: url }),
      ),
    ]);
    await user.click(await screen.findByRole('button', { name: /^Enviar$/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Link público da proposta')).toHaveValue(url);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('abre o PDF pelo link de download', async () => {
    const opener = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = await open('Proposta', [
      quotes([makeQuote()]),
      proposals([makeProposal()]),
      http.get(`${API}/proposals/prop-1/pdf-url`, () =>
        HttpResponse.json({ url: 'https://s3.test/proposta.pdf', expiresIn: 300 }),
      ),
    ]);
    await user.click(await screen.findByRole('button', { name: 'PDF' }));
    await waitFor(() =>
      expect(opener).toHaveBeenCalledWith('https://s3.test/proposta.pdf', '_blank', 'noopener'),
    );
    opener.mockRestore();
  });

  it('vencida não pode ser enviada', async () => {
    await open('Proposta', [quotes([makeQuote()]), proposals([makeProposal({ expired: true })])]);
    expect(await screen.findByText('Vencida')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Enviar$/ })).not.toBeInTheDocument();
  });
});
