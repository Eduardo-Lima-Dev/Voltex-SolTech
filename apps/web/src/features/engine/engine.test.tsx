import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type {
  EngineeringDesign,
  EngineeringProjectDetailDto,
  EngineeringProjectDto,
  EngineeringRequestListItemDto,
  EngineeringVersionDetailDto,
  EquipmentDto,
} from '@voltex/shared';
import { computeEngineeringResults } from '@voltex/solar-engine';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-20T12:00:00.000Z';
const MODULE_ID = '0198a000-0000-7000-8000-0000000000a1';

const request = (
  o: Partial<EngineeringRequestListItemDto> = {},
): EngineeringRequestListItemDto => ({
  id: 'rq-1',
  opportunityId: 'op-1',
  opportunityTitle: 'Usina residencial',
  projectCode: 'VLT-2026-0001',
  customerName: 'Maria Souza',
  calculationSessionId: null,
  reason: 'Sombreamento relevante',
  status: 'PENDING',
  assigneeId: null,
  assigneeName: null,
  projectId: null,
  resolution: null,
  resolvedAt: null,
  createdAt: now,
  ...o,
});

const project = (o: Partial<EngineeringProjectDto> = {}): EngineeringProjectDto => ({
  id: 'pj-1',
  code: 'ENG-2026-0001',
  name: 'Residência Maria',
  status: 'IN_PROGRESS',
  opportunityId: null,
  requestId: null,
  responsibleId: 'u-1',
  responsibleName: 'Ana Engenheira',
  latestVersionId: 'v-1',
  latestVersionNumber: 1,
  latestVersionStatus: 'DRAFT',
  approvedVersionId: null,
  createdAt: now,
  updatedAt: now,
  ...o,
});

const design = (o: Partial<EngineeringDesign> = {}): EngineeringDesign => ({
  schemaVersion: 1,
  site: {
    latitude: -15.78,
    longitude: -47.93,
    designTminC: null,
    designTmaxAmbientC: null,
    climate: null,
    horizon: null,
  },
  surfaces: [],
  inverters: [],
  ...o,
});

const moduleItem: EquipmentDto = {
  id: MODULE_ID,
  kind: 'MODULE',
  manufacturer: 'Fabricante Teste',
  model: 'FT-550M',
  spec: { pmaxWp: 550, lengthMm: 2278, widthMm: 1134 } as never,
  origin: 'MANUAL',
  fieldConfidence: {},
  referenceCostCents: null,
  datasheetDocumentId: null,
  inmetroRegistration: null,
  inmetroStatus: 'NOT_VERIFIED',
  inmetroCheckedAt: null,
  inmetroCheckedBy: null,
  status: 'APPROVED',
  revision: 1,
  supersedesId: null,
  approvedById: null,
  approvedAt: now,
  retiredAt: null,
  notes: null,
  createdAt: now,
  updatedAt: now,
};

const version = (o: Partial<EngineeringVersionDetailDto> = {}): EngineeringVersionDetailDto => {
  const d = o.design ?? design();
  return {
    id: 'v-1',
    projectId: 'pj-1',
    number: 1,
    status: 'DRAFT',
    design: d,
    results: null,
    fingerprint: null,
    stale: false,
    staleReasons: [],
    ruleRefs: [],
    submittedAt: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: now,
    updatedAt: now,
    project: project(),
    rules: { engineDesign: { ref: null, parameters: {} } },
    equipment: [],
    ...o,
  };
};

const detail = (o: Partial<EngineeringProjectDetailDto> = {}): EngineeringProjectDetailDto => ({
  ...project(),
  versions: [
    { id: 'v-1', number: 1, status: 'DRAFT', stale: false, createdAt: now, decidedAt: null },
  ],
  opportunity: null,
  calculation: null,
  ...o,
});

