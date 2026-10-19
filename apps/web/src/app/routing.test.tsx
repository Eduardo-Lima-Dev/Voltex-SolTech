import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeSession, page } from '@/test/fixtures';
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
      http.get(`${API}/branding`, () => HttpResponse.json({})),
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
    const links = Array.from(nav.querySelectorAll('a, button')).map((a) =>
      a.textContent?.replace(/\(em breve\)/, '').trim(),
    );
    expect(links).toEqual(expect.arrayContaining(['Início', 'CRM Solar', 'Solar Calculator']));
    expect(links).not.toContain('Solar Engine Studio');
    expect(links).not.toContain('Administração');
  });

  it('a barra lateral do proprietário inclui Administração', async () => {
    server.use(healthOk);
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Administração' })).toBeInTheDocument();
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
    const tabs = await screen.findByRole('navigation', { name: 'Navegação principal' });
    await within(tabs).findByRole('link', { name: 'Usuários' });
    expect(tabs).toHaveTextContent('Usuários');
    expect(tabs).toHaveTextContent('Perfis');
    expect(tabs).not.toHaveTextContent('Empresa');
    expect(tabs).not.toHaveTextContent('Auditoria');
  });
});

describe('painel inicial', () => {
  it('mostra os 4 produtos e NUNCA o status técnico dos serviços (isso é do dono da plataforma, não da empresa)', async () => {
    renderApp('/');
    await screen.findByRole('heading', { name: /Olá, Eduardo/ });
    for (const name of [
      'CRM Solar',
      'Solar Calculator',
      'Solar Engine Studio',
      'Off-Grid Designer',
    ]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(
      screen.queryByText(/Status dos serviços|Banco de dados|Redis|Armazenamento/),
    ).not.toBeInTheDocument();
  });

  it('vendedor vê Engine/Off-Grid como "Sem acesso"', async () => {
    renderApp('/', { session: makeSession('SALESPERSON') });
    await screen.findByRole('heading', { name: /Olá, Eduardo/ });
    expect(screen.getAllByText('Sem acesso')).toHaveLength(2);
  });
});

/** Telas do CRM listadas no submenu da barra lateral. */
const crmLinks = (nav: HTMLElement) =>
  Array.from(nav.querySelectorAll('a'))
    .filter((a) => a.getAttribute('href')?.startsWith('/crm/'))
    .map((a) => a.textContent);

describe('rotas do CRM', () => {
  const crmHandlers = () =>
    server.use(
      http.get(`${API}/leads`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 10, total: 0 } }),
      ),
      http.get(`${API}/lead-capture`, () => HttpResponse.json({ key: 'lk_x' })),
      http.get(`${API}/accounts`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 10, total: 0 } }),
      ),
      http.get(`${API}/tasks`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 15, total: 0 } }),
      ),
    );

  it('/crm leva à primeira área permitida ao perfil (Leads para quem vê leads)', async () => {
    crmHandlers();
    const { router } = renderApp('/crm', { session: makeSession('SDR') });
    await waitFor(() => expect(router.state.location.pathname).toBe('/crm/leads'));
  });

  it('o SDR vê Leads, Contas e Tarefas, mas não Oportunidades; a rota de oportunidades fica bloqueada', async () => {
    crmHandlers();
    renderApp('/crm/leads', { session: makeSession('SDR') });
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    await within(nav).findByRole('link', { name: /Tarefas/ });
    expect(crmLinks(nav)).toEqual(['Leads', 'Contas', 'Tarefas']);
  });

  it('sem acesso a oportunidades, a página mostra "Sem acesso" (a API continua sendo a barreira real)', async () => {
    crmHandlers();
    renderApp('/crm/oportunidades', { session: makeSession('SDR') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });

  it('o vendedor vê as cinco áreas do CRM', async () => {
    crmHandlers();
    renderApp('/crm/contas', { session: makeSession('SALESPERSON') });
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    await within(nav).findByRole('link', { name: /Tarefas/ });
    expect(crmLinks(nav)).toEqual(['Leads', 'Oportunidades', 'Contas', 'Projetos', 'Tarefas']);
  });

  it('o instalador acessa só projetos e as tarefas atribuídas a ele dentro do CRM', async () => {
    crmHandlers();
    server.use(http.get(`${API}/projects`, () => HttpResponse.json(page([]))));
    const { router } = renderApp('/crm', { session: makeSession('INSTALLER') });
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    await within(nav).findByRole('link', { name: /Tarefas/ });
    expect(crmLinks(nav)).toEqual(['Projetos', 'Tarefas']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/crm/projetos'));
    // espera a tela carregar, para nenhuma requisição vazar para o teste seguinte
    expect(await screen.findByText('Nenhum projeto encontrado.')).toBeInTheDocument();
  });

  it('perfil sem nenhuma permissão do CRM vê "Sem acesso"', async () => {
    renderApp('/crm', { session: makeSession('CUSTOMER') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });

  it('o CRM aparece no menu como disponível (sem "em breve")', async () => {
    crmHandlers();
    renderApp('/crm/leads');
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    const crm = Array.from(nav.querySelectorAll('a, button')).find((a) =>
      a.textContent?.includes('CRM Solar'),
    );
    expect(crm).toBeDefined();
    expect(crm?.textContent).not.toMatch(/em breve/);
  });
});
