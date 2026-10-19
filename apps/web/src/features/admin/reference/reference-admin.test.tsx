import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  API,
  distributor,
  makeSession,
  page,
  ruleSet,
  solarResource,
  tariff,
} from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const apiError = (status: number, message = 'Erro') =>
  HttpResponse.json({ statusCode: status, code: 'ERR', message }, { status });

describe('Administração → Tarifas', () => {
  const base = (...overrides: Parameters<typeof server.use>) =>
    server.use(
      ...overrides,
      http.get(`${API}/distributors`, () => HttpResponse.json([distributor()])),
      http.get(`${API}/tariffs`, () => HttpResponse.json([tariff()])),
    );

  it('lista concessionárias e tarifas com valor, vigência e origem', async () => {
    base();
    renderApp('/admin/tarifas');
    expect(await screen.findByRole('heading', { name: 'Concessionárias' })).toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /Convencional/ });
    expect(within(row).getByText('Enel Ceará')).toBeInTheDocument();
    expect(within(row).getByText(/R\$ 0,955\/kWh/)).toBeInTheDocument();
    expect(within(row).getByText(/em diante/)).toBeInTheDocument();
    expect(within(row).getByText('Fatura do cliente')).toBeInTheDocument();
  });

  it('cadastra concessionária; nome repetido mostra o erro no campo', async () => {
    let calls = 0;
    base(
      http.post(`${API}/distributors`, async () => {
        calls += 1;
        return calls === 1
          ? apiError(409)
          : HttpResponse.json(distributor({ id: 'd-2' }), { status: 201 });
      }),
    );
    renderApp('/admin/tarifas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Nova concessionária/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'Enel Ceará');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Já existe uma concessionária com este nome.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('não exclui concessionária com tarifas: explica o motivo', async () => {
    base(http.delete(`${API}/distributors/d-1`, () => apiError(409)));
    renderApp('/admin/tarifas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Excluir Enel Ceará' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }),
    );
    expect(
      await screen.findByText(
        'Esta concessionária tem tarifas cadastradas. Exclua as tarifas antes.',
      ),
    ).toBeInTheDocument();
  });

  it('cadastra tarifa convertendo R$/kWh em centavos e exigindo a origem', async () => {
    let body: Record<string, unknown> | undefined;
    base(
      http.post(`${API}/tariffs`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(tariff({ id: 'tf-2' }), { status: 201 });
      }),
    );
    renderApp('/admin/tarifas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Nova tarifa/ }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar tarifa' }));
    expect(await within(dialog).findByText('Escolha a concessionária')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Informe um valor maior que zero (ex.: 0,95)'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Informe a origem do valor')).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.selectOptions(within(dialog).getByLabelText('Concessionária'), 'd-1');
    await user.type(within(dialog).getByLabelText('Tarifa de energia (R$/kWh)'), '0,9554');
    await user.type(within(dialog).getByLabelText('Vigência a partir de'), '2026-03-01');
    await user.type(within(dialog).getByLabelText('Origem do valor'), 'Resolução homologatória');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar tarifa' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      distributorId: 'd-1',
      customerGroup: 'B',
      energyCentsPerKwh: 95.54,
      validFrom: '2026-03-01',
      source: 'Resolução homologatória',
    });
    expect(body).not.toHaveProperty('validTo');
  });

  it('exclui uma tarifa depois de confirmar', async () => {
    let deleted = false;
    base(
      http.delete(
        `${API}/tariffs/tf-1`,
        () => ((deleted = true), HttpResponse.json({ id: 'tf-1' })),
      ),
    );
    renderApp('/admin/tarifas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Excluir tarifa de Enel Ceará' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/Cálculos e snapshots já salvos não mudam/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('sem concessionária, a tarifa não pode ser criada e a tela orienta', async () => {
    server.use(
      http.get(`${API}/distributors`, () => HttpResponse.json([])),
      http.get(`${API}/tariffs`, () => HttpResponse.json([])),
    );
    renderApp('/admin/tarifas');
    expect(await screen.findByText(/Cadastre uma concessionária para começar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nova tarifa/ })).toBeDisabled();
  });

  it('só quem gerencia regras acessa a aba; administrador tem acesso', async () => {
    renderApp('/admin/tarifas', { session: makeSession('ENGINEERING') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
});

describe('Administração → Tarifas → importar da ANEEL', () => {
  const baseline = () =>
    server.use(
      http.get(`${API}/distributors`, () => HttpResponse.json([])),
      http.get(`${API}/tariffs`, () => HttpResponse.json([])),
    );
  const result = {
    rowsRead: 655_289,
    distributorsCreated: 116,
    distributorsUpdated: 0,
    tariffsCreated: 107,
    tariffsUpdated: 0,
    tariffsUnchanged: 0,
    rowsSkipped: 82_562,
    source: {
      dataset: 'tarifas-distribuidoras-energia-eletrica',
      license: 'ODbL (Open Data Commons Open Database License)',
      url: 'https://dadosabertos.aneel.gov.br/x.csv',
    },
  };

  it('explica o que é importado (e que não inclui impostos) antes de rodar', async () => {
    baseline();
    renderApp('/admin/tarifas');
    await userEvent.setup().click(await screen.findByRole('button', { name: /Importar da ANEEL/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Valores sem impostos')).toBeInTheDocument();
    expect(within(dialog).getByText(/ICMS, PIS e COFINS/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Grupo B, subgrupo B1/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Ver a fonte/ })).toHaveAttribute(
      'href',
      'https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica',
    );
  });

  it('roda a importação e mostra o resumo com a fonte e a licença', async () => {
    let calls = 0;
    baseline();
    server.use(
      http.post(
        `${API}/reference-data/aneel/import`,
        () => ((calls += 1), HttpResponse.json(result)),
      ),
    );
    renderApp('/admin/tarifas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Importar da ANEEL/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Importar agora' }));
    expect(await within(dialog).findByText('Importação concluída')).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(within(dialog).getByText(/655\.289 linhas lidas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/116 novas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/107 novas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/licença ODbL/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Importar agora' }),
    ).not.toBeInTheDocument();
  });

  it('portal fora do ar mostra a mensagem do servidor e permite tentar de novo', async () => {
    baseline();
    server.use(
      http.post(`${API}/reference-data/aneel/import`, () =>
        HttpResponse.json(
          {
            statusCode: 503,
            code: 'ERR',
            message: 'Não foi possível acessar o portal de Dados Abertos da ANEEL',
          },
          { status: 503 },
        ),
      ),
    );
    renderApp('/admin/tarifas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Importar da ANEEL/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Importar agora' }),
    );
    expect(await screen.findByText(/O sistema encontrou um problema/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Importar agora' }),
    ).toBeEnabled();
  });

  it('só quem gerencia regras vê o botão', async () => {
    baseline();
    renderApp('/admin/tarifas', { session: makeSession('TECHNICAL_LEAD') });
    expect(await screen.findByRole('button', { name: /Importar da ANEEL/ })).toBeInTheDocument();
  });
});

describe('Administração → Irradiação', () => {
  const HEADER =
    'nome;uf;latitude;longitude;fonte;plano;jan;fev;mar;abr;mai;jun;jul;ago;set;out;nov;dez';
  const months = (v: string) => Array<string>(12).fill(v).join(';');
  const csvFile = (content: string) => new File([content], 'irradiacao.csv', { type: 'text/csv' });

  it('lista com HSP médio e fonte; busca com atraso envia o parâmetro', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/solar-resources`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([solarResource()]));
      }),
    );
    renderApp('/admin/irradiacao');
    const row = await screen.findByRole('row', { name: /Fortaleza/ });
    expect(within(row).getByText(/5,5 kWh\/m²·dia/)).toBeInTheDocument();
    expect(within(row).getByText(/CRESESB SunData/)).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Buscar irradiação'), 'forta');
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('forta'));
  });

  it('cadastro exige fonte e os 12 meses; envia números no formato da API', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/solar-resources`, () => HttpResponse.json(page([]))),
      http.post(`${API}/solar-resources`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(solarResource(), { status: 201 });
      }),
    );
    renderApp('/admin/irradiacao');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Novo local/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));
    expect(await within(dialog).findByText('Informe o nome do local')).toBeInTheDocument();
    expect(within(dialog).getByText(/Dado sem fonte não é aceito/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Informe os 12 meses/)).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.type(within(dialog).getByLabelText('Local'), 'Natal');
    await user.selectOptions(within(dialog).getByLabelText('UF'), 'RN');
    for (let i = 0; i < 12; i += 1)
      await user.type(
        within(dialog).getByLabelText(
          i === 0
            ? 'Jan'
            : ['Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i - 1]!,
        ),
        '5,6',
      );
    await user.type(within(dialog).getByLabelText('Origem do dado'), 'CRESESB SunData');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      name: 'Natal',
      state: 'RN',
      source: 'CRESESB SunData',
      hspMonthly: Array(12).fill(5.6),
    });
  });

  it('importa CSV válido: mostra a contagem e envia as linhas', async () => {
    let body: { rows: unknown[] } | undefined;
    server.use(
      http.get(`${API}/solar-resources`, () => HttpResponse.json(page([]))),
      http.post(`${API}/solar-resources/import`, async ({ request }) => {
        body = (await request.json()) as { rows: unknown[] };
        return HttpResponse.json({ created: 2, updated: 0 });
      }),
    );
    renderApp('/admin/irradiacao');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Importar planilha/ }));
    const dialog = await screen.findByRole('dialog');
    const csv = `${HEADER}\nNatal;RN;;;SunData;;${months('5,7')}\nRecife;PE;;;SunData;;${months('5,4')}`;
    await user.upload(within(dialog).getByLabelText('Arquivo da planilha (CSV)'), csvFile(csv));
    expect(await within(dialog).findByText(/2 local\(is\) válido\(s\)/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Importar 2' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body!.rows).toHaveLength(2);
    expect(body!.rows[0]).toMatchObject({ name: 'Natal', source: 'SunData' });
  });

  it('CSV com problemas lista os erros por linha e bloqueia o envio', async () => {
    server.use(http.get(`${API}/solar-resources`, () => HttpResponse.json(page([]))));
    renderApp('/admin/irradiacao');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Importar planilha/ }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(
      within(dialog).getByLabelText('Arquivo da planilha (CSV)'),
      csvFile(`${HEADER}\nNatal;RN;;;;;${months('5')}\nRecife;PE;;;SunData;;${months('5')}`),
    );
    expect(await within(dialog).findByText(/Linha 2 \(Natal\): fonte/)).toBeInTheDocument();
    expect(within(dialog).getByText('Corrija o arquivo e envie de novo')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Importar/ })).toBeDisabled();
  });

  it('exclui um local depois de confirmar', async () => {
    let deleted = false;
    server.use(
      http.get(`${API}/solar-resources`, () => HttpResponse.json(page([solarResource()]))),
      http.delete(
        `${API}/solar-resources/sr-1`,
        () => ((deleted = true), HttpResponse.json({ id: 'sr-1' })),
      ),
    );
    renderApp('/admin/irradiacao');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Excluir Fortaleza' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }),
    );
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('o modelo de CSV pode ser baixado', async () => {
    server.use(http.get(`${API}/solar-resources`, () => HttpResponse.json(page([]))));
    URL.createObjectURL = () => 'blob:modelo';
    URL.revokeObjectURL = () => undefined;
    renderApp('/admin/irradiacao');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Importar planilha/ }));
    await user.click(await screen.findByRole('button', { name: /Baixar modelo/ }));
  });
});

