import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { PortalProjectDto } from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const me = {
  companyName: 'Sol do Nordeste',
  accountName: 'Maria da Silva',
  email: 'maria@teste.test',
};

const project = (o: Partial<PortalProjectDto> = {}): PortalProjectDto => ({
  id: 'p-1',
  projectCode: 'PRJ-2026-0001',
  title: 'Casa da Maria',
  statusLabel: 'Aguardando o seu aceite',
  milestones: [
    { key: 'CONTRACT', label: 'Contrato assinado', date: '2026-09-01', done: true },
    { key: 'ACTIVE', label: 'Sistema em operação', date: null, done: false },
  ],
  nextVisit: null,
  schedule: [],
  documents: [
    {
      id: 'd-1',
      kind: 'CONTRACT',
      label: 'Contrato assinado',
      filename: 'contrato.pdf',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  warranties: [],
  tickets: [],
  receivables: [],
  plant: null,
  monitoring: null,
  acceptance: { status: 'PENDING', installationId: 'i-1', acceptedAt: null, acceptedByName: null },
  uploads: [],
  ...o,
});

describe('Portal do cliente', () => {
  it('pede o link pelo e-mail e mostra a mesma mensagem sempre', async () => {
    let sent: unknown;
    server.use(
      http.post(`${API}/public/portal/request-link`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ message: 'ok' }, { status: 202 });
      }),
    );
    renderApp('/portal/entrar');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'maria@teste.test');
    await user.click(screen.getByRole('button', { name: 'Receber link de acesso' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Se este e-mail tiver acesso/);
    expect(sent).toEqual({ email: 'maria@teste.test' });
  });

  it('abre o link uma única vez e leva ao portal', async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/public/portal/exchange`, () => {
        calls += 1;
        return HttpResponse.json({ expiresAt: '2026-10-23T23:00:00.000Z' });
      }),
      http.get(`${API}/portal/me`, () => HttpResponse.json(me)),
      http.get(`${API}/portal/projects`, () => HttpResponse.json([])),
    );
    renderApp('/portal/acesso/token-de-teste-com-mais-de-vinte-caracteres');
    expect(await screen.findByRole('heading', { name: 'Meus projetos' })).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('link vencido mostra o aviso e o caminho para pedir outro', async () => {
    server.use(
      http.post(`${API}/public/portal/exchange`, () =>
        HttpResponse.json(
          { statusCode: 410, code: 'GONE', message: 'Este link expirou' },
          { status: 410 },
        ),
      ),
    );
    renderApp('/portal/acesso/token-de-teste-com-mais-de-vinte-caracteres');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este link expirou ou já foi usado.',
    );
    expect(screen.getByRole('link', { name: 'Pedir novo link' })).toHaveAttribute(
      'href',
      '/portal/entrar',
    );
  });

  it('sem sessão volta para a tela de entrada', async () => {
    server.use(
      http.get(`${API}/portal/me`, () =>
        HttpResponse.json(
          { statusCode: 401, code: 'UNAUTHORIZED', message: 'Entre pelo link' },
          { status: 401 },
        ),
      ),
    );
    renderApp('/portal');
    expect(await screen.findByRole('heading', { name: 'Portal do cliente' })).toBeInTheDocument();
  });

  it('lista os projetos com a situação e as etapas', async () => {
    server.use(
      http.get(`${API}/portal/me`, () => HttpResponse.json(me)),
      http.get(`${API}/portal/projects`, () => HttpResponse.json([project()])),
    );
    renderApp('/portal');
    expect(await screen.findByRole('link', { name: 'Casa da Maria' })).toHaveAttribute(
      'href',
      '/portal/projetos/p-1',
    );
    expect(screen.getByText('Aguardando o seu aceite')).toBeInTheDocument();
    expect(screen.getByText('Sol do Nordeste')).toBeInTheDocument();
    expect(screen.getByLabelText('Concluída')).toBeInTheDocument();
  });

  it('registra o aceite com o nome do cliente', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/portal/me`, () => HttpResponse.json(me)),
      http.get(`${API}/portal/projects/p-1`, () => HttpResponse.json(project())),
      http.post(`${API}/portal/projects/p-1/acceptance`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          project({
            acceptance: {
              status: 'DONE',
              installationId: 'i-1',
              acceptedAt: '2026-10-23T00:00:00.000Z',
              acceptedByName: 'Maria da Silva',
            },
          }),
        );
      }),
    );
    renderApp('/portal/projetos/p-1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Registrar o meu aceite' }));
    await user.type(await screen.findByLabelText('Seu nome completo'), 'Maria da Silva');
    await user.click(screen.getByRole('button', { name: 'Confirmar aceite' }));
    await waitFor(() => expect(body).toEqual({ acceptedByName: 'Maria da Silva' }));
  });

  it('abre um chamado da usina do cliente', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/portal/me`, () => HttpResponse.json(me)),
      http.get(`${API}/portal/projects/p-1`, () =>
        HttpResponse.json(
          project({
            acceptance: {
              status: 'DONE',
              installationId: 'i-1',
              acceptedAt: '2026-10-01T00:00:00.000Z',
              acceptedByName: 'Maria',
            },
            plant: {
              id: 'pl-1',
              name: 'Usina da Maria',
              powerKwp: 5,
              activatedAt: '2026-10-02T00:00:00.000Z',
            },
          }),
        ),
      ),
      http.post(`${API}/portal/tickets`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderApp('/portal/projetos/p-1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Abrir chamado' }));
    await user.type(await screen.findByLabelText('Resumo'), 'Inversor com luz vermelha');
    await user.click(screen.getByRole('button', { name: 'Abrir chamado', hidden: false }));
    await waitFor(() =>
      expect(body).toMatchObject({ plantId: 'pl-1', title: 'Inversor com luz vermelha' }),
    );
  });
});
