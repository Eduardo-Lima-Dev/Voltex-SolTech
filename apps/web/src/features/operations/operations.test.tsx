import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type {
  CrewDto,
  InstallationDetailDto,
  InstallationSummaryDto,
  MaterialItemDto,
  WorkOrderDto,
} from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-22T12:00:00.000Z';

const summary = (o: Partial<InstallationSummaryDto> = {}): InstallationSummaryDto => ({
  id: 'i-1',
  projectId: 'p-1',
  projectCode: 'PRJ-2026-0001',
  opportunityId: 'o-1',
  accountId: 'a-1',
  accountName: 'Maria da Silva',
  siteLabel: 'Casa – Brasília/DF',
  status: 'AWAITING_MATERIAL',
  responsibleId: null,
  materialsTotal: 2,
  materialsReady: 1,
  openIssues: 0,
  nextScheduledStart: null,
  createdAt: now,
  ...o,
});

const material = (o: Partial<MaterialItemDto> = {}): MaterialItemDto => ({
  id: 'm-1',
  category: 'MODULE',
  equipmentId: null,
  description: 'Módulo 550 W',
  quantity: 12,
  unit: 'un',
  unitCostCents: 90_000,
  status: 'PENDING',
  supplier: null,
  purchaseOrder: null,
  orderedCents: null,
  expectedAt: null,
  receivedAt: null,
  separatedAt: null,
  note: null,
  ...o,
});

const order = (o: Partial<WorkOrderDto> = {}): WorkOrderDto => ({
  id: 'w-1',
  installationId: 'i-1',
  projectCode: 'PRJ-2026-0001',
  accountId: 'a-1',
  accountName: 'Maria da Silva',
  siteLabel: null,
  type: 'INSTALLATION',
  status: 'SCHEDULED',
  title: 'Instalar o sistema',
  notes: null,
  crewId: 'c-1',
  crewName: 'Equipe Alfa',
  assigneeId: null,
  scheduledStart: '2026-10-23T12:00:00.000Z',
  scheduledEnd: '2026-10-23T18:00:00.000Z',
  startedAt: null,
  completedAt: null,
  cancelReason: null,
  checklist: [],
  signedByName: null,
  signedAt: null,
  photoCount: 0,
  conflictsWith: [],
  ...o,
});

const detail = (o: Partial<InstallationDetailDto> = {}): InstallationDetailDto => ({
  ...summary(),
  engineeringSnapshotId: null,
  projectStatus: 'APPROVED',
  materialsGeneratedAt: null,
  materialsReadyAt: null,
  installedAt: null,
  doneAt: null,
  cancelReason: null,
  acceptance: null,
  allowedTransitions: ['MATERIAL_READY', 'CANCELLED'],
  materials: [
    material(),
    material({
      id: 'm-2',
      description: 'Cabo 6 mm²',
      status: 'RECEIVED',
      quantity: 100,
      unit: 'm',
    }),
  ],
  workOrders: [],
  issues: [],
  history: [
    {
      id: 'h-1',
      fromStatus: 'AWAITING_ENGINEERING',
      toStatus: 'AWAITING_MATERIAL',
      reason: 'Homologação aprovada',
      actorId: null,
      createdAt: now,
    },
  ],
  ...o,
});

const crew: CrewDto = {
  id: 'c-1',
  name: 'Equipe Alfa',
  active: true,
  members: [{ userId: 'u-1', name: 'João Instalador' }],
};

