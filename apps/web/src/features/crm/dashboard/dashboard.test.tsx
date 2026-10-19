import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeDashboard, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('CRM · Painel comercial', () => {
  it('mostra indicadores, leads por origem, funil com conversão e previsão sem peso inventado', async () => {
    server.use(http.get(`${API}/dashboard/commercial`, () => HttpResponse.json(makeDashboard())));
    renderApp('/crm/painel', { session: makeSession('SALES_MANAGER') });
    expect(await screen.findByText('Leads no período')).toBeInTheDocument();
    expect(screen.getByText('R$ 19.800,00', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/2 visualizadas · 1 aceitas/)).toBeInTheDocument();

    const sources = screen.getByRole('list', { name: 'Leads por origem' });
    expect(within(sources).getByText('Formulário')).toBeInTheDocument();
    expect(within(sources).getByText('6')).toBeInTheDocument();

    const funnel = screen.getByRole('list', { name: 'Funil por etapa' });
    expect(within(funnel).getByText('50%')).toBeInTheDocument();
    expect(within(funnel).getByText('25%')).toBeInTheDocument();

    expect(screen.getByText(/Não é uma previsão estatística/)).toBeInTheDocument();
    expect(screen.getByText(/Defina os pesos por etapa/)).toBeInTheDocument();
    expect(screen.getByText('2026-12')).toBeInTheDocument();
    expect(
      screen.getByText(/2 oportunidade\(s\) sem data de fechamento esperada/),
    ).toBeInTheDocument();
  });

  it('com pesos definidos mostra o total ponderado; sem ganhos o ticket médio é um traço', async () => {
    server.use(
      http.get(`${API}/dashboard/commercial`, () =>
        HttpResponse.json(
          makeDashboard({
            won: { count: 0, totalCents: 0, averageTicketCents: null },
            forecast: { ...makeDashboard().forecast, weightedTotalCents: 3_000_000 },
          }),
        ),
      ),
    );
    renderApp('/crm/painel', { session: makeSession('FINANCE') });
    expect(await screen.findByText('R$ 30.000,00')).toBeInTheDocument();
    expect(screen.getByText('Ticket médio').nextElementSibling).toHaveTextContent('—');
  });

  it('vendedor não acessa o painel', async () => {
    renderApp('/crm/painel', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
});
