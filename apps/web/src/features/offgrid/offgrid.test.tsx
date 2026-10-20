import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  newOffgridDesign,
  type EquipmentDto,
  type OffgridProjectDetailDto,
  type OffgridRequestDetailDto,
  type OffgridRequestDto,
  type OffgridVersionDetailDto,
} from '@voltex/shared';
import { computeOffgridResults } from '@voltex/solar-engine';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-20T12:00:00.000Z';
const IDS = {
  module: '0198a000-0000-7000-8000-0000000000a1',
  battery: '0198a000-0000-7000-8000-0000000000a2',
  controller: '0198a000-0000-7000-8000-0000000000a3',
  inverter: '0198a000-0000-7000-8000-0000000000a4',
};

const item = (id: string, kind: string, model: string, spec: object): EquipmentDto => ({
  id,
  kind: kind as EquipmentDto['kind'],
  manufacturer: 'Fab',
  model,
  spec: spec as never,
  origin: 'MANUAL',
  fieldConfidence: {},
  referenceCostCents: 100_000,
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
});

const catalog = [
  item(IDS.module, 'MODULE', 'M550', {
    technology: 'MONO_SI',
    pmaxWp: 550,
    vmppV: 41.5,
    imppA: 13.25,
    vocV: 49.5,
    iscA: 14,
    betaVocPctPerC: -0.27,
    alphaIscPctPerC: 0.05,
    gammaPmaxPctPerC: -0.35,
    lengthMm: 2278,
    widthMm: 1134,
  }),
  item(IDS.battery, 'BATTERY', 'LFP100', {
    chemistry: 'LFP',
    nominalVoltageV: 51.2,
    capacityAh: 100,
    capacityHours: 5,
    maxDodPct: 90,
    maxChargeCurrentA: 50,
  }),
  item(IDS.controller, 'CHARGE_CONTROLLER', 'MPPT60', {
    technology: 'MPPT',
    batteryVoltageV: 48,
    ratedChargeCurrentA: 60,
    pvVocMaxV: 250,
    mpptMinV: 60,
    mpptMaxV: 230,
  }),
  item(IDS.inverter, 'OFFGRID_INVERTER', 'INV3K', {
    topology: 'OFFGRID',
    batteryVoltageV: 48,
    pContinuousW: 3000,
    pSurgeW: 6000,
    vAcV: 220,
    phases: 1,
    sineWave: true,
  }),
];

const GHI = [5.6, 5.8, 5.4, 5.3, 4.9, 4.7, 5.0, 5.8, 5.6, 5.8, 5.4, 5.4];
const site = {
  latitude: -15.8,
  longitude: -47.9,
  designTminC: 5,
  designTmaxAmbientC: 35,
  climate: {
    source: 'nasa-power' as const,
    period: '2001-2020',
    fetchedAt: now,
    ghiKwhM2Day: GHI,
    tempMeanC: Array(12).fill(24),
    tempMinC: Array(12).fill(18),
    tempMaxC: Array(12).fill(30),
  },
};
const PARAMS = {
  red1Default: 0.75,
  red2Default: 0.9,
  batteryEfficiencyDefault: 0.86,
  inverterEfficiencyMin: 0.85,
  autonomyMinDays: 2,
  dodMaxLeadFlooded: 50,
  dodMaxLeadVrla: 50,
  dodMaxStationary: 80,
  dodMaxLithium: 80,
  controllerCurrentFactor: 1.25,
  vocColdFactor: 1,
  inverterSurgeMargin: 0.25,
  maxBatteriesParallel: 4,
  maxChargeCRate: 0.2,
  lolpMaxPct: 5,
  chargeVoltageFactor: 1.2,
  pvOtherLossFactor: 0.95,
};

const request = (o: Partial<OffgridRequestDto> = {}): OffgridRequestDto => ({
  id: 'rq-1',
  title: 'Chalé isolado',
  description: null,
  systemType: 'OFFGRID',
  status: 'PENDING',
  priority: 'NORMAL',
  dueAt: null,
  assigneeId: null,
  assigneeName: null,
  projectId: null,
  opportunityId: null,
  resolution: null,
  resolvedAt: null,
  createdAt: now,
  updatedAt: now,
  ...o,
});

const project = {
  id: 'pj-1',
  code: 'OFG-2026-0001',
  name: 'Chalé do Vale',
  systemType: 'OFFGRID' as const,
  status: 'IN_PROGRESS' as const,
  opportunityId: null,
  responsibleId: null,
  artType: null,
  artNumber: null,
  notes: null,
  currentVersion: { id: 'v-1', number: 1, status: 'DRAFT' as const },
  createdAt: now,
  updatedAt: now,
};
const projectDetail = (o: Partial<OffgridProjectDetailDto> = {}): OffgridProjectDetailDto => ({
  ...project,
  versions: [
    { id: 'v-1', number: 1, status: 'DRAFT', stale: false, createdAt: now, decidedAt: null },
  ],
  events: [],
  openRequests: [],
  ...o,
});

