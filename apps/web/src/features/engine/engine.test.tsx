import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
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
  priority: 'NORMAL',
  dueAt: null,
  overdue: false,
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
  cables: o.cables ?? [],
  protectionOverrides: o.protectionOverrides ?? [],
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
    review: {
      requireSecondReview: false,
      submittedById: null,
      submittedByName: null,
      reviewerId: null,
      reviewerName: null,
    },
    rules: {
      engineDesign: { ref: null, parameters: {} },
      engineCables: { ref: null, parameters: {}, tables: {} },
    },
    candidates: [],
    prices: {},
    labels: {},
    equipment: [],
    ...o,
  };
};

// Endpoints auxiliares da revisão: handlers específicos abaixo ainda sobrescrevem estes padrões.
beforeEach(() => {
  server.use(
    http.get(`${API}/engineering/versions/:id/comments`, () => HttpResponse.json([])),
    http.get(`${API}/engineering/versions/:id`, () => HttpResponse.json(version())),
    http.get(`${API}/engineering/projects/pj-1`, () => HttpResponse.json(detail())),
    http.get(`${API}/distributors`, () => HttpResponse.json([])),
  );
});

const detail = (o: Partial<EngineeringProjectDetailDto> = {}): EngineeringProjectDetailDto => ({
  ...project(),
  profile: {
    siteId: null,
    consumerUnitId: null,
    distributorId: null,
    targetKwp: null,
    generationClass: null,
    artType: null,
    artNumber: null,
    councilRegistration: null,
    requireSecondReview: false,
    signatoryName: null,
    councilType: null,
    councilState: null,
    artIssuedAt: null,
    notes: null,
  },
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
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Versões' }));
    expect(await screen.findByText('Enviada para revisão')).toBeInTheDocument();
    expect(screen.getByText('desatualizada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova versão' }));
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

  it('busca o módulo ao digitar: mostra de onde vem; aprovado entra direto, de fonte abre a prévia para importar', async () => {
    const searchCalls: string[] = [];
    mount(version({ design: design({ defaultModuleId: MODULE_ID }) }), [
      http.get(`${API}/catalog/search`, ({ request: req }) => {
        const q = new URL(req.url).searchParams;
        searchCalls.push(`${q.get('q')}|${q.get('kind')}`);
        return HttpResponse.json([
          {
            origin: 'CATALOG',
            id: MODULE_ID,
            kind: 'MODULE',
            manufacturer: 'Fab',
            model: 'FT-550',
            sourceLabel: 'Seu catálogo',
            detail: 'Módulo · aprovado',
            status: 'APPROVED',
          },
          {
            origin: 'LINK',
            id: 'doc-1',
            kind: 'MODULE',
            manufacturer: 'Jinko',
            model: 'Ficha JKM550M',
            sourceLabel: 'Distribuidor Exemplo',
            detail: 'Módulo · .PDF',
            fileType: 'pdf',
          },
        ]);
      }),
      http.post(`${API}/catalog/source-links/documents/doc-1/preview`, () =>
        HttpResponse.json({
          format: 'datasheet-pdf',
          candidates: [
            {
              kind: 'MODULE',
              manufacturer: 'Jinko',
              model: 'JKM550M',
              spec: { pmaxWp: 550 },
              origin: 'DATASHEET_PDF',
              fieldConfidence: {},
              issues: [],
              exists: false,
              missing: ['technology'],
            },
          ],
          errors: [],
          notes: ['Fonte: Distribuidor Exemplo — https://x.com/a.pdf'],
        }),
      ),
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /2\. Superfícies/ }));
    const box = await screen.findByLabelText('Buscar módulo (catálogo e fontes)');
    await user.type(box, 'jin');
    // Cada resultado diz de onde vem e o que é.
    expect(await screen.findByText('Seu catálogo')).toBeInTheDocument();
    expect(screen.getByText('Distribuidor Exemplo')).toBeInTheDocument();
    expect(screen.getByText(/Módulo · aprovado/)).toBeInTheDocument();
    expect(searchCalls.at(-1)).toBe('jin|MODULE');
    // Resultado de fonte: abre a prévia (nada é gravado antes da confirmação).
    await user.click(screen.getByRole('option', { name: /Ficha JKM550M/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Fonte: Distribuidor Exemplo/)).toBeInTheDocument();
    expect(within(dialog).getByText(/JKM550M/)).toBeInTheDocument();
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

  it('pede a revisão a um engenheiro ao enviar, e a segunda revisão obrigatória bloqueia a auto-aprovação', async () => {
    let body: { reviewerId?: string | null } | null = null;
    mount(
      version({
        status: 'DRAFT',
        review: {
          requireSecondReview: true,
          submittedById: null,
          submittedByName: null,
          reviewerId: null,
          reviewerName: null,
        },
      }),
      [
        http.get(`${API}/engineering/reviewers`, () =>
          HttpResponse.json([
            { id: 'user-engineering', name: 'Eu mesmo' },
            { id: 'u-lead', name: 'Lia Responsável' },
          ]),
        ),
        http.post(`${API}/engineering/versions/v-1/submit`, async ({ request }) => {
          body = (await request.json()) as typeof body;
          return HttpResponse.json(version({ status: 'SUBMITTED' }));
        }),
      ],
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Enviar para revisão' }));
    const select = await screen.findByLabelText('Pedir revisão a');
    // Com segunda revisão obrigatória a pessoa não aparece como revisora de si mesma.
    expect(within(select).queryByRole('option', { name: 'Eu mesmo' })).not.toBeInTheDocument();
    await user.selectOptions(select, 'Lia Responsável');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(body).toEqual({ reviewerId: 'u-lead' }));
  });

  it('versão enviada por mim em projeto com segunda revisão: Aprovar fica desabilitado', async () => {
    mount(
      version({
        status: 'SUBMITTED',
        review: {
          requireSecondReview: true,
          submittedById: 'user-engineering',
          submittedByName: 'Eu mesmo',
          reviewerId: 'u-lead',
          reviewerName: 'Lia Responsável',
        },
      }),
    );
    expect(await screen.findByText(/revisão pedida a Lia Responsável/)).toBeInTheDocument();
    expect(screen.getByText(/segunda revisão obrigatória/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeDisabled();
  });

  it('rascunho aberto por quem pode escrever tem os campos habilitados', async () => {
    mount(version());
    expect(await screen.findByLabelText(/Latitude/)).toBeEnabled();
  });

  it('compara com outra versão do projeto: indicadores e o que mudou no desenho', async () => {
    mount(version({ id: 'v-2', number: 2, status: 'SUBMITTED' }), [
      http.get(`${API}/engineering/projects/pj-1`, () =>
        HttpResponse.json(
          detail({
            versions: [
              {
                id: 'v-2',
                number: 2,
                status: 'SUBMITTED',
                stale: false,
                createdAt: now,
                decidedAt: null,
              },
              {
                id: 'v-1',
                number: 1,
                status: 'DRAFT',
                stale: false,
                createdAt: now,
                decidedAt: null,
              },
            ],
          }),
        ),
      ),
      http.get(`${API}/engineering/versions/v-2/compare`, ({ request: req }) => {
        expect(new URL(req.url).searchParams.get('with')).toBe('v-1');
        return HttpResponse.json({
          from: { id: 'v-1', number: 1, status: 'DRAFT' },
          to: { id: 'v-2', number: 2, status: 'SUBMITTED' },
          designChanges: [
            {
              section: 'surfaces',
              path: 'surfaces[s1].tiltDegrees',
              kind: 'CHANGED',
              before: 20,
              after: 25,
            },
          ],
          resultChanges: [{ metric: 'modules', label: 'Módulos', before: 8, after: 10, delta: 2 }],
          truncated: false,
        });
      }),
    ]);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Versão para comparar'), 'v-1');
    expect(await screen.findByText('surfaces[s1].tiltDegrees')).toBeInTheDocument();
    expect(screen.getByText('alterado')).toBeInTheDocument();
    expect(screen.getByText('Módulos')).toBeInTheDocument();
    expect(screen.getByText(/Da versão 1 para a versão 2/)).toBeInTheDocument();
  });

  it('versão aprovada gera o link do relatório do cliente (aparece uma vez) e permite revogar', async () => {
    let revoked = '';
    const link = {
      id: 'l-1',
      expiresAt: now,
      revokedAt: null,
      viewCount: 2,
      lastViewedAt: null,
      createdAt: now,
    };
    mount(version({ id: 'v-3', number: 3, status: 'APPROVED' }), [
      http.get(`${API}/engineering/versions/v-3/share-links`, () => HttpResponse.json([link])),
      http.post(`${API}/engineering/versions/v-3/share-links`, () =>
        HttpResponse.json(
          { ...link, id: 'l-2', token: 'tok123', path: '/r/tok123' },
          { status: 201 },
        ),
      ),
      http.post(`${API}/engineering/share-links/l-1/revoke`, () => {
        revoked = 'l-1';
        return HttpResponse.json({ ...link, revokedAt: now });
      }),
    ]);
    const user = userEvent.setup();
    expect(await screen.findByText(/2 visualização/)).toBeInTheDocument();
    server.use(
      http.post(`${API}/engineering/versions/v-3/attach-homologation`, () =>
        HttpResponse.json({
          projectId: 'p-1',
          attached: [{ code: 'MEMORIAL', documentId: 'd-1' }],
          skipped: [],
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Anexar à homologação' }));
    expect(
      await screen.findByText(/Anexado ao checklist de homologação: MEMORIAL/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Gerar link/ }));
    expect(await screen.findByText(/\/r\/tok123/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(revoked).toBe('l-1'));
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
    engineCables: { ref: null, parameters: {}, tables: {} },
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
    await user.click(await screen.findByRole('button', { name: /4\. Equipamentos e strings/ }));
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
    v.rules = {
      engineDesign: { ref: null, parameters: {} },
      engineCables: { ref: null, parameters: {}, tables: {} },
    };
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

describe('Engine: visualização 2D/3D', () => {
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
    obstacles: [
      { id: 'o1', name: 'Caixa d água', azimuthDegrees: 90, distanceM: 4, heightM: 3, widthM: 1.5 },
    ],
  };
  const openVisual = async (
    v = version({ design: design({ defaultModuleId: MODULE_ID, surfaces: [surface] }) }),
  ) => {
    server.use(
      http.get(`${API}/engineering/versions/v-1`, () => HttpResponse.json(v)),
      modulesList(),
    );
    renderApp('/engine/projetos/pj-1/versoes/v-1', { session: makeSession('ENGINEERING') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /3\. Visualização 2D\/3D/ }));
    return user;
  };

  it('planta 2D: mostra superfícies e obstáculos, seleciona e edita os detalhes', async () => {
    const user = await openVisual();
    expect(await screen.findByRole('img', { name: /Planta com 1 superfície/ })).toBeInTheDocument();
    expect(screen.getByText(/Clique numa superfície ou obstáculo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Superfície Água norte' }));
    expect(await screen.findByText('Superfície: Água norte')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Inclinação/)).toHaveValue('20');
    await user.click(screen.getByRole('button', { name: 'Obstáculo Caixa d água' }));
    expect(await screen.findByText('Obstáculo: Caixa d água')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Distância/)).toHaveValue('4');
    const height = screen.getByLabelText(/^Altura/);
    await user.clear(height);
    await user.type(height, '5');
    expect(height).toHaveValue('5');
  });

  it('setas do teclado movem a superfície (0,1 m; Shift 1 m) e o obstáculo na planta', async () => {
    const user = await openVisual();
    const roof = await screen.findByRole('button', { name: 'Superfície Água norte' });
    roof.focus();
    expect(await screen.findByLabelText(/Posição leste/)).toHaveValue('5'); // organização automática: x = metade da largura
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText(/Posição leste/)).toHaveValue('5,1');
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(screen.getByLabelText(/Posição norte/)).toHaveValue('1');
    // Obstáculo a leste (90°, 4 m): 1 m para o norte muda a direção e a distância.
    screen.getByRole('button', { name: 'Obstáculo Caixa d água' }).focus();
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(await screen.findByLabelText(/^Distância/)).not.toHaveValue('4');
    expect(screen.getByLabelText(/^Direção/)).not.toHaveValue('90');
  });

  it('versão congelada: só visualização, setas não movem e não há botões de adicionar', async () => {
    const user = await openVisual(
      version({
        status: 'SUBMITTED',
        design: design({ defaultModuleId: MODULE_ID, surfaces: [surface] }),
      }),
    );
    const roof = await screen.findByRole('button', { name: 'Superfície Água norte' });
    roof.focus();
    expect(await screen.findByLabelText(/Posição leste/)).toBeDisabled();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText(/Posição leste/)).toHaveValue('5');
    expect(screen.queryByRole('button', { name: /Adicionar superfície/ })).not.toBeInTheDocument();
  });

  it('adiciona superfície e obstáculo pela própria visualização', async () => {
    const user = await openVisual();
    await screen.findByRole('img', { name: /Planta com 1 superfície/ });
    await user.click(screen.getByRole('button', { name: /Adicionar superfície/ }));
    expect(await screen.findByRole('img', { name: /Planta com 2 superfície/ })).toBeInTheDocument();
    expect(screen.getByText('Superfície: Superfície 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Adicionar obstáculo/ }));
    expect(await screen.findByText('Obstáculo: Obstáculo')).toBeInTheDocument();
  });

  it('cena 3D: gira, aproxima, mostra o sol e seleciona clicando na superfície', async () => {
    const user = await openVisual();
    await user.click(await screen.findByRole('button', { name: '3D (cena)' }));
    const scene = await screen.findByRole('img', { name: /Cena 3D com 1 superfície/ });
    expect(scene.querySelectorAll('polygon').length).toBeGreaterThan(10); // chão, telhado, módulos, caixa e sombra
    expect(screen.getByText(/Sol: altura/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Data do sol'), '06-21');
    await user.click(screen.getByRole('button', { name: 'De cima' }));
    expect(screen.getByLabelText('Inclinar a câmera')).toHaveValue('90');
    expect(screen.getByLabelText('Aproximar')).toHaveValue('1');
    fireEvent.wheel(scene, { deltaY: -100 });
    expect(Number((screen.getByLabelText('Aproximar') as HTMLInputElement).value)).toBeGreaterThan(
      1,
    );
    const roof = Array.from(scene.querySelectorAll('polygon')).find(
      (p) => p.querySelector('title')?.textContent === 'Água norte',
    ) as SVGElement;
    await user.click(roof);
    expect(await screen.findByText('Superfície: Água norte')).toBeInTheDocument();
  });

  it('sem superfícies explica e oferece adicionar ou ir para Superfícies', async () => {
    const user = await openVisual(version());
    expect(await screen.findByText(/Ainda não há superfícies/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ir para Superfícies' }));
    expect(await screen.findByText(/Adicione uma superfície/)).toBeInTheDocument();
  });
});

const fullRequest = (o: Record<string, unknown> = {}) => ({
  ...request({ status: 'IN_PROGRESS', assigneeName: 'Ana', assigneeId: 'u-1' }),
  context: {
    account: { id: 'a-1', name: 'Maria Souza' },
    site: {
      id: 's-1',
      name: 'Residência',
      city: 'Brasília',
      state: 'DF',
      latitude: -15.78,
      longitude: -47.93,
      intake: {
        roofType: 'CERAMIC',
        roofAzimuthDegrees: 0,
        tiltDegrees: 20,
        shading: 'LOW',
        availableAreaM2: 40,
        entryBreakerAmps: 50,
        groundingAdequate: false,
      },
    },
    consumerUnit: {
      id: 'u-1',
      number: 'UC123',
      customerGroup: 'B',
      phaseSystem: 'TWO_PHASE',
      distributorName: 'Neoenergia',
    },
    calculation: {
      id: 'c-1',
      createdAt: now,
      systemKwp: 4.4,
      generationKwhYear: 7000,
      alerts: [{ severity: 'WARNING', message: 'Sombreamento relevante' }],
    },
    consumptionHistory: [
      { month: '2026-01', kwh: 400 },
      { month: '2026-02', kwh: 520 },
    ],
    seller: { id: 'v-1', name: 'Vera Vendas' },
  },
  events: [
    {
      id: 'e-1',
      type: 'COMMENT',
      text: 'Cliente tem árvore ao norte.',
      data: {},
      actorId: 'u-1',
      actorName: 'Ana',
      createdAt: now,
    },
  ],
  allowedTransitions: ['WAITING_VISIT', 'WAITING_INFO', 'IN_REVIEW', 'CANCELLED'],
  ...o,
});

describe('Engine: pedido de engenharia (9K)', () => {
  it('mostra o contexto do CRM, o andamento e age: muda o estado com motivo, pergunta ao vendedor e comenta', async () => {
    const bodies: Record<string, unknown> = {};
    server.use(
      http.get(`${API}/engineering/requests/rq-1`, () => HttpResponse.json(fullRequest())),
      http.post(`${API}/engineering/requests/rq-1/status`, async ({ request: req }) => {
        bodies.status = await req.json();
        return HttpResponse.json(request({ status: 'WAITING_VISIT' }));
      }),
      http.post(`${API}/engineering/requests/rq-1/info-requests`, async ({ request: req }) => {
        bodies.info = await req.json();
        return HttpResponse.json(fullRequest({ status: 'WAITING_INFO' }), { status: 201 });
      }),
      http.post(`${API}/engineering/requests/rq-1/comments`, async ({ request: req }) => {
        bodies.comment = await req.json();
        return HttpResponse.json(fullRequest(), { status: 201 });
      }),
    );
    renderApp('/engine/pedidos/rq-1', { session: makeSession('ENGINEERING') });
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: /Maria Souza/ })).toBeInTheDocument();
    // Contexto do CRM sem sair do pedido.
    expect(screen.getByText('Vera Vendas')).toBeInTheDocument();
    expect(screen.getByText('Neoenergia')).toBeInTheDocument();
    expect(screen.getByText('UC123')).toBeInTheDocument();
    expect(screen.getByText('50 A')).toBeInTheDocument();
    expect(screen.getByText('não')).toBeInTheDocument(); // aterramento
    expect(screen.getByText(/4,4 kWp · 7\.000 kWh\/ano/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Consumo dos últimos 2 meses/ })).toBeInTheDocument();
    expect(screen.getByText('Cliente tem árvore ao norte.')).toBeInTheDocument();

    // Aguardar visita exige o motivo.
    await user.click(screen.getByRole('button', { name: /aguardando visita/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Observação'), 'Visita na sexta');
    await user.click(confirm);
    await waitFor(() =>
      expect(bodies.status).toEqual({ status: 'WAITING_VISIT', note: 'Visita na sexta' }),
    );

    await user.click(screen.getByRole('button', { name: 'Pedir informação ao vendedor' }));
    const ask = await screen.findByRole('dialog');
    await user.type(within(ask).getByLabelText('Pergunta'), 'Qual a altura da árvore?');
    await user.click(within(ask).getByRole('button', { name: 'Enviar pergunta' }));
    await waitFor(() => expect(bodies.info).toEqual({ question: 'Qual a altura da árvore?' }));

    await user.type(screen.getByLabelText('Comentário'), 'Conferido');
    await user.click(screen.getByRole('button', { name: 'Comentar' }));
    await waitFor(() => expect(bodies.comment).toEqual({ text: 'Conferido' }));
  });

  it('prioridade e prazo só aparecem para quem coordena', async () => {
    server.use(
      http.get(`${API}/engineering/requests/rq-1`, () => HttpResponse.json(fullRequest())),
    );
    renderApp('/engine/pedidos/rq-1', { session: makeSession('ENGINEERING') });
    await screen.findByRole('heading', { name: /Maria Souza/ });
    expect(screen.queryByRole('button', { name: 'Prioridade e prazo' })).not.toBeInTheDocument();
  });

  it('o coordenador define prioridade e prazo e vê o painel da engenharia', async () => {
    let plan: unknown;
    server.use(
      http.get(`${API}/engineering/requests/rq-1`, () =>
        HttpResponse.json(fullRequest({ overdue: true, dueAt: '2026-10-01T12:00:00.000Z' })),
      ),
      http.patch(`${API}/engineering/requests/rq-1/plan`, async ({ request: req }) => {
        plan = await req.json();
        return HttpResponse.json(request({ status: 'IN_PROGRESS', priority: 'URGENT' }));
      }),
      http.get(`${API}/engineering/dashboard`, () =>
        HttpResponse.json({
          byStatus: { PENDING: 2, IN_PROGRESS: 3 },
          open: 5,
          overdue: 1,
          unassigned: 2,
          urgent: 1,
          avgResolutionDays: 4.5,
          byAssignee: [{ id: 'u-1', name: 'Ana', open: 3 }],
          projects: { inProgress: 4, approved: 2, cancelled: 0 },
          upcoming: [
            {
              id: 'rq-1',
              projectCode: 'VLT-2026-0001',
              customerName: 'Maria Souza',
              dueAt: now,
              priority: 'URGENT',
            },
          ],
        }),
      ),
    );
    renderApp('/engine/pedidos/rq-1', { session: makeSession('TECHNICAL_LEAD') });
    const user = userEvent.setup();
    expect(await screen.findByText(/Atrasado:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prioridade e prazo' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Prioridade'), 'URGENT');
    await user.clear(within(dialog).getByLabelText('Prazo'));
    await user.type(within(dialog).getByLabelText('Prazo'), '2026-11-05');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(plan).toMatchObject({ priority: 'URGENT' }));
    expect((plan as { dueAt: string }).dueAt).toMatch(/^2026-11-0[56]T/);
  });

  it('painel da engenharia: totais, estados, carga por engenheiro e próximos prazos', async () => {
    server.use(
      http.get(`${API}/engineering/dashboard`, () =>
        HttpResponse.json({
          byStatus: { PENDING: 2, IN_PROGRESS: 3 },
          open: 5,
          overdue: 1,
          unassigned: 2,
          urgent: 1,
          avgResolutionDays: 4.5,
          byAssignee: [{ id: 'u-1', name: 'Ana', open: 3 }],
          projects: { inProgress: 4, approved: 2, cancelled: 0 },
          upcoming: [
            {
              id: 'rq-1',
              projectCode: 'VLT-2026-0001',
              customerName: 'Maria Souza',
              dueAt: now,
              priority: 'URGENT',
            },
          ],
        }),
      ),
    );
    renderApp('/engine/painel', { session: makeSession('TECHNICAL_LEAD') });
    expect(await screen.findByText('Pedidos abertos')).toBeInTheDocument();
    expect(screen.getByText('4,5 d')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Pedidos por estado' })).getByText('Pendente'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Carga por engenheiro' })).getByText('3 em aberto'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Próximos prazos' })).getByText('Maria Souza'),
    ).toBeInTheDocument();
    expect(screen.getByText('Urgentes')).toBeInTheDocument();
  });

  it('a lista de pedidos mostra prioridade e prazo vencido e leva ao pedido', async () => {
    server.use(
      http.get(`${API}/engineering/requests`, () =>
        HttpResponse.json([
          request({
            status: 'WAITING_INFO',
            priority: 'URGENT',
            dueAt: '2026-10-01T12:00:00.000Z',
            overdue: true,
          }),
        ]),
      ),
    );
    renderApp('/engine/pedidos', { session: makeSession('ENGINEERING') });
    expect(await screen.findByText('Urgente')).toBeInTheDocument();
    expect(screen.getByText(/Atrasado/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver pedido' })).toHaveAttribute(
      'href',
      '/engine/pedidos/rq-1',
    );
  });
});

describe('Engine: projeto completo (9K)', () => {
  const survey = (over: Record<string, unknown> = {}) => ({
    status: 'DRAFT',
    data: {
      supply: {},
      grounding: {},
      roof: {},
      obstacles: [],
      loads: [],
      adequacies: [],
      photoDocumentIds: [],
    },
    missing: ['Data da visita', 'Disjuntor geral (A)'],
    completedAt: null,
    updatedAt: null,
    ...over,
  });
  const open = (extra: Parameters<typeof server.use>[0][] = []) => {
    server.use(
      http.get(`${API}/engineering/projects/pj-1`, () => HttpResponse.json(detail())),
      ...extra,
    );
    renderApp('/engine/projetos/pj-1', { session: makeSession('ENGINEERING') });
  };

  it('ficha: informa potência-alvo (classe), distribuidora e ART e salva', async () => {
    let patched: unknown;
    open([
      http.get(`${API}/distributors`, () =>
        HttpResponse.json([{ id: 'd-1', name: 'Neoenergia', state: 'DF' }]),
      ),
      http.patch(`${API}/engineering/projects/pj-1`, async ({ request: req }) => {
        patched = await req.json();
        return HttpResponse.json(detail());
      }),
    ]);
    const user = userEvent.setup();
    expect(await screen.findByLabelText('Nome do projeto')).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('Distribuidora'), 'd-1');
    await user.type(screen.getByLabelText(/Potência-alvo/), '150');
    expect(await screen.findByText(/Minigeração/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Responsabilidade técnica'), 'ART');
    await user.type(screen.getByLabelText(/Número da ART/), 'CE2026123');
    await user.click(screen.getByRole('button', { name: 'Salvar ficha' }));
    await waitFor(() =>
      expect(patched).toMatchObject({
        distributorId: 'd-1',
        targetKwp: 150,
        artType: 'ART',
        artNumber: 'CE2026123',
      }),
    );
  });

  it('levantamento: mostra o que falta, salva o rascunho e só conclui quando completo', async () => {
    let saved: { data: { supply?: { breakerA?: number } } } | undefined;
    let completed = 0;
    open([
      http.get(`${API}/engineering/projects/pj-1/survey`, () => HttpResponse.json(survey())),
      http.put(`${API}/engineering/projects/pj-1/survey`, async ({ request: req }) => {
        saved = (await req.json()) as typeof saved;
        return HttpResponse.json(survey());
      }),
      http.post(`${API}/engineering/projects/pj-1/survey/complete`, () => {
        completed += 1;
        return HttpResponse.json(survey({ status: 'COMPLETED', missing: [], completedAt: now }));
      }),
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Levantamento' }));
    expect(
      await screen.findByText(/Falta para concluir: Data da visita; Disjuntor geral \(A\)/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Disjuntor geral/), '50');
    await user.click(screen.getByRole('button', { name: 'Adicionar carga' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(saved?.data.supply?.breakerA).toBe(50));
    await user.click(screen.getByRole('button', { name: 'Concluir levantamento' }));
    await waitFor(() => expect(completed).toBe(1));
  });

  it('carga: mostra consumo, cargas da visita e a potência sugerida', async () => {
    open([
      http.get(`${API}/engineering/projects/pj-1/load-analysis`, () =>
        HttpResponse.json({
          monthly: [
            { month: '2026-01', kwh: 400 },
            { month: '2026-02', kwh: 520 },
          ],
          averageKwh: 460,
          maxKwh: 520,
          loads: [{ id: 'l1', name: 'Ar-condicionado', monthlyKwh: 432 }],
          loadsMonthlyKwh: 432,
          annualYieldKwhPerKwp: 1590,
          suggestedKwp: 3.47,
          notes: [
            'Sem cálculo preliminar com geração: não há rendimento por kWp para sugerir a potência.',
          ],
        }),
      ),
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Carga' }));
    expect(await screen.findByText('460 kWh/mês')).toBeInTheDocument();
    expect(screen.getByText('3,47 kWp')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Cargas levantadas' })).getByText('432 kWh/mês'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Sem cálculo preliminar/)).toBeInTheDocument();
  });

  it('documentos: mostra o pacote com a fonte, marca pronto e exige motivo para "não se aplica"', async () => {
    let body: unknown;
    const items = [
      {
        id: 'i1',
        code: 'FORM',
        title: 'Formulário de solicitação de acesso',
        description: null,
        required: true,
        position: 0,
        status: 'PENDING',
        documentId: null,
        note: null,
        source: 'energif-2023@1: EnergIF 2023, EF-R04 a',
        suggestion: null,
      },
      {
        id: 'i2',
        code: 'ART_TRT',
        title: 'ART ou TRT do projeto de execução',
        description: null,
        required: true,
        position: 1,
        status: 'PENDING',
        documentId: null,
        note: null,
        source: 'energif-2023@1: EF-R04 b',
        suggestion: 'Informe o número na ficha do projeto.',
      },
    ];
    open([
      http.get(`${API}/engineering/projects/pj-1/documents`, () => HttpResponse.json(items)),
      http.patch(`${API}/engineering/projects/pj-1/documents/FORM`, async ({ request: req }) => {
        body = await req.json();
        return HttpResponse.json(
          items.map((i) => (i.code === 'FORM' ? { ...i, status: 'READY' } : i)),
        );
      }),
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Documentos' }));
    expect(await screen.findByText(/0 de 2 obrigatórios prontos/)).toBeInTheDocument();
    expect(screen.getByText(/Fonte: energif-2023@1: EnergIF 2023, EF-R04 a/)).toBeInTheDocument();
    expect(screen.getByText('Informe o número na ficha do projeto.')).toBeInTheDocument();
    const row = screen
      .getByText('Formulário de solicitação de acesso')
      .closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Não se aplica' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Voltar' }));
    await user.click(within(row).getByRole('button', { name: 'Marcar pronto' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }),
    );
    await waitFor(() => expect(body).toMatchObject({ status: 'READY' }));
  });

  it('histórico do projeto junta o que aconteceu no pedido e no projeto', async () => {
    open([
      http.get(`${API}/engineering/projects/pj-1/timeline`, () =>
        HttpResponse.json([
          {
            id: 'e-2',
            type: 'SURVEY',
            text: 'Levantamento do local concluído',
            data: {},
            actorId: null,
            actorName: 'Carlos',
            createdAt: now,
          },
          {
            id: 'e-1',
            type: 'INFO_REQUEST',
            text: 'Qual a altura da árvore?',
            data: {},
            actorId: null,
            actorName: 'Ana',
            createdAt: now,
          },
        ]),
      ),
    ]);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Histórico' }));
    const list = await screen.findByRole('list', { name: 'Linha do tempo' });
    expect(within(list).getByText('Levantamento do local concluído')).toBeInTheDocument();
    expect(within(list).getByText('Pedido de informação')).toBeInTheDocument();
  });
});
