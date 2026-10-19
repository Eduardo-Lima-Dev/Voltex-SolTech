import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { OpportunityDto } from '@voltex/shared';
import { boardHandler, opportunityPageHandlers, pipelineHandler } from '@/test/crm-handlers';
import { API, makeAccount, makeOpportunity, makeSession, page, stages } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const error = (status: number, code: string, message: string, data?: Record<string, unknown>) =>
  HttpResponse.json({ statusCode: status, code, message, ...(data ? { data } : {}) }, { status });

const items = [
  makeOpportunity({ id: 'opp-1', title: 'Casa da Maria', stage: 'NEW_LEAD' }),
  makeOpportunity({
    id: 'opp-2',
    title: 'Fábrica Alfa',
    stage: 'QUOTING',
    accountName: 'Alfa Ltda',
    projectCode: 'VLX-AAAA1111',
    openTaskCount: 2,
    nextTaskDueAt: '2099-01-01T12:00:00.000Z',
    ownerName: 'Ana Admin',
  }),
  makeOpportunity({
    id: 'opp-3',
    title: 'Sítio Beta',
    stage: 'LOST',
    status: 'LOST',
    lostReason: 'Preço',
  }),
];

describe('CRM · Quadro de oportunidades', () => {
  it('mostra uma coluna por etapa, com o total e os cartões', async () => {
    server.use(boardHandler(items), pipelineHandler());
    renderApp('/crm/oportunidades');
    expect(await screen.findByRole('region', { name: 'Etapa Novo lead' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Etapa / })).toHaveLength(15);

    const newLead = screen.getByRole('region', { name: 'Etapa Novo lead' });
    expect(within(newLead).getByRole('link', { name: 'Casa da Maria' })).toHaveAttribute(
      'href',
      '/crm/oportunidades/opp-1',
    );
    expect(within(newLead).getByText('VLX-7K3M9QX2')).toBeInTheDocument();
    expect(within(newLead).getByText('Sem próxima tarefa')).toBeInTheDocument();
    expect(within(newLead).getByLabelText('1 oportunidades')).toBeInTheDocument();

    const quoting = screen.getByRole('region', { name: 'Etapa Cotação' });
    expect(within(quoting).getByText(/Próxima tarefa/)).toBeInTheDocument();
    expect(within(quoting).queryByText('Sem próxima tarefa')).not.toBeInTheDocument();
    expect(within(quoting).getByText(/Ana Admin/)).toBeInTheDocument();
  });

  it('muda de etapa pelo seletor, que só oferece o que a máquina de estados permite', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      boardHandler(items),
      pipelineHandler(),
      http.post(`${API}/opportunities/opp-1/stage`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity({ stage: 'FIRST_CONTACT' }));
      }),
    );
    renderApp('/crm/oportunidades');
    const select = await screen.findByLabelText('Mover Casa da Maria para');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Mover para…', 'Primeiro contato', 'Qualificação', 'Perdido']);
    await userEvent.setup().selectOptions(select, 'FIRST_CONTACT');
    await waitFor(() => expect(body).toEqual({ stage: 'FIRST_CONTACT' }));
    expect(await screen.findByText('Movida para Primeiro contato')).toBeInTheDocument();
  });

  it('perdida exige o motivo antes de enviar', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      boardHandler(items),
      pipelineHandler(),
      http.post(`${API}/opportunities/opp-1/stage`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity({ stage: 'LOST', status: 'LOST' }));
      }),
    );
    renderApp('/crm/oportunidades');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Mover Casa da Maria para'), 'LOST');
    const dialog = await screen.findByRole('dialog');
    expect(body).toBeUndefined();
    const confirm = within(dialog).getByRole('button', { name: 'Marcar como perdida' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motivo da perda'), 'Foi para a concorrência');
    await user.click(confirm);
    await waitFor(() =>
      expect(body).toEqual({ stage: 'LOST', lostReason: 'Foi para a concorrência' }),
    );
  });

  it('erro da API ao mover aparece como aviso', async () => {
    server.use(
      boardHandler(items),
      pipelineHandler(),
      http.post(`${API}/opportunities/opp-1/stage`, () =>
        error(
          422,
          'INVALID_STAGE_TRANSITION',
          'Não é possível ir direto para esta etapa a partir da etapa atual',
        ),
      ),
    );
    renderApp('/crm/oportunidades');
    await userEvent
      .setup()
      .selectOptions(await screen.findByLabelText('Mover Casa da Maria para'), 'QUALIFICATION');
    expect(await screen.findByText(/Não é possível ir direto para esta etapa/)).toBeInTheDocument();
  });

  it('cartões fechados (ganho/perdido) não têm seletor; ganho não tem nem a alça de arrastar', async () => {
    server.use(
      boardHandler([
        ...items,
        makeOpportunity({ id: 'opp-4', title: 'Contrato Fechado', stage: 'WON', status: 'WON' }),
      ]),
      pipelineHandler(),
    );
    renderApp('/crm/oportunidades');
    await screen.findByText('Sítio Beta');
    expect(screen.queryByLabelText('Mover Sítio Beta para')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mover Contrato Fechado para')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Arrastar Contrato Fechado' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrastar Sítio Beta' })).toBeInTheDocument();
  });

  it('"Só as minhas" filtra o quadro pelo responsável', async () => {
    const owners: (string | null)[] = [];
    server.use(
      http.get(`${API}/opportunities/board`, ({ request }) => {
        owners.push(new URL(request.url).searchParams.get('ownerId'));
        return HttpResponse.json({ columns: [] });
      }),
      pipelineHandler(),
    );
    renderApp('/crm/oportunidades');
    await waitFor(() => expect(owners).toEqual([null]));
    await userEvent.setup().selectOptions(await screen.findByLabelText('Responsável'), 'mine');
    await waitFor(() => expect(owners.at(-1)).toBe('user-owner'));
  });

  it('erro de carregamento do quadro não quebra a tela', async () => {
    server.use(
      http.get(`${API}/opportunities/board`, () => error(500, 'INTERNAL', 'x')),
      pipelineHandler(),
    );
    renderApp('/crm/oportunidades');
    expect(await screen.findByText('Não foi possível carregar o quadro.')).toBeInTheDocument();
  });

  it('etapa renomeada pelo gestor aparece com o nome do tenant', async () => {
    const custom = stages().map((s) => (s.key === 'QUOTING' ? { ...s, name: 'Orçamento' } : s));
    server.use(
      http.get(`${API}/pipeline`, () => HttpResponse.json(custom)),
      http.get(`${API}/opportunities/board`, () =>
        HttpResponse.json({ columns: custom.map((stage) => ({ stage, total: 0, items: [] })) }),
      ),
    );
    renderApp('/crm/oportunidades');
    expect(await screen.findByRole('region', { name: 'Etapa Orçamento' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Etapa Cotação' })).not.toBeInTheDocument();
  });
});

describe('CRM · Lista de oportunidades', () => {
  const listHandler = (onRequest?: (p: URLSearchParams) => void) =>
    http.get(`${API}/opportunities`, ({ request }) => {
      onRequest?.(new URL(request.url).searchParams);
      return HttpResponse.json(page(items));
    });

  it('alterna para a lista (e lembra a escolha), com filtros enviados à API', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      boardHandler(items),
      pipelineHandler(),
      listHandler((p) => queries.push(p)),
    );
    const { unmount } = renderApp('/crm/oportunidades');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Lista' }));
    const row = await screen.findByRole('row', { name: /Fábrica Alfa/ });
    expect(within(row).getByText('Cotação')).toBeInTheDocument();
    expect(within(row).getByText(/Alfa Ltda/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Casa da Maria/ })).getByText('Sem próxima tarefa'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Buscar oportunidades'), 'alfa');
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('alfa'));
    await user.selectOptions(screen.getByLabelText('Filtrar por etapa'), 'QUOTING');
    await waitFor(() => expect(queries.at(-1)?.get('stage')).toBe('QUOTING'));
    await user.selectOptions(screen.getByLabelText('Filtrar por situação'), 'LOST');
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('LOST'));
    await user.selectOptions(screen.getByLabelText('Filtrar por tarefa'), 'none');
    await waitFor(() => expect(queries.at(-1)?.get('withoutNextTask')).toBe('true'));
    expect(queries.at(-1)?.get('page')).toBe('1');

    unmount();
    renderApp('/crm/oportunidades');
    expect(await screen.findByLabelText('Buscar oportunidades')).toBeInTheDocument();
  });
});

