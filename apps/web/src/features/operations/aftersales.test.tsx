import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type {
  AftersalesDashboardDto,
  OperationsSettingsDto,
  PlantSummaryDto,
  TicketDetailDto,
  TicketSummaryDto,
} from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-22T12:00:00.000Z';

const plant = (o: Partial<PlantSummaryDto> = {}): PlantSummaryDto => ({
  id: 'pl-1',
  installationId: 'i-1',
  projectId: 'p-1',
  projectCode: 'PRJ-2026-0001',
  accountId: 'a-1',
  accountName: 'Maria da Silva',
  siteLabel: 'Casa',
  name: 'Maria da Silva — Casa',
  status: 'ACTIVE',
  powerKwp: 6.6,
  expectedAnnualKwh: 9000,
  activatedAt: '2026-10-01T00:00:00.000Z',
  openTickets: 2,
  assetsWithoutWarranty: 1,
  ...o,
});

const dashboard = (o: Partial<AftersalesDashboardDto> = {}): AftersalesDashboardDto => ({
  installedBase: { plants: 3, powerKwp: 20 },
  mrrCents: 45000,
  openTickets: 4,
  breachedTickets: 1,
  mttrHours: null,
  ticketsByPlant: [],
  warrantiesExpiring: null,
  warrantiesMissing: 2,
  contractsExpiring: null,
  upsellOpportunities: 0,
  ...o,
});

const ticket = (o: Partial<TicketSummaryDto> = {}): TicketSummaryDto => ({
  id: 't-1',
  number: 1,
  code: 'CH-0001',
  plantId: 'pl-1',
  plantName: 'Maria da Silva — Casa',
  accountName: 'Maria da Silva',
  type: 'CORRECTIVE',
  priority: 'HIGH',
  status: 'OPEN',
  title: 'Inversor sem comunicação',
  origin: 'USER',
  assigneeId: null,
  assetId: null,
  workOrderId: null,
  slaDueAt: null,
  slaBreached: false,
  createdAt: now,
  resolvedAt: null,
  ...o,
});

const settings: OperationsSettingsDto = {
  warrantyAlertDays: null,
  renewalNoticeDays: null,
  maintenanceLeadDays: null,
  slaHours: {},
  upsellGridKwh: null,
  upsellMinBills: null,
};

const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 50, total: data.length } });

describe('Pós-venda (Operação)', () => {
  it('lista as plantas e mostra “Não configurado” nas janelas que a empresa ainda não definiu', async () => {
    server.use(
      http.get(`${API}/operations/aftersales/dashboard`, () => HttpResponse.json(dashboard())),
      http.get(`${API}/operations/plants`, () => HttpResponse.json(page([plant()]))),
    );
    renderApp('/operations/plantas', { session: makeSession('OM') });
    const link = await screen.findByRole('link', { name: 'Maria da Silva — Casa' });
    expect(link).toHaveAttribute('href', '/operations/plantas/pl-1');
    expect(screen.getByText('1 sem garantia')).toBeInTheDocument();
    const cards = screen.getByLabelText('Indicadores do pós-venda');
    expect(within(cards).getAllByText('Não configurado')).toHaveLength(2);
    expect(within(cards).getByText('3 planta(s)')).toBeInTheDocument();
  });

  it('abre um chamado escolhendo a planta', async () => {
    let created: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/operations/tickets`, () => HttpResponse.json(page([ticket()]))),
      http.get(`${API}/operations/plants`, () => HttpResponse.json(page([plant()]))),
      http.post(`${API}/operations/tickets`, async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            ...ticket(),
            description: null,
            resolution: null,
            closedAt: null,
            comments: [],
            allowedTransitions: [],
          } satisfies TicketDetailDto,
          {
            status: 201,
          },
        );
      }),
    );
    renderApp('/operations/chamados', { session: makeSession('OM') });
    const user = userEvent.setup();
    expect(await screen.findByText(/CH-0001 — Inversor sem comunicação/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Novo chamado/ }));
    const dialog = await screen.findByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Abrir chamado' });
    expect(create).toBeDisabled();
    await user.selectOptions(await within(dialog).findByLabelText('Planta'), 'pl-1');
    await user.type(within(dialog).getByLabelText('Assunto'), 'Ruído no inversor');
    await user.selectOptions(within(dialog).getByLabelText('Prioridade'), 'URGENT');
    await user.click(create);
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({
      plantId: 'pl-1',
      title: 'Ruído no inversor',
      priority: 'URGENT',
      type: 'CORRECTIVE',
    });
  });

  it('o termo de garantia só salva com prazo e fonte; não sugere prazo nenhum', async () => {
    let created: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/operations/warranty-terms`, () => HttpResponse.json([])),
      http.get(`${API}/operations/warranties`, () => HttpResponse.json([])),
      http.post(`${API}/operations/warranty-terms`, async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'wt-1' }, { status: 201 });
      }),
    );
    renderApp('/operations/garantias', { session: makeSession('OM') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Novo termo' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Salvar termo' });
    expect(within(dialog).getByLabelText('Produto (anos)')).toHaveValue('');
    await user.type(within(dialog).getByLabelText('Fabricante'), 'Fabricante Z');
    await user.type(within(dialog).getByLabelText('Produto (anos)'), '12');
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Fonte do termo'), 'Termo Z, p. 2');
    await user.click(save);
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toEqual({
      manufacturer: 'Fabricante Z',
      category: 'MODULE',
      productYears: 12,
      source: 'Termo Z, p. 2',
    });
  });

  it('as configurações em branco viram nulo (recurso desligado), nunca um prazo padrão', async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/operations/om-contracts`, () => HttpResponse.json([])),
      http.get(`${API}/operations/aftersales/settings`, () =>
        HttpResponse.json({ ...settings, warrantyAlertDays: 60 }),
      ),
      http.put(`${API}/operations/aftersales/settings`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(settings);
      }),
    );
    renderApp('/operations/contratos', { session: makeSession('OM') });
    const user = userEvent.setup();
    const field = await screen.findByLabelText('Avisar garantias (dias antes)');
    await waitFor(() => expect(field).toHaveValue('60'));
    await user.clear(field);
    await user.type(screen.getByLabelText('Urgente'), '4');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({
      warrantyAlertDays: null,
      renewalNoticeDays: null,
      slaHours: { URGENT: 4, LOW: null, NORMAL: null, HIGH: null },
    });
  });
});