describe('Administração → Regras', () => {
  const effective = (overrides: Record<string, unknown> = {}) =>
    http.get(`${API}/rules/effective`, () =>
      HttpResponse.json({
        ref: 'builtin@1',
        key: 'calculator.rules',
        thresholds: {
          performanceRatioMin: 0.6,
          performanceRatioMax: 0.9,
          hspMin: 2,
          hspMax: 8,
          maxGenerationToConsumptionRatio: 1.3,
          defaultPerformanceRatio: 0.8,
          typicalHspMin: 4,
          typicalHspMax: 6.5,
          minRecommendedTiltDegrees: 10,
          orientationToleranceDegrees: 45,
          microgenerationMaxKw: 75,
          minigenerationMaxKw: 5000,
        },
        availabilityCostKwh: {},
        sources: [
          {
            type: 'BOOK',
            reference: 'EnergIF 2023, p. 67 (EF-M06)',
            notes: 'Pendente de confirmação',
          },
        ],
        ...overrides,
      }),
    );

  it('mostra a regra padrão do produto com limites, fontes e a ausência de custo de disponibilidade', async () => {
    server.use(
      effective(),
      http.get(`${API}/rules`, () => HttpResponse.json([])),
    );
    renderApp('/admin/regras');
    expect(await screen.findByText('Padrão do sistema')).toBeInTheDocument();
    expect(screen.getByText(/ainda não ativou regras próprias/)).toBeInTheDocument();
    expect(screen.getByText('Limite da microgeração')).toBeInTheDocument();
    expect(screen.getByText(/75 kW/)).toBeInTheDocument();
    expect(screen.getByText('Livro técnico')).toBeInTheDocument();
    expect(screen.getByText(/EnergIF 2023, p. 67/)).toBeInTheDocument();
    expect(screen.getByText(/o usuário informa o valor da fatura/)).toBeInTheDocument();
    expect(await screen.findByText(/Nenhuma versão própria criada/)).toBeInTheDocument();
  });

  it('mostra versões com situação, vigência e responsável pela revisão; custo por ligação', async () => {
    server.use(
      effective({ ref: 'rs-2@2', availabilityCostKwh: { SINGLE_PHASE: 30, THREE_PHASE: 100 } }),
      http.get(`${API}/rules`, () =>
        HttpResponse.json([
          ruleSet({ id: 'rs-2', version: 2 }),
          ruleSet({
            id: 'rs-1',
            version: 1,
            status: 'RETIRED',
            validTo: '2026-02-01T00:00:00.000Z',
          }),
          ruleSet({ id: 'rs-3', version: 3, status: 'DRAFT', validFrom: null, reviewedBy: null }),
        ]),
      ),
    );
    renderApp('/admin/regras');
    expect(await screen.findByText('rs-2@2')).toBeInTheDocument();
    expect(screen.queryByText(/Padrão do produto/)).not.toBeInTheDocument();
    expect(screen.getByText('Monofásico')).toBeInTheDocument();
    expect(screen.getByText('Trifásico')).toBeInTheDocument();
    const retired = await screen.findByRole('row', { name: /v1/ });
    expect(within(retired).getByText('Aposentada')).toBeInTheDocument();
    expect(
      within(await screen.findByRole('row', { name: /v3/ })).getByText('Sem revisão'),
    ).toBeInTheDocument();
    expect(
      within(await screen.findByRole('row', { name: /v2/ })).getByText('Ativa'),
    ).toBeInTheDocument();
  });

  it('engenharia (só leitura de regras) acessa Regras, mas não Tarifas nem Irradiação', async () => {
    server.use(
      effective(),
      http.get(`${API}/rules`, () => HttpResponse.json([])),
    );
    renderApp('/admin/regras', { session: makeSession('ENGINEERING') });
    expect(await screen.findByText('Padrão do sistema')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Seções da administração' });
    expect(within(nav).getByRole('link', { name: /Regras/ })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Tarifas/ })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Irradiação/ })).not.toBeInTheDocument();
  });

  it('erro de carregamento não quebra a tela', async () => {
    server.use(
      http.get(`${API}/rules/effective`, () => apiError(500)),
      http.get(`${API}/rules`, () => apiError(500)),
    );
    renderApp('/admin/regras');
    expect(
      await screen.findByText('Não foi possível carregar a regra em vigor.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Não foi possível carregar as versões.')).toBeInTheDocument();
  });
});
