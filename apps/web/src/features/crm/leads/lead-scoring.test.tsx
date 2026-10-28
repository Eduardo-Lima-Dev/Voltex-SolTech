import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { LeadScoringConfig } from '@voltex/shared';
import { API, makeLead, makeSession, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const EMPTY: LeadScoringConfig = {
  criteria: [],
  routing: { method: 'NONE', userIds: [], regions: [] },
};

describe('Pontuação de leads', () => {
  it('a lista mostra a nota com o detalhe de cada critério e ordena por pontuação', async () => {
    const urls: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/lead-capture`, () => HttpResponse.json({ key: 'lk_x' })),
      http.get(`${API}/leads`, ({ request }) => {
        urls.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page(
            [
              makeLead({
                score: 82,
                scoreBreakdown: [{ key: 'SOURCE', weight: 20, points: 100 }],
              }),
              makeLead({ id: 'lead-2', name: 'Sem nota', score: null }),
            ],
            2,
          ),
        );
      }),
    );
    renderApp('/crm/leads', { session: makeSession('SALES_MANAGER') });
    const row = await screen.findByRole('row', { name: /Maria Silva/ });
    const badge = within(row).getByText('82');
    expect(badge).toHaveAttribute('title', expect.stringContaining('Origem: 100 pts (peso 20)'));
    expect(
      within(screen.getByRole('row', { name: /Sem nota/ })).getByText('—'),
    ).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText('Ordenar leads'), 'score');
    await waitFor(() => expect(urls.at(-1)?.get('sort')).toBe('score'));
  });

  it('a conta de luz do lead é enviada em centavos', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/lead-capture`, () => HttpResponse.json({ key: 'lk_x' })),
      http.get(`${API}/leads`, () => HttpResponse.json(page([], 0))),
      http.post(`${API}/leads`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeLead(), { status: 201 });
      }),
    );
    renderApp('/crm/leads', { session: makeSession('SALES_MANAGER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Novo lead/ }));
    await user.type(await screen.findByLabelText(/Nome/), 'Cliente Novo');
    await user.type(screen.getByLabelText(/Telefone/), '(85) 98888-7777');
    await user.type(screen.getByLabelText('Conta de luz mensal (R$)'), '1.234,50');
    await user.click(screen.getByRole('button', { name: /Salvar|Cadastrar/ }));
    await waitFor(() =>
      expect(body).toMatchObject({ name: 'Cliente Novo', monthlyBillCents: 123_450 }),
    );
  });
});

describe('Configuração da pontuação', () => {
  it('sem permissão, a tela não abre', async () => {
    renderApp('/crm/pontuacao', { session: makeSession('SDR') });
    expect(await screen.findByText(/sem acesso|não tem acesso/i)).toBeInTheDocument();
  });

  it('monta critérios com pesos e pontos e salva a configuração', async () => {
    let saved: LeadScoringConfig | undefined;
    server.use(
      http.get(`${API}/lead-scoring/config`, () => HttpResponse.json(EMPTY)),
      http.get(`${API}/users`, () =>
        HttpResponse.json(
          page(
            [
              {
                id: 'u-1',
                name: 'Vendedora Ana',
                email: 'ana@x.test',
                role: 'SALESPERSON',
                isActive: true,
              },
              {
                id: 'u-2',
                name: 'Vendedor Beto',
                email: 'beto@x.test',
                role: 'SALESPERSON',
                isActive: true,
              },
            ],
            2,
          ),
        ),
      ),
      http.put(`${API}/lead-scoring/config`, async ({ request }) => {
        saved = (await request.json()) as LeadScoringConfig;
        return HttpResponse.json(saved);
      }),
    );
    renderApp('/crm/pontuacao', { session: makeSession('SALES_MANAGER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Origem do lead/ }));
    await user.clear(screen.getByLabelText('Peso (1 a 100)'));
    await user.type(screen.getByLabelText('Peso (1 a 100)'), '40');
    await user.type(screen.getByLabelText('Origem do lead: pontos de Indicação'), '90');
    await user.selectOptions(screen.getByLabelText('Regra'), 'ROUND_ROBIN');
    await user.click(await screen.findByLabelText('Vendedora Ana'));
    await user.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved?.criteria).toEqual([{ key: 'SOURCE', weight: 40, points: { REFERRAL: 90 } }]);
    expect(saved?.routing).toMatchObject({ method: 'ROUND_ROBIN', userIds: ['u-1'] });
  });

  it('repontuar os leads em aberto mostra quantos foram atualizados', async () => {
    server.use(
      http.get(`${API}/lead-scoring/config`, () => HttpResponse.json(EMPTY)),
      http.get(`${API}/users`, () => HttpResponse.json(page([], 0))),
      http.post(`${API}/lead-scoring/rescore`, () => HttpResponse.json({ updated: 12 })),
    );
    renderApp('/crm/pontuacao', { session: makeSession('SALES_MANAGER') });
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Pontuar de novo os leads em aberto' }));
    expect(await screen.findByText('12 lead(s) pontuado(s) de novo.')).toBeInTheDocument();
  });
});