describe('CRM · Nova oportunidade', () => {
  it('busca a conta, escolhe imóvel e UC e abre a oportunidade criada', async () => {
    let body: Record<string, unknown> | undefined;
    const created = makeOpportunity({ id: 'opp-8', title: 'Casa nova' });
    const account = makeAccount();
    server.use(
      boardHandler([]),
      pipelineHandler(),
      http.get(`${API}/accounts`, () => HttpResponse.json(page([{ ...account }]))),
      http.get(`${API}/accounts/acc-1`, () => HttpResponse.json(account)),
      http.post(`${API}/opportunities`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(created, { status: 201 });
      }),
      ...opportunityPageHandlers(created),
      http.get(`${API}/tasks`, () => HttpResponse.json(page([]))),
    );
    const { router } = renderApp('/crm/oportunidades');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Nova oportunidade/ }));
    const dialog = await screen.findByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Criar oportunidade' });
    expect(create).toBeDisabled();
    await user.selectOptions(await within(dialog).findByLabelText('Conta'), 'acc-1');
    await user.selectOptions(await within(dialog).findByLabelText('Imóvel'), 'site-1');
    await user.type(within(dialog).getByLabelText('Título (opcional)'), 'Casa nova');
    await user.selectOptions(within(dialog).getByLabelText('Tipo de sistema'), 'HYBRID');
    await user.click(create);
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      accountId: 'acc-1',
      siteId: 'site-1',
      title: 'Casa nova',
      projectType: 'HYBRID',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/crm/oportunidades/opp-8'));
  });
});