describe('Operação', () => {
  it('quem não tem permissão da operação vê "Sem acesso"; a operação vê o produto no menu', async () => {
    renderApp('/operations', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });

  it('lista as instalações com situação, material recebido e próxima data, e filtra por situação', async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${API}/operations/installations`, ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({
          data: [summary({ nextScheduledStart: '2026-10-25T12:00:00.000Z', openIssues: 2 })],
          meta: { page: 1, pageSize: 50, total: 1 },
        });
      }),
    );
    renderApp('/operations/instalacoes', { session: makeSession('OPERATIONS') });
    const row = (await screen.findByRole('link', { name: 'PRJ-2026-0001' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText('Aguardando material')).toBeInTheDocument();
    expect(within(row).getByText('1 de 2 recebidos')).toBeInTheDocument();
    expect(within(row).getByText(/Maria da Silva/)).toBeInTheDocument();
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText('Filtrar por situação'), 'SCHEDULING');
    await waitFor(() => expect(queries.some((q) => q.includes('status=SCHEDULING'))).toBe(true));
  });

  it('a ficha mostra materiais, histórico e só os passos manuais; voltar etapa ou cancelar exige motivo', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/operations/installations/i-1`, () => HttpResponse.json(detail())),
      http.post(`${API}/operations/installations/i-1/status`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(detail({ status: 'CANCELLED', allowedTransitions: [] }));
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    await screen.findByText('Módulo 550 W');
    expect(screen.getByText(/1 de 2 itens recebidos/)).toBeInTheDocument();
    const history = screen.getByRole('list', { name: 'Histórico da instalação' });
    expect(within(history).getByText(/Homologação aprovada/)).toBeInTheDocument();
    expect(within(history).getByText(/automático/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancelar instalação' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Cliente desistiu');
    await user.click(confirm);
    await waitFor(() => expect(body).toEqual({ status: 'CANCELLED', reason: 'Cliente desistiu' }));
  });

  it('material: receber e registrar pedido de compra', async () => {
    let received = 0;
    let ordered: unknown;
    server.use(
      http.get(`${API}/operations/installations/i-1`, () => HttpResponse.json(detail())),
      http.post(`${API}/operations/materials/m-1/receive`, () => {
        received += 1;
        return HttpResponse.json(material({ status: 'RECEIVED' }));
      }),
      http.post(`${API}/operations/materials/m-1/order`, async ({ request }) => {
        ordered = await request.json();
        return HttpResponse.json(material({ status: 'ORDERED' }));
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    const row = (await screen.findByText('Módulo 550 W')).closest('tr') as HTMLElement;
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Receber' }));
    await waitFor(() => expect(received).toBe(1));
    await user.click(within(row).getByRole('button', { name: 'Pedir' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/o sistema só registra o pedido/i)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Fornecedor'), 'Distribuidora Sol');
    await user.type(within(dialog).getByLabelText('Nº do pedido'), 'PC-1');
    await user.type(within(dialog).getByLabelText('Valor pago (R$)'), '1080,50');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pedido' }));
    await waitFor(() =>
      expect(ordered).toEqual({
        supplier: 'Distribuidora Sol',
        purchaseOrder: 'PC-1',
        orderedCents: 108050,
      }),
    );
  });

  it('cria uma ordem de serviço com equipe e horário', async () => {
    let created: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/operations/installations/i-1`, () =>
        HttpResponse.json(detail({ status: 'MATERIAL_READY' })),
      ),
      http.get(`${API}/operations/crews`, () => HttpResponse.json([crew])),
      http.post(`${API}/operations/work-orders`, async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(order(), { status: 201 });
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Ordem/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Título'), 'Instalar o sistema');
    await user.selectOptions(await within(dialog).findByLabelText('Equipe'), 'c-1');
    await user.type(within(dialog).getByLabelText('Início'), '2026-10-23T09:00');
    await user.type(within(dialog).getByLabelText('Fim'), '2026-10-23T15:00');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({
      installationId: 'i-1',
      type: 'INSTALLATION',
      title: 'Instalar o sistema',
      crewId: 'c-1',
    });
    expect(typeof created?.scheduledStart).toBe('string');
    expect(new Date(created!.scheduledEnd as string).getTime()).toBeGreaterThan(
      new Date(created!.scheduledStart as string).getTime(),
    );
  });

  it('mostra ordens com aviso de choque de horário e pendências abertas; registra e resolve pendência', async () => {
    let issue: unknown;
    let resolved: unknown;
    server.use(
      http.get(`${API}/operations/installations/i-1`, () =>
        HttpResponse.json(
          detail({
            status: 'IN_PROGRESS',
            openIssues: 1,
            workOrders: [order({ conflictsWith: ['w-9'] })],
            issues: [
              {
                id: 'is-1',
                installationId: 'i-1',
                workOrderId: null,
                type: 'ACCESS',
                description: 'Telhado sem acesso seguro',
                blocking: true,
                status: 'OPEN',
                resolution: null,
                reportedById: null,
                resolvedById: null,
                resolvedAt: null,
                createdAt: now,
              },
            ],
          }),
        ),
      ),
      http.post(`${API}/operations/installations/i-1/issues`, async ({ request }) => {
        issue = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
      http.post(`${API}/operations/issues/is-1/resolve`, async ({ request }) => {
        resolved = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    const orders = await screen.findByRole('list', { name: 'Ordens de serviço' });
    expect(within(orders).getByText('Choque de horário')).toBeInTheDocument();
    expect(within(orders).getByText(/Equipe Alfa/)).toBeInTheDocument();
    const issues = screen.getByRole('list', { name: 'Pendências de campo' });
    expect(within(issues).getByText('Bloqueia')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(issues).getByRole('button', { name: 'Resolver' }));
    const resolveDialog = await screen.findByRole('dialog');
    await user.type(
      within(resolveDialog).getByLabelText('Como foi resolvida'),
      'Linha de vida instalada',
    );
    await user.click(within(resolveDialog).getByRole('button', { name: 'Resolver' }));
    await waitFor(() => expect(resolved).toEqual({ resolution: 'Linha de vida instalada' }));
    await user.click(screen.getByRole('button', { name: /Pendência/ }));
    const newDialog = await screen.findByRole('dialog');
    await user.type(within(newDialog).getByLabelText('O que aconteceu'), 'Faltou conector MC4');
    await user.click(within(newDialog).getByLabelText('Bloqueia a instalação'));
    await user.click(within(newDialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() =>
      expect(issue).toEqual({ type: 'OTHER', description: 'Faltou conector MC4', blocking: false }),
    );
  });

  it('a agenda mostra os dias da semana e avisa choque de horário', async () => {
    server.use(
      http.get(`${API}/operations/crews`, () => HttpResponse.json([crew])),
      http.get(`${API}/operations/agenda`, () =>
        HttpResponse.json({
          from: now,
          to: now,
          orders: [
            order({ id: 'w-1', scheduledStart: new Date().toISOString(), conflictsWith: ['w-2'] }),
          ],
        }),
      ),
    );
    renderApp('/operations/agenda', { session: makeSession('OPERATIONS') });
    const days = await screen.findByRole('list', { name: 'Dias da semana' });
    expect(within(days).getAllByRole('listitem').length).toBeGreaterThanOrEqual(7);
    expect(await within(days).findByText('Choque de horário')).toBeInTheDocument();
    expect(within(days).getByRole('link', { name: 'Instalar o sistema' })).toHaveAttribute(
      'href',
      '/operations/instalacoes/i-1',
    );
    expect(screen.getByLabelText('Filtrar por equipe')).toBeInTheDocument();
  });

  it('equipes: lista e cria com integrantes', async () => {
    let created: unknown;
    server.use(
      http.get(`${API}/operations/crews`, () => HttpResponse.json([crew])),
      http.get(`${API}/users`, () =>
        HttpResponse.json({
          data: [
            {
              id: 'u-1',
              name: 'João Instalador',
              email: 'j@x.test',
              role: 'INSTALLER',
              isActive: true,
              branchId: null,
              teamId: null,
              lastLoginAt: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
          meta: { page: 1, pageSize: 100, total: 1 },
        }),
      ),
      http.post(`${API}/operations/crews`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json(crew, { status: 201 });
      }),
    );
    renderApp('/operations/equipes', { session: makeSession('OPERATIONS') });
    const list = await screen.findByRole('list', { name: 'Equipes' });
    expect(within(list).getByText('Equipe Alfa')).toBeInTheDocument();
    expect(within(list).getByText('João Instalador')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Nova equipe/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome da equipe'), 'Equipe Beta');
    await user.click(await within(dialog).findByRole('checkbox', { name: /João Instalador/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(created).toEqual({ name: 'Equipe Beta', memberIds: ['u-1'] }));
  });

  it('o painel mostra contagens por situação, atrasos e produtividade', async () => {
    server.use(
      http.get(`${API}/operations/dashboard`, () =>
        HttpResponse.json({
          byStatus: { AWAITING_MATERIAL: 3, CREW_ASSIGNED: 2 },
          scheduledCount: 2,
          overdueCount: 1,
          awaitingMaterialCount: 3,
          openIssuesCount: 4,
          crews: [{ crewId: 'c-1', crewName: 'Equipe Alfa', doneLast30Days: 5 }],
          reworkCount: 1,
        }),
      ),
    );
    renderApp('/operations/painel', { session: makeSession('OPERATIONS') });
    const byStatus = await screen.findByRole('list', { name: 'Instalações por situação' });
    expect(within(byStatus).getByText('Aguardando material').nextSibling).toHaveTextContent('3');
    expect(within(byStatus).getByText('Equipe designada').nextSibling).toHaveTextContent('2');
    const crews = screen.getByRole('list', { name: 'Produtividade das equipes' });
    expect(within(crews).getByText('Equipe Alfa').nextSibling).toHaveTextContent('5');
    expect(screen.getByText('Pendências de campo')).toBeInTheDocument();
  });
});