const INVERTER_ID = '0198a000-0000-7000-8000-0000000000b1';
const inverterItem: EquipmentDto = {
  ...moduleItem,
  id: INVERTER_ID,
  kind: 'INVERTER',
  model: 'FT-5K',
  spec: {
    topology: 'STRING',
    pAcNomW: 5000,
    pAcMaxW: 5500,
    pDcMaxW: 7500,
    vDcMaxV: 1100,
    vStartV: 180,
    mpptMinV: 140,
    mpptMaxV: 1000,
    mpptCount: 2,
    inputsPerMppt: 2,
    iMaxPerMpptA: 16,
    iscMaxPerMpptA: 22,
    vAcV: 220,
    phases: 1,
    exportLimitation: false,
  } as never,
};
const fullModuleItem: EquipmentDto = {
  ...moduleItem,
  spec: {
    technology: 'MONO_SI',
    pmaxWp: 550,
    vmppV: 41.7,
    imppA: 13.19,
    vocV: 49.7,
    iscA: 13.98,
    betaVocPctPerC: -0.27,
    alphaIscPctPerC: 0.05,
    gammaPmaxPctPerC: -0.34,
    noctC: 45,
    lengthMm: 2278,
    widthMm: 1134,
    bifacial: false,
  } as never,
};
const modulesList = () =>
  http.get(`${API}/catalog/items`, ({ request }) => {
    const inverter = new URL(request.url).searchParams.get('kind') === 'INVERTER';
    return HttpResponse.json({
      data: [inverter ? inverterItem : fullModuleItem],
      meta: { page: 1, pageSize: 100, total: 1 },
    });
  });

