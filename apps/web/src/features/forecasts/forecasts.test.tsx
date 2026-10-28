import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const financeBase = [http.get(`${API}/finance/commission-policies`, () => HttpResponse.json([]))];

describe('previsões nas telas', () => {
  beforeEach(() => server.use(...financeBase));

  it('financeiro: abaixo do mínimo mostra "dados insuficientes" com a amostra e o mínimo', async () => {
    renderApp('/operations/financeiro');
    expect(await screen.findByText('Quanto deve entrar nos próximos 90 dias')).toBeInTheDocument();
    expect(
      await screen.findByText(/Dados insuficientes: há 0 no histórico e o mínimo da empresa é 20/),
    ).toBeInTheDocument();
  });

  it('financeiro: com amostra mostra os três cenários e o que não tem data', async () => {
    server.use(
      http.get(`${API}/forecasts/receivables`, () =>
        HttpResponse.json({
          status: 'OK',
          sample: 24,
          required: 20,
          horizonDays: 90,
          openCents: 1_000_000,
          weeks: [],
          withinHorizon: { best: 900_000, expected: 700_000, worst: 400_000 },
          beyondHorizon: { best: 0, expected: 100_000, worst: 300_000 },
          unplacedCents: 50_000,
        }),
      ),
    );
    renderApp('/operations/financeiro');
    expect(await screen.findByText('Melhor cenário')).toBeInTheDocument();
    expect(screen.getByText('Pior cenário')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s?7\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/Base: 24 parcelas pagas/)).toBeInTheDocument();
  });

  it('operação: mostra quantas instalações passaram do tempo normal', async () => {
    server.use(
      http.get(`${API}/forecasts/installations`, () =>
        HttpResponse.json({
          status: 'OK',
          sample: 12,
          required: 10,
          averageDaysByStatus: {},
          installations: [
            {
              id: 'a',
              status: 'SCHEDULING',
              daysInStatus: 9,
              atRisk: true,
              estimatedDoneOn: '2026-11-20',
              missingStatuses: [],
            },
            {
              id: 'b',
              status: 'IN_PROGRESS',
              daysInStatus: 1,
              atRisk: false,
              estimatedDoneOn: '2026-11-05',
              missingStatuses: [],
            },
          ],
        }),
      ),
    );
    renderApp('/operations');
    expect(await screen.findByText('Conclusão das instalações em andamento')).toBeInTheDocument();
    expect(await screen.findByText(/2 em andamento/)).toBeInTheDocument();
  });
});
