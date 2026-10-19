import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const healthOk = http.get(`${API}/health`, () =>
  HttpResponse.json({
    status: 'ok',
    uptimeSeconds: 1,
    checks: {
      database: { status: 'up', latencyMs: 1 },
      redis: { status: 'up', latencyMs: 1 },
      storage: { status: 'up', latencyMs: 1 },
    },
  }),
);

describe('rotas protegidas', () => {
  it('visitante em rota protegida vai ao login e volta à página pedida depois de entrar', async () => {
    const session = makeSession('OWNER');
    server.use(
      http.post(`${API}/auth/login`, () => HttpResponse.json(session)),
      http.get(`${API}/tenant`, () =>
        HttpResponse.json({
          id: 't',
          name: 'Voltex Demo',
          slug: 'v',
          document: null,
          status: 'ACTIVE',
          settings: {},
          createdAt: '2026-01-01T00:00:00Z',
        }),
      ),
      http.get(`${API}/branches`, () => HttpResponse.json([])),
      http.get(`${API}/teams`, () => HttpResponse.json([])),
    );
    const { router } = renderApp('/admin/empresa', { session: null });

    expect(await screen.findByRole('heading', { name: 'Entrar na sua conta' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-mail'), 'owner@voltex.test');
    await user.type(screen.getByLabelText('Senha', { exact: true }), 'Voltex@2026');
    await user.click(screen.getByRole('button', { name: /Entrar/ }));

    expect(await screen.findByText('Dados da empresa')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/empresa');
  });

  it('usuário já logado em /login é levado ao início', async () => {
    server.use(healthOk);
    const { router } = renderApp('/login');
    expect(await screen.findByRole('heading', { name: /Olá, Eduardo/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('ignora destino externo no estado de navegação (sem redirecionamento aberto)', async () => {
    server.use(healthOk);
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { name: /Olá/ });
    expect(router.state.location.pathname).toBe('/');
  });

  it('rota desconhecida mostra a página 404', async () => {
    renderApp('/nao-existe');
    expect(
      await screen.findByRole('heading', { name: 'Página não encontrada' }),
    ).toBeInTheDocument();
  });

  it('o título da aba acompanha a rota', async () => {
    server.use(healthOk);
    renderApp('/');
    await screen.findByRole('heading', { name: /Olá/ });
    await waitFor(() => expect(document.title).toBe('Início · Voltex SolTech'));
  });
});

describe('permissões nas rotas', () => {
  it('vendedor não vê Administração no menu e recebe "Sem acesso" na URL de admin', async () => {
    renderApp('/admin/usuarios', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument();
  });

  it('produto sem permissão mostra "Sem acesso"; com permissão mostra a página do produto', async () => {
    renderApp('/engine', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });

  it('a página de um produto indica a fase em que ele chega', async () => {
    renderApp('/engine');
    expect(
      await screen.findByRole('heading', { name: 'Solar Engine Studio', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Fase 9')).toBeInTheDocument();
    expect(screen.getByText('Em desenvolvimento')).toBeInTheDocument();
  });

  it('o menu só lista os produtos e áreas permitidos ao perfil', async () => {
    renderApp('/', { session: makeSession('SALESPERSON') });
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    const links = Array.from(nav.querySelectorAll('a')).map((a) =>
      a.textContent?.replace(/\(em breve\)/, '').trim(),
    );
    expect(links).toEqual(expect.arrayContaining(['Início', 'CRM Solar', 'Solar Calculator']));
    expect(links).not.toContain('Solar Engine Studio');
    expect(links).not.toContain('Administração');
  });

  it('a barra lateral do proprietário inclui Administração', async () => {
    server.use(healthOk);
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Administração' })).toBeInTheDocument();
  });

  it('/admin leva à primeira aba permitida; Financeiro (sem permissões de admin) fica sem acesso', async () => {
    renderApp('/admin', { session: makeSession('FINANCE') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });

  it('gestor comercial (user.read) vê Usuários e Perfis, mas não Empresa nem Auditoria', async () => {
    server.use(
      http.get(`${API}/users`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 10, total: 0 } }),
      ),
    );
    renderApp('/admin', { session: makeSession('SALES_MANAGER') });
    const tabs = await screen.findByRole('navigation', { name: 'Seções da administração' });
    expect(tabs).toHaveTextContent('Usuários');
    expect(tabs).toHaveTextContent('Perfis');
    expect(tabs).not.toHaveTextContent('Empresa');
    expect(tabs).not.toHaveTextContent('Auditoria');
  });
});

describe('painel inicial', () => {
  it('mostra os 4 produtos; o card de status dos serviços aparece só para quem administra a empresa', async () => {
    server.use(healthOk);
    renderApp('/');
    expect(await screen.findByText('Status dos serviços')).toBeInTheDocument();
    expect(await screen.findAllByText('Operando')).toHaveLength(3);
    for (const name of [
      'CRM Solar',
      'Solar Calculator',
      'Solar Engine Studio',
      'Off-Grid Designer',
    ]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it('vendedor não vê o status dos serviços e vê Engine/Off-Grid como "Sem acesso"', async () => {
    renderApp('/', { session: makeSession('SALESPERSON') });
    await screen.findByRole('heading', { name: /Olá, Eduardo/ });
    expect(screen.queryByText('Status dos serviços')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sem acesso')).toHaveLength(2);
  });

  it('sinaliza serviço fora do ar', async () => {
    server.use(
      http.get(`${API}/health`, () =>
        HttpResponse.json(
          {
            status: 'degraded',
            uptimeSeconds: 1,
            checks: {
              database: { status: 'up', latencyMs: 1 },
              redis: { status: 'down', latencyMs: 2000, error: 'timeout' },
              storage: { status: 'up', latencyMs: 1 },
            },
          },
          { status: 503 },
        ),
      ),
    );
    renderApp('/');
    expect(await screen.findByText('Não foi possível consultar o status.')).toBeInTheDocument();
  });
});