describe('CRM · Página da oportunidade', () => {
  const open = (opp: OpportunityDto, session = makeSession('OWNER')) => {
    server.use(...opportunityPageHandlers(opp));
    return renderApp(`/crm/oportunidades/${opp.id}`, { session });
  };

  it('mostra título, Project ID, conta e a etapa com o nome do tenant', async () => {
    open(makeOpportunity({ stage: 'QUOTING' }));
    expect(
      await screen.findByRole('heading', { name: 'Casa da Maria', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByTitle('Project ID')).toHaveTextContent('VLX-7K3M9QX2');
    expect(screen.getAllByRole('link', { name: 'Maria Silva' })[0]).toHaveAttribute(
      'href',
      '/crm/contas/acc-1',
    );
    expect(screen.getAllByText('Cotação').length).toBeGreaterThan(0);
  });

  it('o seletor de etapa oferece só transições válidas e nunca "Ganho"', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API}/opportunities/opp-1/stage`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity({ stage: 'FIRST_CONTACT' }));
      }),
    );
    open(makeOpportunity());
    const select = await screen.findByLabelText('Mudar de etapa');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Mover para…', 'Primeiro contato', 'Qualificação', 'Perdido']);
    const contract = makeOpportunity({ id: 'opp-c', stage: 'CONTRACT' });
    expect(contract.stage).toBe('CONTRACT');
    await userEvent.setup().selectOptions(select, 'FIRST_CONTACT');
    await waitFor(() => expect(body).toEqual({ stage: 'FIRST_CONTACT' }));
  });

  it('de Contrato só há Crédito, Negociação e Perdido (Ganho vem do contrato assinado)', async () => {
    open(makeOpportunity({ id: 'opp-c', stage: 'CONTRACT' }));
    const select = await screen.findByLabelText('Mudar de etapa');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Mover para…', 'Crédito/financiamento', 'Negociação', 'Perdido']);
  });

  it('perdida mostra o motivo e permite reabrir; ganha não tem seletor nem edição', async () => {
    const { unmount } = open(
      makeOpportunity({ id: 'opp-l', stage: 'LOST', status: 'LOST', lostReason: 'Preço alto' }),
    );
    expect(await screen.findByText('Preço alto')).toBeInTheDocument();
    const select = await screen.findByLabelText('Mudar de etapa');
    expect(within(select).getByRole('option', { name: 'Reabrir em…' })).toBeInTheDocument();
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Reabrir em…', 'Primeiro contato', 'Qualificação']);
    unmount();

    open(makeOpportunity({ id: 'opp-w', stage: 'WON', status: 'WON' }));
    await screen.findByRole('heading', { name: 'Casa da Maria', level: 2 });
    expect(screen.queryByLabelText('Mudar de etapa')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
  });

  it('o resumo mostra imóvel, levantamento, UC e os próximos passos conforme o andamento', async () => {
    open(
      makeOpportunity({
        siteId: 'site-1',
        consumerUnitId: 'uc-1',
        openTaskCount: 1,
        nextTaskDueAt: '2099-01-01T12:00:00.000Z',
      }),
    );
    // O MSW usa o handler mais recente que casa: estes valem sobre os padrões de `open`.
    server.use(
      http.get(`${API}/energy-bills`, () =>
        HttpResponse.json([
          {
            id: 'b',
            status: 'VALIDATED',
            filename: 'f.pdf',
            createdAt: '2026-10-18T12:00:00.000Z',
          },
        ]),
      ),
      http.get(`${API}/opportunities/opp-1/calculations`, () =>
        HttpResponse.json([{ id: 'c', trafficLight: 'YELLOW' }]),
      ),
    );
    expect(await screen.findByText('Residência — Fortaleza/CE')).toBeInTheDocument();
    expect(screen.getByText(/Telha cerâmica · azimute 0° · inclinação 15°/)).toBeInTheDocument();
    expect(screen.getByText(/UC 12345678 · Enel Ceará · Grupo B/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByLabelText('Feito')).toHaveLength(4));
    expect(screen.getByText('Amarelo')).toBeInTheDocument();
  });

  it('sem nada feito, todos os passos aparecem pendentes', async () => {
    open(makeOpportunity());
    await screen.findByText('Próximos passos');
    await waitFor(() => expect(screen.getAllByLabelText('Pendente')).toHaveLength(4));
  });

  it('edita título, imóvel, UC e previsão', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch(`${API}/opportunities/opp-1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    open(makeOpportunity());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Editar/ }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Título'));
    await user.type(within(dialog).getByLabelText('Título'), 'Novo título');
    await user.selectOptions(await within(dialog).findByLabelText('Imóvel'), 'site-1');
    await user.selectOptions(within(dialog).getByLabelText('Unidade consumidora'), 'uc-1');
    await user.type(within(dialog).getByLabelText('Previsão de fechamento'), '2026-12-31');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(body).toEqual({
        title: 'Novo título',
        siteId: 'site-1',
        consumerUnitId: 'uc-1',
        expectedCloseDate: '2026-12-31',
      }),
    );
  });

  it('oportunidade inexistente mostra mensagem e caminho de volta', async () => {
    server.use(
      http.get(`${API}/opportunities/nada`, () => error(404, 'NOT_FOUND', 'x')),
      pipelineHandler(),
    );
    renderApp('/crm/oportunidades/nada');
    expect(await screen.findByText('Oportunidade não encontrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar às oportunidades' })).toBeInTheDocument();
  });

  it('engenharia só consulta: sem seletor de etapa, sem edição e sem abas de fatura/cálculo que não pode ver', async () => {
    open(makeOpportunity(), makeSession('ENGINEERING'));
    await screen.findByRole('heading', { name: 'Casa da Maria', level: 2 });
    expect(screen.queryByLabelText('Mudar de etapa')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Fatura' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cálculos' })).toBeInTheDocument();
  });
});