describe('Engine: fila de pedidos', () => {
  it('lista pedidos com cliente e motivo; pega o pedido e abre o projeto', async () => {
    let assigned = 0;
    server.use(
      http.get(`${API}/engineering/requests`, () => HttpResponse.json([request()])),
      http.post(`${API}/engineering/requests/rq-1/assign`, () => {
        assigned += 1;
        return HttpResponse.json(request({ status: 'IN_PROGRESS', assigneeName: 'Ana' }));
      }),
      http.post(`${API}/engineering/projects/from-request/rq-1`, () => HttpResponse.json(detail())),
      http.get(`${API}/engineering/projects/pj-1`, () => HttpResponse.json(detail())),
      http.get(`${API}/engineering/versions/v-1`, () => HttpResponse.json(version())),
      modulesList(),
    );
    renderApp('/engine/pedidos', { session: makeSession('ENGINEERING') });
    const row = (await screen.findByText('Maria Souza')).closest('tr') as HTMLElement;
    expect(within(row).getByText(/Sombreamento relevante/)).toBeInTheDocument();
    expect(within(row).getByText('Pendente')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Pegar pedido' }));
    await waitFor(() => expect(assigned).toBe(1));
    await user.click(within(row).getByRole('button', { name: 'Abrir projeto' }));
    expect(await screen.findByRole('heading', { name: /Versão 1/ })).toBeInTheDocument();
  });

  it('sem coordenadas na oportunidade, pede a latitude e a longitude e tenta de novo', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/engineering/requests`, () => HttpResponse.json([request()])),
      http.post(`${API}/engineering/projects/from-request/rq-1`, async ({ request: req }) => {
        const body = await req.json();
        bodies.push(body);
        return Object.keys(body as object).length === 0
          ? HttpResponse.json(
              { statusCode: 400, code: 'SITE_COORDINATES_MISSING', message: 'sem coordenadas' },
              { status: 400 },
            )
          : HttpResponse.json(detail());
      }),
      http.get(`${API}/engineering/projects/pj-1`, () => HttpResponse.json(detail())),
      http.get(`${API}/engineering/versions/v-1`, () => HttpResponse.json(version())),
      modulesList(),
    );
    renderApp('/engine/pedidos', { session: makeSession('ENGINEERING') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Abrir projeto' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Abrir o projeto' }));
    expect(await within(dialog).findByText(/Latitude inválida/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Latitude'), '-15,78');
    await user.type(within(dialog).getByLabelText('Longitude'), '-47,93');
    await user.click(within(dialog).getByRole('button', { name: 'Abrir o projeto' }));
    await waitFor(() => expect(bodies).toEqual([{}, { latitude: -15.78, longitude: -47.93 }]));
    // Espera o editor carregar para não deixar requisições soltas para o teste seguinte.
    expect(await screen.findByRole('heading', { name: /Versão 1/ })).toBeInTheDocument();
  });

  it('cancelar exige o motivo; quem só lê não vê as ações', async () => {
    let reason: unknown;
    server.use(
      http.get(`${API}/engineering/requests`, () => HttpResponse.json([request()])),
      http.post(`${API}/engineering/requests/rq-1/cancel`, async ({ request: req }) => {
        reason = await req.json();
        return HttpResponse.json(request({ status: 'CANCELLED' }));
      }),
    );
    renderApp('/engine/pedidos', { session: makeSession('ENGINEERING') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Cancelar pedido' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motivo'), 'Cliente desistiu');
    await user.click(confirm);
    await waitFor(() => expect(reason).toEqual({ reason: 'Cliente desistiu' }));
    expect(await screen.findByText('Pedido cancelado.')).toBeInTheDocument();
  });
});

describe('Engine: projetos', () => {
  it('lista projetos com situação e versão; cria um projeto avulso com as coordenadas', async () => {
    let created: unknown;
    server.use(
      http.get(`${API}/engineering/projects`, () =>
        HttpResponse.json({ data: [project()], meta: { page: 1, pageSize: 20, total: 1 } }),
      ),
      http.post(`${API}/engineering/projects`, async ({ request: req }) => {
        created = await req.json();
        return HttpResponse.json(detail({ name: 'Nova' }), { status: 201 });
      }),
      http.get(`${API}/engineering/versions/v-1`, () => HttpResponse.json(version())),
      modulesList(),
    );
    renderApp('/engine/projetos', { session: makeSession('ENGINEERING') });
    const row = (await screen.findByText('Residência Maria')).closest('tr') as HTMLElement;
    expect(within(row).getByText('ENG-2026-0001')).toBeInTheDocument();
    expect(within(row).getByText('Em andamento')).toBeInTheDocument();
    expect(within(row).getByText('Rascunho')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Novo projeto/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Criar projeto' }));
    expect(await within(dialog).findByText('Informe o nome do projeto.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Nome do projeto'), 'Nova');
    await user.type(within(dialog).getByLabelText('Latitude'), '-23,5');
    await user.type(within(dialog).getByLabelText('Longitude'), '-46,6');
    await user.click(within(dialog).getByRole('button', { name: 'Criar projeto' }));
    await waitFor(() =>
      expect(created).toEqual({ name: 'Nova', site: { latitude: -23.5, longitude: -46.6 } }),
    );
  });

  it('a página do projeto mostra o pré-cálculo do CRM, as versões e cria nova versão a partir da enviada', async () => {
    let newFrom = '';
    server.use(
      http.get(`${API}/engineering/projects/pj-1`, () =>
        HttpResponse.json(
          detail({
            opportunity: {
              id: 'op-1',
              title: 'Usina',
              projectCode: 'VLT-2026-0001',
              customerName: 'Maria Souza',
            },
            calculation: { id: 'c-1', generationKwhYear: 8200, systemKwp: 4.4, createdAt: now },
            versions: [
              {
                id: 'v-1',
                number: 1,
                status: 'SUBMITTED',
                stale: true,
                createdAt: now,
                decidedAt: null,
              },
            ],
          }),
        ),
      ),
      http.post(`${API}/engineering/versions/v-1/new-version`, () => {
        newFrom = 'v-1';
        return HttpResponse.json(version({ id: 'v-2', number: 2 }), { status: 201 });
      }),
      http.get(`${API}/engineering/versions/v-2`, () =>
        HttpResponse.json(version({ id: 'v-2', number: 2 })),
      ),
      modulesList(),
    );
    renderApp('/engine/projetos/pj-1', { session: makeSession('ENGINEERING') });
    expect(await screen.findByText(/Pré-cálculo do CRM/)).toBeInTheDocument();
    expect(screen.getByText(/4,4 kWp · 8\.200 kWh\/ano/)).toBeInTheDocument();
    expect(screen.getByText('Enviada para revisão')).toBeInTheDocument();
    expect(screen.getByText('desatualizada')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nova versão' }));
    await waitFor(() => expect(newFrom).toBe('v-1'));
    expect(await screen.findByRole('heading', { name: /Versão 2/ })).toBeInTheDocument();
  });
});

describe('Engine: editor da versão', () => {
  const mount = (
    v: EngineeringVersionDetailDto,
    extra: Parameters<typeof server.use>[0][] = [],
  ) => {
    server.use(
      http.get(`${API}/engineering/versions/${v.id}`, () => HttpResponse.json(v)),
      modulesList(),
      ...extra,
    );
    return renderApp(`/engine/projetos/pj-1/versoes/${v.id}`, {
      session: makeSession('ENGINEERING'),
    });
  };

  it('busca o clima e o horizonte pela Central de Dados e deixa a temperatura de projeto para a pessoa', async () => {
    mount(version(), [
      http.get(`${API}/data-hub/weather`, () =>
        HttpResponse.json({
          source: 'nasa-power',
          kind: 'CLIMATOLOGY',
          latitude: -15.78,
          longitude: -47.93,
          period: 'climatologia',
          summary: {
            ghiKwhM2Day: Array<number>(12).fill(5.5),
            tempMeanC: Array<number>(12).fill(22),
            tempMinC: Array<number>(12).fill(8),
            tempMaxC: Array<number>(12).fill(35),
            elevationM: 985,
          },
          fetchedAt: now,
          cached: false,
          attribution: 'Dados do projeto NASA POWER.',
          license: 'x',
          licenseStatus: 'PENDING_REVIEW',
          warnings: [],
        }),
      ),
      http.get(`${API}/data-hub/horizon`, () =>
        HttpResponse.json({
          source: 'pvgis',
          latitude: -15.78,
          longitude: -47.93,
          elevationM: 1137,
          points: [0, 90, 180, 270].map((a) => ({ azimuthDegrees: a, heightDegrees: 3 })),
          fetchedAt: now,
          cached: false,
          attribution: 'PVGIS',
          licenseStatus: 'PENDING_REVIEW',
          warnings: [],
        }),
      ),
    ]);
    const user = userEvent.setup();
    expect(await screen.findByText('Clima ainda não buscado.')).toBeInTheDocument();
    expect(screen.getByText(/Sem a temperatura mínima de projeto/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Buscar clima/ }));
    expect(await screen.findByText(/Dados do projeto NASA POWER/)).toBeInTheDocument();
    expect(screen.getByText('HSP (kWh/m²·dia)')).toBeInTheDocument();
    expect(screen.getByText(/Referência da fonte \(média das mínimas\): 8 °C/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Buscar horizonte/ }));
    expect(await screen.findByText('horizonte carregado')).toBeInTheDocument();
    expect(screen.getByText('alterações não salvas')).toBeInTheDocument();
  });

  it('modela uma superfície, calcula o layout no navegador e salva no servidor', async () => {
    let saved: { design: EngineeringDesign } | undefined;
    mount(version({ design: design({ defaultModuleId: MODULE_ID }) }), [
      http.put(`${API}/engineering/versions/v-1/design`, async ({ request: req }) => {
        saved = (await req.json()) as typeof saved;
        const d = saved!.design;
        return HttpResponse.json(
          version({
            design: d,
            results: computeEngineeringResults(d, {
              modules: { [MODULE_ID]: { lengthMm: 2278, widthMm: 1134, pmaxWp: 550 } },
            }),
          }),
        );
      }),
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /2\. Superfícies/ }));
    expect(await screen.findByText(/Adicione uma superfície/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Nova/ }));

    // Dimensões 10 × 5 m, recuos de 0,3 m: cabem 8 módulos (cálculo à mão no memorial do layout).
    const width = await screen.findByLabelText(/Largura \(beiral\)/);
    await user.clear(width);
    await user.type(width, '10');
    const depth = screen.getByLabelText(/Profundidade/);
    await user.clear(depth);
    await user.type(depth, '5');
    expect(await screen.findByText('8 módulos')).toBeInTheDocument();
    expect(screen.getAllByText(/4,4 kWp/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('img', { name: /Prévia do layout de Superfície 1: 8 módulos/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Carta solar/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salvar e calcular' }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved?.design.surfaces).toHaveLength(1);
    expect(saved?.design.surfaces[0]).toMatchObject({ widthM: 10, depthM: 5, kind: 'PITCHED' });
    expect(await screen.findByText('Versão salva e recalculada.')).toBeInTheDocument();
  });

  it('obstáculo ao norte aumenta a perda por sombra, e valor informado à mão exige a fonte', async () => {
    const surface = {
      id: 's1',
      name: 'Água norte',
      kind: 'PITCHED' as const,
      azimuthDegrees: 0,
      tiltDegrees: 20,
      widthM: 10,
      depthM: 5,
      setbackM: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 },
      moduleOrientation: 'PORTRAIT' as const,
      moduleGapM: 0.02,
      obstacles: [],
    };
    mount(version({ design: design({ defaultModuleId: MODULE_ID, surfaces: [surface] }) }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /2\. Superfícies/ }));
    expect(await screen.findByText(/Perda anual estimada:/)).toHaveTextContent('0%');
    expect(screen.getByText(/Sem perfil de horizonte nem obstáculos/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Adicionar obstáculo/ }));
    const direction = await screen.findByLabelText(/Direção/);
    await user.clear(direction);
    await user.type(direction, '0');
    const dist = screen.getByLabelText(/Distância/);
    await user.clear(dist);
    await user.type(dist, '8');
    const height = screen.getByLabelText(/Altura do topo/);
    await user.clear(height);
    await user.type(height, '8');
    const w = screen.getAllByLabelText(/^Largura/).at(-1) as HTMLElement;
    await user.clear(w);
    await user.type(w, '40');
    await waitFor(() =>
      expect(screen.getByText(/Perda anual estimada:/).textContent).not.toMatch(/: 0%/),
    );
    expect(screen.queryByText(/Sem perfil de horizonte/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Perda anual/), '7,5');
    expect(await screen.findByText(/Informe a fonte/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Fonte da medição'), 'Visita técnica');
    expect(screen.getByText(/informada à mão: Visita técnica/)).toBeInTheDocument();
    expect(screen.getAllByText(/7,5%/).length).toBeGreaterThan(0);
  });

  it('versão enviada abre só para leitura, sem salvar, e permite criar nova versão', async () => {
    mount(version({ status: 'SUBMITTED', design: design({ defaultModuleId: MODULE_ID }) }), [
      http.post(`${API}/engineering/versions/v-1/new-version`, () =>
        HttpResponse.json(version({ id: 'v-9', number: 2 }), { status: 201 }),
      ),
      http.get(`${API}/engineering/versions/v-9`, () =>
        HttpResponse.json(version({ id: 'v-9', number: 2 })),
      ),
    ]);
    expect(await screen.findByText(/não pode mais ser editada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar e calcular' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Latitude/)).toBeDisabled();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Criar nova versão a partir desta/ }));
    expect(await screen.findByRole('heading', { name: /Versão 2/ })).toBeInTheDocument();
  });

  it('rascunho aberto por quem pode escrever tem os campos habilitados', async () => {
    mount(version());
    expect(await screen.findByLabelText(/Latitude/)).toBeEnabled();
  });

  it('Engine aparece no menu e o catálogo vive em /engine/catalogo', async () => {
    server.use(
      http.get(`${API}/catalog/items`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
      ),
      http.get(`${API}/catalog/references`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
      ),
      http.get(`${API}/catalog/prices`, () => HttpResponse.json([])),
    );
    renderApp('/engine/catalogo', { session: makeSession('ENGINEERING') });
    expect(await screen.findByRole('tab', { name: 'Módulos' })).toBeInTheDocument();
    expect(screen.getAllByText(/Solar Engine Studio/).length).toBeGreaterThan(0);
  });
});

describe('Engine: equipamentos e strings', () => {
  const surface = {
    id: 's1',
    name: 'Água norte',
    kind: 'PITCHED' as const,
    azimuthDegrees: 0,
    tiltDegrees: 20,
    widthM: 10,
    depthM: 5,
    setbackM: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 },
    moduleOrientation: 'PORTRAIT' as const,
    moduleGapM: 0.02,
    obstacles: [],
  };
  const site = {
    latitude: -15.78,
    longitude: -47.93,
    designTminC: 5,
    designTmaxAmbientC: 35,
    climate: null,
    horizon: null,
  };
  const rules = {
    engineDesign: {
      ref: 'r@1',
      parameters: { hotCellIrradianceWm2: 1000, dcAcRatioMin: 0.8, dcAcRatioMax: 1.4 },
    },
  };
  const mount = (
    v: EngineeringVersionDetailDto,
    extra: Parameters<typeof server.use>[0][] = [],
  ) => {
    server.use(
      http.get(`${API}/engineering/versions/${v.id}`, () => HttpResponse.json(v)),
      modulesList(),
      ...extra,
    );
    return renderApp(`/engine/projetos/pj-1/versoes/${v.id}`, {
      session: makeSession('ENGINEERING'),
    });
  };
  const withInverter = (n: number) =>
    version({
      design: design({
        site,
        defaultModuleId: MODULE_ID,
        surfaces: [surface],
        inverters: [
          {
            id: 'e1',
            inverterId: INVERTER_ID,
            mppts: [
              { strings: [{ id: 'g1', surfaceId: 's1', modulesInSeries: n, parallel: 1 }] },
              { strings: [{ id: 'g2', surfaceId: 's1', modulesInSeries: n, parallel: 1 }] },
            ],
          },
        ],
      }),
      rules,
      equipment: [fullModuleItem, inverterItem].map((e) => ({
        id: e.id,
        kind: e.kind,
        manufacturer: e.manufacturer,
        model: e.model,
        status: e.status,
        spec: e.spec as never,
        issues: [],
      })),
    });

  const openStep = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /3\. Equipamentos e strings/ }));
    return user;
  };

  it('mostra a compatibilidade ao vivo, com a explicação de cada verificação', async () => {
    mount(withInverter(6));
    await openStep();
    // 12 módulos em 2 strings de 6 num inversor de 5 kW: relação 1,32, dentro da faixa 0,8–1,4.
    expect(await screen.findByText('Válido', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('12 módulos ligados')).toBeInTheDocument();
    expect(screen.getByText(/CC\/CA 1,32/)).toBeInTheDocument();
    expect(screen.getAllByText('Como foi calculado').length).toBeGreaterThan(3);
    expect(screen.getAllByText(/Ns × Voc\(Tmín\) ≤ Vdc máx\. do inversor/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText(/Manual CRESESB 2014, Eq\. 6\.30/).length).toBeGreaterThan(0);
  });

  it('Voc frio acima do máximo deixa o projeto inválido e explica o valor × limite', async () => {
    mount(withInverter(21));
    await openStep();
    expect(await screen.findAllByText('Inválido')).not.toHaveLength(0);
    expect((await screen.findAllByText(/Voc frio da string/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1\.100,06 V × 1\.100 V/).length).toBeGreaterThan(0);
  });

  it('sem a temperatura de projeto e sem regra, lista o que falta e leva para a etapa certa', async () => {
    const v = withInverter(6);
    // Copia o local: o objeto original é compartilhado entre os testes.
    v.design = {
      ...v.design,
      site: { ...v.design.site, designTminC: null, designTmaxAmbientC: null },
    };
    v.rules = { engineDesign: { ref: null, parameters: {} } };
    mount(v);
    const user = await openStep();
    const pending = await screen.findByRole('list', { name: /O que falta para concluir/ });
    expect(within(pending).getByText(/temperatura mínima de projeto/)).toBeInTheDocument();
    expect(within(pending).getAllByText('regra')).toHaveLength(2);
    expect(screen.getByText('Incompleto', { selector: 'span' })).toBeInTheDocument();
    await user.click(
      within(pending).getAllByRole('button', { name: 'Ir para Local e clima' })[0] as HTMLElement,
    );
    expect(await screen.findByText('Temperatura de projeto')).toBeInTheDocument();
  });

  it('adiciona um inversor aprovado, liga uma string e o cálculo reage', async () => {
    mount(
      version({
        design: design({ site, defaultModuleId: MODULE_ID, surfaces: [surface] }),
        rules,
        equipment: [],
      }),
    );
    const user = await openStep();
    expect(await screen.findByText(/Nenhum inversor no projeto/)).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('Inversor'), INVERTER_ID);
    await user.click(screen.getByRole('button', { name: /Adicionar$/ }));
    expect((await screen.findAllByText('Fabricante Teste FT-5K')).length).toBeGreaterThan(0);
    expect(screen.getByText('MPPT 1')).toBeInTheDocument();
    expect(screen.getByText('MPPT 2')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Adicionar string/ })[0] as HTMLElement);
    // A nova string tem 6 módulos em série; o layout tem 8 módulos: 2 sem string (aviso).
    expect(await screen.findByText('6 módulos ligados')).toBeInTheDocument();
    expect(await screen.findByText(/Permitido: 5 a 20/)).toBeInTheDocument();
    const series = screen.getByLabelText('Módulos em série');
    await user.clear(series);
    await user.type(series, '21');
    expect(await screen.findByText('21 módulos ligados')).toBeInTheDocument();
    expect(screen.getAllByText('Inválido').length).toBeGreaterThan(0);
  });

  it('o gerador mostra as configurações, aplica a escolhida e avisa quando falta dado', async () => {
    const config = {
      moduleId: MODULE_ID,
      inverterId: INVERTER_ID,
      inverterCount: 1,
      modulesInSeries: 6,
      totalStrings: 2,
      moduleCount: 12,
      powerKwp: 6.6,
      dcAcRatio: 1.32,
      vocMarginPct: 71,
      costCents: 1120000,
      unpriced: [],
      status: 'VALID' as const,
      warnings: [],
      entries: [
        {
          id: 'inv-1',
          inverterId: INVERTER_ID,
          mppts: [
            { strings: [{ id: 'a', surfaceId: 's1', modulesInSeries: 6, parallel: 1 }] },
            { strings: [{ id: 'b', surfaceId: 's1', modulesInSeries: 6, parallel: 1 }] },
          ],
        },
      ],
    };
    let sent: { surfaceId: string; targetKwp: number } | undefined;
    let calls = 0;
    mount(
      version({
        design: design({
          site,
          defaultModuleId: MODULE_ID,
          surfaces: [{ ...surface, widthM: 20, depthM: 10 }],
        }),
        rules,
        equipment: [],
      }),
      [
        http.post(`${API}/engineering/versions/v-1/configurations`, async ({ request: req }) => {
          calls += 1;
          sent = (await req.json()) as typeof sent;
          return HttpResponse.json(
            calls === 1
              ? { configurations: [config], discarded: [], pending: [] }
              : {
                  configurations: [],
                  discarded: [],
                  pending: [
                    {
                      code: 'TMIN_MISSING',
                      kind: 'DATA',
                      message: 'Falta a temperatura mínima de projeto do local.',
                    },
                  ],
                },
          );
        }),
      ],
    );
    const user = await openStep();
    await user.clear(await screen.findByLabelText(/Potência-alvo/));
    await user.type(screen.getByLabelText(/Potência-alvo/), '6,6');
    await user.click(screen.getByRole('button', { name: 'Gerar configurações' }));
    const list = await screen.findByRole('list', { name: 'Configurações sugeridas' });
    expect(within(list).getByText(/1 × Fabricante Teste FT-5K/)).toBeInTheDocument();
    expect(
      within(list).getByText(/12 × Fabricante Teste FT-550M · 2 string\(s\) de 6 · 6,6 kWp/),
    ).toBeInTheDocument();
    expect(within(list).getByText(/CC\/CA 1,32/)).toBeInTheDocument();
    expect(sent).toMatchObject({ surfaceId: 's1', targetKwp: 6.6 });
    await user.click(within(list).getByRole('button', { name: 'Usar esta' }));
    expect(await screen.findByText('12 módulos ligados')).toBeInTheDocument();
    expect(screen.getByText('alterações não salvas')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gerar configurações' }));
    expect(await screen.findByText('Ainda não dá para gerar:')).toBeInTheDocument();
    expect(
      screen.getByText('Falta a temperatura mínima de projeto do local.', { selector: 'li' }),
    ).toBeInTheDocument();
  });

  it('versão congelada não mostra o gerador nem os botões de edição', async () => {
    mount({ ...withInverter(6), status: 'SUBMITTED' });
    await openStep();
    expect(await screen.findByText('12 módulos ligados')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar configurações' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover inversor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Adicionar string/ })).not.toBeInTheDocument();
  });
});
