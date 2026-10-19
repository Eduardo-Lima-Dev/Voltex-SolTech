import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { opportunityPageHandlers } from '@/test/crm-handlers';
import {
  API,
  distributor,
  makeCalculation,
  makeConfig,
  makeContext,
  makeOpportunity,
  makeSession,
  makeSnapshot,
  page,
  referenceInput,
  solarResource,
  tariff,
} from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const wizardHandlers = (overrides: Parameters<typeof server.use> = []) => [
  ...overrides,
  http.get(`${API}/calculations/quick/config`, () => HttpResponse.json(makeConfig())),
  http.get(`${API}/solar-resources`, () => HttpResponse.json(page([solarResource()]))),
  http.get(`${API}/tariffs`, () => HttpResponse.json([tariff()])),
  http.get(`${API}/distributors`, () => HttpResponse.json([distributor()])),
];

describe('lista de cálculos', () => {
  it('mostra título, cliente, semáforo, potência, investimento e payback', async () => {
    server.use(
      http.get(`${API}/calculations/quick`, () => HttpResponse.json(page([makeCalculation()]))),
    );
    renderApp('/calculator', { session: makeSession('SALESPERSON') });
    const row = await screen.findByRole('row', { name: /Residência Silva/ });
    expect(within(row).getByText('João Silva')).toBeInTheDocument();
    expect(within(row).getByText('Pré-viável')).toBeInTheDocument();
    expect(within(row).getByText('4,4 kWp')).toBeInTheDocument();
    expect(within(row).getByText(/19\.800,00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Novo cálculo/ })).toHaveAttribute(
      'href',
      '/calculator/new',
    );
  });

  it('busca (com atraso) e filtro de semáforo viram parâmetros da API; página volta para 1', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/calculations/quick`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([makeCalculation()], 25));
      }),
    );
    renderApp('/calculator');
    await screen.findByText('Residência Silva');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Próxima/ }));
    await waitFor(() => expect(queries.at(-1)?.get('page')).toBe('2'));

    await user.type(screen.getByLabelText('Buscar cálculos'), 'silva');
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('silva'));
    expect(queries.at(-1)?.get('page')).toBe('1');
    await user.selectOptions(screen.getByLabelText('Filtrar por semáforo'), 'RED');
    await waitFor(() => expect(queries.at(-1)?.get('trafficLight')).toBe('RED'));
  });

  it('estados vazio, vazio com filtro e erro de carregamento', async () => {
    server.use(http.get(`${API}/calculations/quick`, () => HttpResponse.json(page([]))));
    const { unmount } = renderApp('/calculator');
    expect(await screen.findByText(/Nenhum cálculo ainda/)).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText('Filtrar por semáforo'), 'GREEN');
    expect(
      await screen.findByText(/Nenhum cálculo encontrado com esses filtros/),
    ).toBeInTheDocument();
    unmount();

    server.use(
      http.get(`${API}/calculations/quick`, () =>
        HttpResponse.json({ statusCode: 500, code: 'INTERNAL', message: 'x' }, { status: 500 }),
      ),
    );
    renderApp('/calculator');
    expect(await screen.findByText('Não foi possível carregar os cálculos.')).toBeInTheDocument();
  });

  it('perfil só de leitura vê a lista sem o botão de criar; sem permissão de leitura, nada', async () => {
    server.use(http.get(`${API}/calculations/quick`, () => HttpResponse.json(page([]))));
    const { unmount } = renderApp('/calculator', { session: makeSession('ENGINEERING') });
    await screen.findByText(/Nenhum cálculo ainda/);
    expect(screen.queryByRole('link', { name: /Novo cálculo/ })).not.toBeInTheDocument();
    unmount();

    renderApp('/calculator', { session: makeSession('INSTALLER') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });

  it('criar exige a permissão de criação', async () => {
    renderApp('/calculator/new', { session: makeSession('ENGINEERING') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
});

describe('wizard de novo cálculo', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(await screen.findByLabelText('HSP médio (kWh/m²·dia)'), '5');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));

    await user.type(await screen.findByLabelText('Jan'), '500');
    await user.click(screen.getByRole('button', { name: 'Repetir janeiro nos demais meses' }));
    await user.type(screen.getByLabelText('Custo de disponibilidade (kWh/mês)'), '30');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));

    await user.type(await screen.findByLabelText('Tarifa de energia (R$/kWh)'), '0,95');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));

    await user.type(await screen.findByLabelText('Potência do módulo (Wp)'), '550');
    await user.type(screen.getByLabelText('Área do módulo (m²)'), '2,58');
    await user.type(screen.getByLabelText('Custo do sistema (R$/Wp)'), '4,50');
    await user.type(screen.getByLabelText('Performance Ratio (PR)'), '0,80');
  };

  it('valida cada etapa antes de avançar, com mensagens por campo', async () => {
    server.use(...wizardHandlers());
    renderApp('/calculator/new');
    const user = userEvent.setup();
    await screen.findByLabelText('HSP médio (kWh/m²·dia)');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    expect(await screen.findByText('Campo obrigatório')).toBeInTheDocument();
    expect(screen.getByLabelText('HSP médio (kWh/m²·dia)')).toBeInvalid();
    expect(screen.getByText('Etapa 1 de 4')).toBeInTheDocument();

    await user.type(screen.getByLabelText('HSP médio (kWh/m²·dia)'), '5');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    expect(await screen.findByText('Etapa 2 de 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    expect(await screen.findByText('Informe o consumo de pelo menos um mês')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Voltar/ }));
    expect(await screen.findByText('Etapa 1 de 4')).toBeInTheDocument();
  });

  it('mostra o resultado em tempo real (mesmo motor) e salva enviando referências e entrada convertida', async () => {
    let body: Record<string, unknown> | undefined;
    const saved = makeCalculation({ id: 'calc-new' });
    server.use(
      ...wizardHandlers([
        http.post(`${API}/calculations/quick`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(saved, { status: 201 });
        }),
        http.get(`${API}/calculations/quick/calc-new`, () => HttpResponse.json(saved)),
        http.get(`${API}/calculations/quick/calc-new/snapshots`, () => HttpResponse.json([])),
      ]),
    );
    renderApp('/calculator/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Título (opcional)'), 'Residência Silva');
    await fill(user);

    const preview = screen.getByRole('complementary', { name: 'Resultado parcial' });
    expect(await within(preview).findByText('4,4 kWp')).toBeInTheDocument();
    expect(within(preview).getByText('Pré-viável')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Calcular e salvar/ }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ title: 'Residência Silva', references: {} });
    expect(body!.input).toMatchObject({
      consumptionMonthlyKwh: Array(12).fill(500),
      availabilityCostKwh: 30,
      hspMonthly: Array(12).fill(5),
      hspSource: 'MANUAL',
      tariffCentsPerKwh: 95,
      costPerWpCents: 450,
      performanceRatio: 0.8,
      modulePowerWp: 550,
    });
    // O cliente não envia limites: quem decide é a regra do servidor.
    expect(body!.input).not.toHaveProperty('thresholds');
    expect(
      await screen.findByRole('heading', { name: 'Residência Silva', level: 1 }),
    ).toBeInTheDocument();
  });

  it('escolher local e tarifa cadastrados preenche os valores e envia os ids como referência', async () => {
    let body: { references?: Record<string, string>; input?: Record<string, unknown> } | undefined;
    const saved = makeCalculation({ id: 'calc-ref' });
    server.use(
      ...wizardHandlers([
        http.post(`${API}/calculations/quick`, async ({ request }) => {
          body = (await request.json()) as typeof body;
          return HttpResponse.json(saved, { status: 201 });
        }),
        http.get(`${API}/calculations/quick/calc-ref`, () => HttpResponse.json(saved)),
        http.get(`${API}/calculations/quick/calc-ref/snapshots`, () => HttpResponse.json([])),
      ]),
    );
    renderApp('/calculator/new');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Local'), 'sr-1');
    expect(screen.getByText(/CRESESB SunData/)).toBeInTheDocument();
    expect(screen.queryByLabelText('HSP médio (kWh/m²·dia)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Próximo/ }));

    await user.type(await screen.findByLabelText('Jan'), '500');
    await user.click(screen.getByRole('button', { name: 'Repetir janeiro nos demais meses' }));
    await user.type(screen.getByLabelText('Custo de disponibilidade (kWh/mês)'), '30');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));

    await user.selectOptions(await screen.findByLabelText('Tarifa cadastrada'), 'tf-1');
    expect(screen.getByLabelText('Tarifa de energia (R$/kWh)')).toHaveValue('0,955');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));

    await user.type(await screen.findByLabelText('Potência do módulo (Wp)'), '550');
    await user.type(screen.getByLabelText('Área do módulo (m²)'), '2,58');
    await user.type(screen.getByLabelText('Custo do sistema (R$/Wp)'), '4,50');
    await user.click(screen.getByRole('button', { name: /Calcular e salvar/ }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body!.references).toEqual({ solarResourceId: 'sr-1', tariffId: 'tf-1' });
    expect(body!.input).toMatchObject({ hspSource: 'DATASET', tariffCentsPerKwh: 95.5 });
    // Espera a navegação terminar: requisições da próxima tela não podem vazar para o teste seguinte.
    await screen.findByRole('heading', { name: 'Residência Silva', level: 1 });
  });

  it('o custo de disponibilidade vem da regra conforme o tipo de ligação', async () => {
    server.use(
      ...wizardHandlers([
        http.get(`${API}/calculations/quick/config`, () =>
          HttpResponse.json(makeConfig({ availabilityCostKwh: { THREE_PHASE: 100 } })),
        ),
      ]),
    );
    renderApp('/calculator/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('HSP médio (kWh/m²·dia)'), '5');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    await user.selectOptions(await screen.findByLabelText('Tipo de ligação'), 'THREE_PHASE');
    expect(screen.getByLabelText('Custo de disponibilidade (kWh/mês)')).toHaveValue('100');
  });

  it('erro do servidor ao salvar aparece como aviso e mantém os dados', async () => {
    server.use(
      ...wizardHandlers([
        http.post(`${API}/calculations/quick`, () =>
          HttpResponse.json(
            { statusCode: 422, code: 'VALIDATION_ERROR', message: 'Dados inválidos' },
            { status: 422 },
          ),
        ),
      ]),
    );
    renderApp('/calculator/new');
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Calcular e salvar/ }));
    expect(await screen.findByText('Dados inválidos')).toBeInTheDocument();
    expect(screen.getByLabelText('Potência do módulo (Wp)')).toHaveValue('550');
  });
});

describe('detalhe do cálculo', () => {
  const detail = (calc = makeCalculation()) => [
    http.get(`${API}/calculations/quick/${calc.id}`, () => HttpResponse.json(calc)),
    http.get(`${API}/calculations/quick/${calc.id}/snapshots`, () => HttpResponse.json([])),
  ];

  it('mostra indicadores, semáforo, premissas e a origem dos dados', async () => {
    const calc = makeCalculation({
      references: {
        solarResource: {
          id: 'sr-1',
          name: 'Fortaleza',
          state: 'CE',
          source: 'CRESESB SunData',
          plane: 'Plano horizontal',
          overridden: true,
        },
        tariff: {
          id: 'tf-1',
          distributorName: 'Enel Ceará',
          customerGroup: 'B',
          energyCentsPerKwh: 95,
          validFrom: '2026-01-01T00:00:00.000Z',
          source: 'Fatura',
          overridden: false,
        },
      },
    });
    server.use(...detail(calc));
    renderApp(`/calculator/${calc.id}`, { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByRole('heading', { name: 'Residência Silva', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Potência instalada')).toBeInTheDocument();
    expect(screen.getByText('4,4 kWp')).toBeInTheDocument();
    // O score do motor vai de 0 a 100: aparece como porcentagem direta (e não multiplicada de novo).
    expect(screen.getByText(`${calc.result.confidenceScore}%`)).toBeInTheDocument();
    expect(screen.getByText('Premissas usadas')).toBeInTheDocument();
    expect(screen.getByText(/Performance Ratio \(PR\)/)).toBeInTheDocument();
    expect(screen.getByText(/Irradiação: Fortaleza/)).toBeInTheDocument();
    expect(screen.getByText('Alterado')).toBeInTheDocument();
    expect(screen.getByText(/Tarifa: Enel Ceará/)).toBeInTheDocument();
    expect(screen.getByText(/Estimativa preliminar/)).toBeInTheDocument();
  });

  it('alertas aparecem com título em português, ordenados do mais grave ao informativo', async () => {
    const calc = makeCalculation(
      {},
      referenceInput({ customerGroup: 'A', performanceRatio: undefined, availableAreaM2: 5 }),
    );
    server.use(...detail(calc));
    renderApp(`/calculator/${calc.id}`);
    await screen.findByRole('heading', { name: 'Residência Silva', level: 1 });
    expect(screen.getAllByText('Não recomendado').length).toBeGreaterThan(0);
    const section = screen.getByRole('region', { name: 'Alertas e pontos de atenção' });
    const titles = within(section)
      .getAllByRole('alert')
      .map((el) => el.textContent ?? '');
    expect(titles.some((t) => t.includes('Área insuficiente'))).toBe(true);
    expect(titles.some((t) => t.includes('Cliente do Grupo A'))).toBe(true);
    expect(titles.some((t) => t.includes('PR padrão em uso'))).toBe(true);
    const order = (needle: string) => titles.findIndex((t) => t.includes(needle));
    expect(order('Área insuficiente')).toBeLessThan(order('PR padrão em uso'));
  });

  it('salva um snapshot com observação e atualiza a lista de snapshots', async () => {
    const calc = makeCalculation();
    let note: unknown;
    let snapshots: ReturnType<typeof makeSnapshot>[] = [];
    server.use(
      http.get(`${API}/calculations/quick/${calc.id}`, () => HttpResponse.json(calc)),
      http.get(`${API}/calculations/quick/${calc.id}/snapshots`, () =>
        HttpResponse.json(snapshots),
      ),
      http.post(`${API}/calculations/quick/${calc.id}/snapshot`, async ({ request }) => {
        note = ((await request.json()) as { note?: string }).note;
        snapshots = [makeSnapshot({ note: 'Versão enviada ao cliente' })];
        return HttpResponse.json(snapshots[0], { status: 201 });
      }),
    );
    renderApp(`/calculator/${calc.id}`, { session: makeSession('SALESPERSON') });
    const user = userEvent.setup();
    expect(await screen.findByText('Nenhum snapshot salvo ainda.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Salvar snapshot/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/nunca muda/)).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText('Observação (opcional)'),
      'Versão enviada ao cliente',
    );
    await user.click(within(dialog).getByRole('button', { name: /Salvar snapshot/ }));
    expect(await screen.findByText('Versão enviada ao cliente')).toBeInTheDocument();
    expect(note).toBe('Versão enviada ao cliente');
    expect(screen.getByRole('link', { name: /Abrir/ })).toHaveAttribute(
      'href',
      '/calculator/snapshots/snap-1',
    );
  });

  it('SDR calcula mas não vê o botão de salvar snapshot', async () => {
    server.use(...detail());
    renderApp('/calculator/calc-1', { session: makeSession('SDR') });
    await screen.findByRole('heading', { name: 'Residência Silva', level: 1 });
    expect(screen.queryByRole('button', { name: /Salvar snapshot/ })).not.toBeInTheDocument();
  });

  it('cálculo inexistente mostra mensagem e caminho de volta', async () => {
    server.use(
      http.get(`${API}/calculations/quick/nada`, () =>
        HttpResponse.json(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Cálculo não encontrado' },
          { status: 404 },
        ),
      ),
    );
    renderApp('/calculator/nada');
    expect(await screen.findByText('Cálculo não encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar aos cálculos' })).toBeInTheDocument();
  });
});

describe('página do snapshot', () => {
  it('mostra o registro congelado com observação, regra e versão do algoritmo', async () => {
    server.use(
      http.get(`${API}/calculations/quick/snapshots/snap-1`, () =>
        HttpResponse.json(makeSnapshot()),
      ),
    );
    renderApp('/calculator/snapshots/snap-1');
    expect(await screen.findByText('Enviado ao cliente')).toBeInTheDocument();
    expect(screen.getByText(/Este registro é imutável/)).toBeInTheDocument();
    expect(screen.getByText(/regra builtin@1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver cálculo original' })).toHaveAttribute(
      'href',
      '/calculator/calc-1',
    );
  });
});

describe('wizard a partir da oportunidade', () => {
  const contextHandler = (overrides: Parameters<typeof makeContext>[0] = {}) =>
    http.get(`${API}/opportunities/opp-1/calculation-context`, () =>
      HttpResponse.json(makeContext(overrides)),
    );

  it('abre pré-preenchido com a fatura validada, o imóvel e a tarifa, e avisa de onde vêm os dados', async () => {
    server.use(...wizardHandlers([contextHandler()]));
    renderApp('/calculator/new?opportunityId=opp-1');
    expect(await screen.findByText(/Cálculo da oportunidade/)).toBeInTheDocument();
    expect(
      await screen.findByText(/Preenchido com a fatura validada, o imóvel e a tarifa/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Título (opcional)')).toHaveValue('Casa da Maria'),
    );
    expect(screen.getByLabelText('Cliente (opcional)')).toHaveValue('Maria Silva');
    expect(screen.getByLabelText('Latitude (°)')).toHaveValue('-3,73');
    expect(screen.getByLabelText('Azimute do telhado (°)')).toHaveValue('0');
    expect(screen.getByLabelText('Inclinação (°)')).toHaveValue('15');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('HSP médio (kWh/m²·dia)'), '5');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    // O consumo da fatura cai no mês do calendário correspondente (março e abril).
    expect(await screen.findByLabelText('Mar')).toHaveValue('480');
    expect(screen.getByLabelText('Abr')).toHaveValue('450');
    expect(screen.getByLabelText('Jan')).toHaveValue('');
    expect(screen.getByLabelText('Tipo de ligação')).toHaveValue('TWO_PHASE');
  });

  it('salva o cálculo VINCULADO à oportunidade (com a tarifa do cadastro como referência) e volta para ela', async () => {
    let body: { references?: Record<string, string>; input?: Record<string, unknown> } | undefined;
    const saved = makeCalculation({ id: 'calc-opp', opportunityId: 'opp-1' });
    server.use(
      ...wizardHandlers([
        contextHandler(),
        http.post(`${API}/opportunities/opp-1/calculations`, async ({ request }) => {
          body = (await request.json()) as typeof body;
          return HttpResponse.json(saved, { status: 201 });
        }),
      ]),
      ...opportunityPageHandlers(makeOpportunity()),
      http.get(`${API}/tasks`, () => HttpResponse.json(page([]))),
    );
    const { router } = renderApp('/calculator/new?opportunityId=opp-1');
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByLabelText('Título (opcional)')).toHaveValue('Casa da Maria'),
    );
    await user.type(screen.getByLabelText('HSP médio (kWh/m²·dia)'), '5');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    await user.type(await screen.findByLabelText('Custo de disponibilidade (kWh/mês)'), '30');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    expect(await screen.findByLabelText('Tarifa de energia (R$/kWh)')).toHaveValue('0,985');
    expect(screen.getByLabelText('Tarifa cadastrada')).toHaveValue('tf-1');
    await user.click(screen.getByRole('button', { name: /Próximo/ }));
    await user.type(await screen.findByLabelText('Potência do módulo (Wp)'), '550');
    await user.type(screen.getByLabelText('Área do módulo (m²)'), '2,58');
    await user.type(screen.getByLabelText('Custo do sistema (R$/Wp)'), '4,50');
    await user.click(screen.getByRole('button', { name: /Calcular e salvar/ }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body!.references).toMatchObject({ tariffId: 'tf-1' });
    expect(body!.input).toMatchObject({
      tariffCentsPerKwh: 98.5,
      customerGroup: 'B',
      latitude: -3.73,
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/crm/oportunidades/opp-1'));
  });

  it('sem fatura validada avisa que o consumo precisa ser informado à mão', async () => {
    server.use(
      ...wizardHandlers([
        contextHandler({
          billSnapshotId: null,
          consumptionHistory: [],
          consumptionMonthlyKwh: [],
          tariffCentsPerKwh: null,
          tariffId: null,
        }),
      ]),
    );
    renderApp('/calculator/new?opportunityId=opp-1');
    expect(await screen.findByText(/Ainda não há fatura validada/)).toBeInTheDocument();
  });

  it('se o contexto falhar, o wizard continua utilizável com preenchimento manual', async () => {
    server.use(
      ...wizardHandlers([
        http.get(`${API}/opportunities/opp-1/calculation-context`, () =>
          HttpResponse.json({ statusCode: 404, code: 'NOT_FOUND', message: 'x' }, { status: 404 }),
        ),
      ]),
    );
    renderApp('/calculator/new?opportunityId=opp-1');
    expect(
      await screen.findByText(/Não foi possível carregar os dados da oportunidade/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('HSP médio (kWh/m²·dia)')).toBeInTheDocument();
  });
});