const fullDesign = () =>
  ({
    ...newOffgridDesign(site),
    loads: [
      {
        id: 'l1',
        name: 'Geladeira',
        powerW: 120,
        quantity: 1,
        kind: 'AC',
        hoursPerDay: 12,
        windowStartHour: 0,
        windowEndHour: 24,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        seasonality: Array(12).fill(1),
        surgeFactor: 4,
        simultaneity: 1,
        critical: true,
      },
    ],
    arrays: [
      {
        id: 'a1',
        name: 'Telhado',
        moduleId: IDS.module,
        modulesInSeries: 4,
        parallelStrings: 1,
        azimuthDegrees: 0,
        tiltDegrees: 16,
        shadingLossPct: 0,
      },
    ],
    bank: { batteryId: IDS.battery, seriesCount: 1, parallelCount: 2, temperatureC: 25 },
    controllerId: IDS.controller,
    inverterId: IDS.inverter,
  }) as ReturnType<typeof newOffgridDesign>;

const version = (o: Partial<OffgridVersionDetailDto> = {}): OffgridVersionDetailDto => ({
  id: 'v-1',
  projectId: 'pj-1',
  number: 1,
  status: 'DRAFT',
  design: fullDesign(),
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
  catalog: {
    ruleRef: 'r@1',
    parameters: PARAMS,
    items: catalog.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: 'APPROVED' as const,
      label: `Fab ${c.model}`,
      spec: c.spec as never,
      priceCents: 100_000,
    })),
  },
  project: { id: 'pj-1', code: 'OFG-2026-0001', name: 'Chalé do Vale', systemType: 'OFFGRID' },
  openComments: 0,
  canApprove: false,
  ...o,
});

beforeEach(() => {
  server.use(
    http.get(`${API}/offgrid/projects/pj-1`, () => HttpResponse.json(projectDetail())),
    http.get(`${API}/offgrid/versions/:id/comments`, () => HttpResponse.json([])),
    http.get(`${API}/offgrid/versions/:id`, () => HttpResponse.json(version())),
    http.get(`${API}/catalog/items`, ({ request: r }) => {
      const kind = new URL(r.url).searchParams.get('kind');
      const data = catalog.filter((c) => c.kind === kind);
      return HttpResponse.json({ data, total: data.length, page: 1, pageSize: 100 });
    }),
  );
});

