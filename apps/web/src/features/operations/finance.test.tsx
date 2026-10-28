import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { FinanceOverviewDto, ProjectFinancialSummaryDto, ReceivableDto } from '@voltex/shared';
import { API, makeProject, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const receivable = (o: Partial<ReceivableDto> = {}): ReceivableDto => ({
  id: 'r-1',
  projectId: 'proj-1',
  referenceId: 'NF-001',
  order: 1,
  amountCents: 500_000,
  dueOn: '2026-11-10',
  paidOn: null,
  paymentMethod: null,
  status: 'OPEN',
  daysOverdue: 0,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...o,
});

const summary = (o: Partial<ProjectFinancialSummaryDto> = {}): ProjectFinancialSummaryDto => ({
  projectId: 'proj-1',
  valueCents: 2_000_000,
  totalReceivedCents: 0,
  totalOpenCents: 500_000,
  totalOverdueCents: 0,
  totalCostsCents: 0,
  totalEstimatedCostsCents: 0,
  totalCommissionsCents: 0,
  marginCents: 0,
  marginPct: null,
  costDeviationPct: null,
  receivablesCount: 1,
  receivablesPaidCount: 0,
  overdueCount: 0,
  receivables: [receivable()],
  costEntries: [],
  creditApplications: [],
  commissions: [],
  ...o,
});

describe('Financeiro', () => {
  it('na ficha do projeto, dá baixa numa parcela com forma e data de pagamento', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/projects/proj-1`, () => HttpResponse.json(makeProject())),
      http.get(`${API}/projects/proj-1/finance/summary`, () => HttpResponse.json(summary())),
      http.post(`${API}/projects/proj-1/finance/receivables/r-1/pay`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(receivable({ status: 'PAID', paidOn: '2026-10-23' }));
      }),
    );
    renderApp('/crm/projetos/proj-1', { session: makeSession('FINANCE') });
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeInTheDocument();
    expect(await screen.findByText('NF-001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dar baixa' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Forma de pagamento'));
    await user.type(within(dialog).getByLabelText('Forma de pagamento'), 'Boleto');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar recebimento' }));
    await waitFor(() => expect(body).toMatchObject({ paymentMethod: 'Boleto' }));
    expect(body?.paidOn).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('quem não tem permissão financeira não vê a seção na ficha do projeto', async () => {
    server.use(http.get(`${API}/projects/proj-1`, () => HttpResponse.json(makeProject())));
    renderApp('/crm/projetos/proj-1', { session: makeSession('OPERATIONS') });
    expect(await screen.findByRole('heading', { name: 'Casa da Maria' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Financeiro' })).not.toBeInTheDocument();
  });

  it('na visão da empresa, lista as parcelas vencidas e publica a política de comissão', async () => {
    let policy: Record<string, unknown> | undefined;
    const overview: FinanceOverviewDto = {
      totalOpenCents: 900_000,
      totalOverdueCents: 400_000,
      receivedLast30DaysCents: 1_200_000,
      commissionsPendingCents: 50_000,
      overdue: [
        {
          ...receivable({ status: 'OVERDUE', daysOverdue: 7, dueOn: '2026-10-16' }),
          projectCode: 'PRJ-2026-0001',
          accountName: 'Maria da Silva',
        },
      ],
    };
    server.use(
      http.get(`${API}/finance/overview`, () => HttpResponse.json(overview)),
      http.get(`${API}/finance/commission-policies`, () => HttpResponse.json([])),
      http.post(`${API}/finance/commission-policies`, async ({ request }) => {
        policy = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderApp('/operations/financeiro', { session: makeSession('FINANCE') });
    const link = await screen.findByRole('link', { name: 'PRJ-2026-0001' });
    expect(link).toHaveAttribute('href', '/crm/projetos/proj-1');
    expect(screen.getByText('7 dia(s)')).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma política cadastrada/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Vendedor (%)'), '5');
    await user.click(screen.getByRole('button', { name: 'Publicar nova política' }));
    await waitFor(() =>
      expect(policy).toMatchObject({ base: 'RECEIVED', weights: { SALESPERSON: 5 } }),
    );
  });
});
