import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { PlantDetailDto, PlantMonitoringPageDto } from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const month = (key: string, o: Record<string, unknown> = {}) => ({
  month: key,
  expectedKwh: 900,
  expectedToDateKwh: 300,
  actualKwh: 270,
  daysWithData: 10,
  daysInMonth: 30,
  performanceIndex: 0.9,
  deviationPct: -10,
  ...o,
});

const page = (o: Partial<PlantMonitoringPageDto> = {}): PlantMonitoringPageDto => ({
  links: [],
  daily: [
    { date: '2026-10-21', kwh: 25, source: 'solaredge' },
    { date: '2026-10-22', kwh: 28, source: 'CSV' },
  ],
  snapshot: { powerKw: 3.2, status: 'ONLINE', receivedAt: '2026-10-22T12:00:00.000Z' },
  openAlarms: [],
  months: [month('2026-10')],
  deviationRule: null,
  deviation: null,
  hasExpected: true,
  ...o,
});

const plantDetail = {
  id: 'pl-1',
  installationId: 'i-1',
  projectId: 'p-1',
  projectCode: 'PRJ-2026-0001',
  accountId: 'a-1',
  accountName: 'Maria',
  siteLabel: 'Casa',
  name: 'Maria — Casa',
  status: 'ACTIVE',
  powerKwp: 6,
  expectedAnnualKwh: 9000,
  expectedMonthlyKwh: Array(12).fill(750),
  expectedSource: 'snapshot',
  activatedAt: '2026-10-01T00:00:00.000Z',
  openTickets: 0,
  assetsWithoutWarranty: 0,
  assets: [],
  tickets: [],
  plans: [],
  contracts: [],
  events: [],
} as unknown as PlantDetailDto;

describe('Monitoramento da planta', () => {
  it('mostra o desempenho e avisa que sem regra ativa não abre chamado', async () => {
    server.use(
      http.get(`${API}/operations/plants/pl-1`, () => HttpResponse.json(plantDetail)),
      http.get(`${API}/operations/plants/pl-1/monitoring`, () => HttpResponse.json(page())),
      http.get(`${API}/operations/plants/pl-1/monitoring/connections`, () => HttpResponse.json([])),
    );
    renderApp('/operations/plantas/pl-1', { session: makeSession('OM') });
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText(/3,2 kW agora/)).toBeInTheDocument();
    expect(screen.getByText(/Sem regra de monitoramento ativa/)).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Geração diária/ })).toBeInTheDocument();
  });

  it('com a regra e o desvio, destaca o alerta', async () => {
    server.use(
      http.get(`${API}/operations/plants/pl-1`, () => HttpResponse.json(plantDetail)),
      http.get(`${API}/operations/plants/pl-1/monitoring`, () =>
        HttpResponse.json(
          page({
            deviationRule: { thresholdPct: 20, consecutiveDays: 3, ref: 'r@1' },
            deviation: { streak: 4, alert: true, days: [] },
          }),
        ),
      ),
      http.get(`${API}/operations/plants/pl-1/monitoring/connections`, () => HttpResponse.json([])),
    );
    renderApp('/operations/plantas/pl-1', { session: makeSession('OM') });
    expect(await screen.findByRole('alert')).toHaveTextContent(/4 dia\(s\) seguidos/);
  });

  it('importa a planilha enviando o texto do arquivo e lista as linhas recusadas', async () => {
    let sent: { csv?: string } = {};
    server.use(
      http.get(`${API}/operations/plants/pl-1`, () => HttpResponse.json(plantDetail)),
      http.get(`${API}/operations/plants/pl-1/monitoring`, () => HttpResponse.json(page())),
      http.get(`${API}/operations/plants/pl-1/monitoring/connections`, () => HttpResponse.json([])),
      http.post(`${API}/operations/plants/pl-1/monitoring/import`, async ({ request }) => {
        sent = (await request.json()) as { csv: string };
        return HttpResponse.json({
          imported: 1,
          rejected: [{ line: 3, reason: 'Data inválida: "x"' }],
        });
      }),
    );
    renderApp('/operations/plantas/pl-1', { session: makeSession('OM') });
    const input = await screen.findByLabelText('Planilha de geração');
    const user = userEvent.setup();
    await user.upload(input, new File(['2026-10-01;10\n'], 'geracao.csv', { type: 'text/csv' }));
    await waitFor(() => expect(sent.csv).toBe('2026-10-01;10\n'));
    expect(await screen.findByText(/Linha 3: Data inválida/)).toBeInTheDocument();
  });

  it('vincula a usina escolhida na lista do provedor', async () => {
    let linked: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/operations/plants/pl-1`, () => HttpResponse.json(plantDetail)),
      http.get(`${API}/operations/plants/pl-1/monitoring`, () => HttpResponse.json(page())),
      http.get(`${API}/operations/plants/pl-1/monitoring/connections`, () =>
        HttpResponse.json([
          {
            id: 'c-1',
            label: 'SolarEdge da empresa',
            provider: 'solaredge',
            providerLabel: 'SolarEdge',
            status: 'ACTIVE',
            canListPlants: true,
          },
        ]),
      ),
      http.get(`${API}/operations/plants/pl-1/monitoring/external-plants`, () =>
        HttpResponse.json([{ id: '4711', name: 'Casa da Maria' }]),
      ),
      http.post(`${API}/operations/plants/pl-1/monitoring/links`, async ({ request }) => {
        linked = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderApp('/operations/plantas/pl-1', { session: makeSession('OM') });
    const user = userEvent.setup();
    await screen.findByRole('option', { name: /SolarEdge da empresa/ });
    await user.selectOptions(screen.getByLabelText('Conexão'), 'c-1');
    await screen.findByRole('option', { name: 'Casa da Maria' });
    await user.selectOptions(screen.getByLabelText('Usina no provedor'), '4711');
    await user.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(linked).toEqual({ connectionId: 'c-1', externalPlantId: '4711' }));
  });
});