describe('Off-Grid Designer: pedidos', () => {
  it('lista os pedidos com tipo e estado e cria um novo', async () => {
    let created: unknown = null;
    server.use(
      http.get(`${API}/offgrid/requests`, () =>
        HttpResponse.json([
          request(),
          request({
            id: 'rq-2',
            title: 'Sítio híbrido',
            systemType: 'HYBRID',
            status: 'IN_PROGRESS',
            priority: 'HIGH',
          }),
        ]),
      ),
      http.post(`${API}/offgrid/requests`, async ({ request: r }) => {
        created = await r.json();
        return HttpResponse.json(request({ id: 'rq-3', title: 'Telecom' }), { status: 201 });
      }),
      http.get(`${API}/offgrid/requests/rq-3`, () =>
        HttpResponse.json({
          ...request({ id: 'rq-3', title: 'Telecom' }),
          events: [],
          project: null,
        } satisfies OffgridRequestDetailDto),
      ),
    );
    const user = userEvent.setup();
    renderApp('/offgrid/pedidos', { session: makeSession('TECHNICAL_LEAD') });
    expect(await screen.findByRole('link', { name: 'Chalé isolado' })).toBeInTheDocument();
    expect(screen.getByText('Híbrido (rede + bateria, sem injeção)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Novo pedido/ }));
    await user.type(screen.getByLabelText('Título'), 'Telecom');
    await user.click(screen.getByRole('button', { name: 'Criar pedido' }));
    await waitFor(() => expect(created).toMatchObject({ title: 'Telecom', systemType: 'OFFGRID' }));
    expect(await screen.findByRole('heading', { name: 'Telecom' })).toBeInTheDocument();
  });

  it('o pedido tem andamento, comentário e abre o projeto pela própria tela', async () => {
    const changes: unknown[] = [];
    server.use(
      http.get(`${API}/offgrid/requests/rq-1`, () =>
        HttpResponse.json({
          ...request(),
          events: [
            {
              id: 'e1',
              type: 'STATUS',
              text: 'Pedido criado',
              data: {},
              actorId: null,
              actorName: 'Ana',
              createdAt: now,
            },
          ],
          project: null,
        } satisfies OffgridRequestDetailDto),
      ),
      http.patch(`${API}/offgrid/requests/rq-1`, async ({ request: r }) => {
        changes.push(await r.json());
        return HttpResponse.json({
          ...request({ status: 'IN_PROGRESS' }),
          events: [],
          project: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderApp('/offgrid/pedidos/rq-1', { session: makeSession('TECHNICAL_LEAD') });
    expect(await screen.findByText('Pedido criado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Em andamento' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }),
    );
    await waitFor(() => expect(changes[0]).toMatchObject({ status: 'IN_PROGRESS' }));
    expect(screen.getByRole('button', { name: 'Criar projeto' })).toBeInTheDocument();
  });

  it('quem só lê não vê as ações', async () => {
    server.use(
      http.get(`${API}/offgrid/requests/rq-1`, () =>
        HttpResponse.json({ ...request(), events: [], project: null }),
      ),
    );
    renderApp('/offgrid/pedidos/rq-1', { session: makeSession('SALESPERSON') });
    await screen.findByRole('heading', { name: 'Chalé isolado' }).catch(() => undefined);
    expect(screen.queryByRole('button', { name: 'Criar projeto' })).not.toBeInTheDocument();
  });
});

describe('Off-Grid Designer: projetos', () => {
  it('lista, cria um projeto com coordenadas e mostra as versões', async () => {
    let body: unknown = null;
    server.use(
      http.get(`${API}/offgrid/projects`, () =>
        HttpResponse.json({ data: [project], total: 1, page: 1, pageSize: 25 }),
      ),
      http.post(`${API}/offgrid/projects`, async ({ request: r }) => {
        body = await r.json();
        return HttpResponse.json(projectDetail(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/offgrid/projetos', { session: makeSession('TECHNICAL_LEAD') });
    expect(await screen.findByRole('link', { name: 'Chalé do Vale' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Novo projeto/ }));
    await user.type(screen.getByLabelText('Nome do projeto'), 'Sítio');
    await user.click(screen.getByRole('button', { name: 'Criar projeto' }));
    expect(await screen.findByText('Latitude inválida (−90 a 90).')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Latitude'), '-15,8');
    await user.type(screen.getByLabelText('Longitude'), '-47,9');
    await user.click(screen.getByRole('button', { name: 'Criar projeto' }));
    await waitFor(() =>
      expect(body).toMatchObject({ name: 'Sítio', site: { latitude: -15.8, longitude: -47.9 } }),
    );
  });

  it('a página do projeto lista as versões e a linha do tempo', async () => {
    server.use(
      http.get(`${API}/offgrid/projects/pj-1`, () =>
        HttpResponse.json(
          projectDetail({
            events: [
              {
                id: 'e1',
                type: 'PROJECT',
                text: 'Projeto criado',
                data: {},
                actorId: null,
                actorName: 'Ana',
                createdAt: now,
              },
            ],
          }),
        ),
      ),
    );
    renderApp('/offgrid/projetos/pj-1', { session: makeSession('TECHNICAL_LEAD') });
    expect(await screen.findByText('Projeto criado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Versão 1' })).toBeInTheDocument();
  });
});

describe('Off-Grid Designer: editor', () => {
  const open = async (path = '/offgrid/projetos/pj-1/versoes/v-1') => {
    renderApp(path, { session: makeSession('TECHNICAL_LEAD') });
    return screen.findByRole('navigation', { name: 'Etapas do projeto' });
  };
  const step = async (name: RegExp) => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name }));
    return user;
  };

  it('mostra as etapas e calcula o perfil de carga ao vivo', async () => {
    await open();
    const user = await step(/Cargas/);
    expect(await screen.findByText('Perfil de consumo')).toBeInTheDocument();
    expect(screen.getAllByText(/1\.440 Wh/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Bomba d’água/ }));
    expect(await screen.findByText('Carga 2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Curva de carga do dia típico' })).toBeInTheDocument();
  });

  it('edita e remove carga, e o botão salvar só habilita com alteração', async () => {
    let saved: { design: { loads: unknown[] } } | null = null;
    server.use(
      http.put(`${API}/offgrid/versions/v-1`, () => HttpResponse.json({})),
      http.put(`${API}/offgrid/versions/v-1/design`, async ({ request: r }) => {
        saved = (await r.json()) as never;
        return HttpResponse.json(version());
      }),
    );
    await open();
    const user = await step(/Cargas/);
    const save = screen.getByRole('button', { name: /Salvar e calcular/ });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remover Geladeira' }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(saved?.design.loads).toHaveLength(0));
  });

  it('premissas: dimensionamento pelo mês crítico e sugestão do catálogo aplicada ao desenho', async () => {
    server.use(
      http.post(`${API}/offgrid/versions/v-1/suggest`, () =>
        HttpResponse.json([
          {
            moduleId: IDS.module,
            batteryId: IDS.battery,
            controllerId: IDS.controller,
            inverterId: IDS.inverter,
            systemVoltageV: 48,
            modulesInSeries: 3,
            parallelStrings: 1,
            batterySeries: 1,
            batteryParallel: 2,
            inverterCount: 1,
            pvPowerWp: 1650,
            bankNominalWh: 10240,
            capexCents: 500000,
            lolpPct: 0,
            notes: [],
          },
        ]),
      ),
    );
    await open();
    const user = await step(/Premissas/);
    expect(await screen.findByText(/Método do mês crítico/)).toBeInTheDocument();
    expect(screen.getByText('Energia do banco por dia')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sugerir configurações/ }));
    const list = await screen.findByRole('list', { name: 'Configurações sugeridas' });
    await user.click(within(list).getByRole('button', { name: 'Usar esta' }));
    expect(await screen.findByText('alterações não salvas')).toBeInTheDocument();
  });

  it('arranjo e conversão mostram as verificações elétricas', async () => {
    await open();
    await step(/Arranjo FV/);
    const checks = await screen.findByRole('list', { name: 'Verificações do arranjo' });
    expect(within(checks).getAllByText('OK').length).toBeGreaterThan(0);
    const user = await step(/Controlador e inversor/);
    expect(
      await screen.findByRole('list', { name: 'Verificações do inversor' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Baterias/ }));
    expect(await screen.findByText('Banco de baterias')).toBeInTheDocument();
  });

  it('simulação mostra perda de carga, gráficos e o teste de estresse', async () => {
    await open();
    await step(/Simulação/);
    expect(await screen.findByText('Perda de carga')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Dia típico/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Geração e consumo por mês/ })).toBeInTheDocument();
    expect(screen.getByText('Teste de estresse sazonal')).toBeInTheDocument();
  });

  it('cenários e custo comparam o projeto atual com as variações', async () => {
    await open();
    const user = await step(/Cenários e custo/);
    await user.click(await screen.findByRole('button', { name: /Adicionar cenário/ }));
    expect((await screen.findAllByText('Cenário 1')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('CAPEX').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Projeto atual').length).toBeGreaterThan(0);
  });

  it('gerador e rede: híbrido mostra a rede sem injeção', async () => {
    server.use(
      http.get(`${API}/offgrid/versions/v-1`, () =>
        HttpResponse.json(version({ design: { ...fullDesign(), systemType: 'HYBRID' } })),
      ),
    );
    await open();
    const user = await step(/Gerador e rede/);
    expect(await screen.findByText('Rede elétrica (sem injeção)')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Usar gerador'));
    expect(await screen.findByLabelText('Liga abaixo de (% SOC)')).toBeInTheDocument();
  });

  it('versão enviada abre só para leitura; o responsável técnico aprova com justificativa', async () => {
    const decisions: unknown[] = [];
    const results = computeOffgridResults(fullDesign(), {
      modules: {},
      batteries: {},
      controllers: {},
      inverters: {},
      generators: {},
    });
    server.use(
      http.get(`${API}/offgrid/versions/v-1`, () =>
        HttpResponse.json(version({ status: 'SUBMITTED', results })),
      ),
      http.post(`${API}/offgrid/versions/v-1/approve`, async ({ request: r }) => {
        decisions.push(await r.json());
        return HttpResponse.json(version({ status: 'APPROVED' }));
      }),
    );
    await open();
    expect(await screen.findByText(/não pode mais ser editada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salvar e calcular/ })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Aprovar' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Justificativa'), 'Aprovado pelo RT');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(decisions[0]).toEqual({ note: 'Aprovado pelo RT' }));
  });

  it('o executor sem permissão de aprovar não vê Aprovar', async () => {
    server.use(
      http.get(`${API}/offgrid/versions/v-1`, () =>
        HttpResponse.json(version({ status: 'SUBMITTED' })),
      ),
    );
    renderApp('/offgrid/projetos/pj-1/versoes/v-1', { session: makeSession('ENGINEERING') });
    await screen.findByRole('navigation', { name: 'Etapas do projeto' });
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
  });
});
