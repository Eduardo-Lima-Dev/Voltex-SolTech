import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makePublicProposal } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const TOKEN = 'token-publico-token-publico-token-publico-12';
const open = (proposal = makePublicProposal()) => {
  server.use(http.get(`${API}/public/proposals/${TOKEN}`, () => HttpResponse.json(proposal)));
  // Cliente: sem sessão.
  return renderApp(`/p/${TOKEN}`, { session: null });
};

describe('Proposta pública', () => {
  it('abre sem login, fora da casca da suíte, com os números e sem nada interno', async () => {
    open(makePublicProposal({ brand: { primaryColor: '#0a7d3b', hasLogo: true } }));
    expect(await screen.findByRole('heading', { name: 'Casa da Maria' })).toBeInTheDocument();
    expect(screen.getByText('Sol do Nordeste')).toBeInTheDocument();
    expect(screen.getByText(/Para Maria Silva/)).toBeInTheDocument();
    expect(screen.getByText('R$ 19.800,00')).toBeInTheDocument();
    expect(screen.getByText('4,4 kWp')).toBeInTheDocument();
    expect(screen.getByText(/30% de entrada \+ 6x/)).toBeInTheDocument();
    expect(screen.getByText('Estimativas sujeitas à vistoria técnica.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Logo de Sol do Nordeste' })).toHaveAttribute(
      'src',
      expect.stringContaining(`/public/proposals/${TOKEN}/logo`),
    );
    expect(screen.getByRole('link', { name: /Baixar PDF/ })).toHaveAttribute(
      'href',
      expect.stringContaining(`/public/proposals/${TOKEN}/pdf`),
    );
    expect(screen.queryByText(/margem|custo|comissão/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: /Produtos|Principal/i }),
    ).not.toBeInTheDocument();
  });

  it('valida o aceite e registra com nome e confirmação', async () => {
    let body: Record<string, unknown> | undefined;
    open();
    server.use(
      http.post(`${API}/public/proposals/${TOKEN}/accept`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makePublicProposal({
            status: 'ACCEPTED',
            acceptedByName: 'Maria da Silva',
            acceptedAt: '2026-10-18T16:00:00.000Z',
          }),
        );
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Aceitar proposta' }));
    expect(await screen.findByText('Informe seu nome completo')).toBeInTheDocument();
    expect(screen.getByText('É necessário confirmar o aceite')).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.type(screen.getByLabelText('Nome completo'), 'Maria da Silva');
    await user.type(screen.getByLabelText('CPF ou CNPJ (opcional)'), '123.456.789-09');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Aceitar proposta' }));
    await waitFor(() =>
      expect(body).toEqual({
        name: 'Maria da Silva',
        document: '123.456.789-09',
        acknowledge: true,
      }),
    );
    expect(await screen.findByText(/Proposta aceita por/)).toHaveTextContent('Maria da Silva');
    expect(screen.queryByRole('button', { name: 'Aceitar proposta' })).not.toBeInTheDocument();
  });

  it('mostra o erro quando o servidor recusa o aceite (validade vencida)', async () => {
    open();
    server.use(
      http.post(`${API}/public/proposals/${TOKEN}/accept`, () =>
        HttpResponse.json(
          {
            statusCode: 410,
            code: 'GONE',
            message: 'A validade desta proposta acabou. Peça uma nova ao vendedor.',
          },
          { status: 410 },
        ),
      ),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome completo'), 'Maria da Silva');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Aceitar proposta' }));
    expect(await screen.findByText(/A validade desta proposta acabou/)).toBeInTheDocument();
  });

  it('proposta substituída avisa e não permite aceitar nem baixar', async () => {
    open(makePublicProposal({ status: 'SUPERSEDED' }));
    expect(await screen.findByText(/foi substituída por uma versão mais nova/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar proposta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Baixar PDF/ })).not.toBeInTheDocument();
  });

  it('vencida avisa e não oferece o aceite', async () => {
    open(makePublicProposal({ expired: true }));
    expect(await screen.findByText(/A validade desta proposta acabou/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar proposta' })).not.toBeInTheDocument();
  });

  it('já aceita mostra quem aceitou', async () => {
    open(
      makePublicProposal({
        status: 'ACCEPTED',
        acceptedByName: 'Maria da Silva',
        acceptedAt: '2026-10-18T16:00:00.000Z',
      }),
    );
    expect(await screen.findByText(/Proposta aceita por/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nome completo')).not.toBeInTheDocument();
  });

  it('link desconhecido mostra uma mensagem clara', async () => {
    server.use(
      http.get(`${API}/public/proposals/${TOKEN}`, () =>
        HttpResponse.json(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Proposta não encontrada' },
          { status: 404 },
        ),
      ),
    );
    renderApp(`/p/${TOKEN}`, { session: null });
    expect(
      await screen.findByRole('heading', { name: 'Proposta não encontrada' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/foi substituído por um mais novo/)).toBeInTheDocument();
  });
});
