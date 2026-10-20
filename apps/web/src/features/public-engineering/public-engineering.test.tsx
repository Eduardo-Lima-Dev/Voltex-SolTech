import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const TOKEN = 'token-relatorio-token-relatorio-token-12';
const report = {
  companyName: 'Sol do Nordeste',
  projectName: 'Casa da Maria',
  city: 'Brasília',
  state: 'DF',
  approvedAt: '2026-10-20T12:00:00.000Z',
  powerKwp: 5.5,
  moduleCount: 10,
  moduleAreaM2: 26,
  annualEnergyKwh: 8250,
  performanceRatio: 0.8,
  monthlyKwh: Array.from({ length: 12 }, () => 687),
  monthlyConsumptionKwh: 400,
  economics: {
    firstYearSavingsCents: 400_000,
    accumulatedSavingsCents: 12_000_000,
    simplePaybackYears: 6.2,
    horizonYears: 25,
  },
  notes: ['Estimativas sujeitas ao clima.'],
};

describe('Relatório técnico público', () => {
  it('abre sem login, fora da casca da suíte, com os números e sem custos', async () => {
    server.use(http.get(`${API}/public/engineering/${TOKEN}`, () => HttpResponse.json(report)));
    renderApp(`/r/${TOKEN}`, { session: null });
    expect(await screen.findByRole('heading', { name: 'Casa da Maria' })).toBeInTheDocument();
    expect(screen.getByText('Sol do Nordeste')).toBeInTheDocument();
    expect(screen.getByText('5,5 kWp')).toBeInTheDocument();
    expect(screen.getByText(/Brasília \/ DF/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Geração mensal estimada/ })).toBeInTheDocument();
    expect(screen.getByText('Estimativas sujeitas ao clima.')).toBeInTheDocument();
    expect(screen.queryByText(/margem|custo|CAPEX|VPL/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('link vencido ou revogado mostra a mensagem do servidor', async () => {
    server.use(
      http.get(`${API}/public/engineering/${TOKEN}`, () =>
        HttpResponse.json(
          {
            statusCode: 410,
            code: 'GONE',
            message: 'Este link expirou. Peça um novo ao seu consultor.',
          },
          { status: 410 },
        ),
      ),
    );
    renderApp(`/r/${TOKEN}`, { session: null });
    expect(await screen.findByText(/Este link expirou/)).toBeInTheDocument();
  });
});
