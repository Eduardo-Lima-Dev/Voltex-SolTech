import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeApproval, makeSession, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('CRM · Aprovações de margem', () => {
  it('lista os pedidos pendentes com margem, mínimo e justificativa', async () => {
    server.use(
      http.get(`${API}/approvals`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('status')).toBe('PENDING');
        return HttpResponse.json(page([makeApproval()]));
      }),
    );
    renderApp('/crm/aprovacoes', { session: makeSession('SALES_MANAGER') });
    expect(await screen.findByRole('link', { name: 'Casa da Maria' })).toHaveAttribute(
      'href',
      '/crm/oportunidades/opp-1',
    );
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText(/Victor Vendedor pediu:/)).toBeInTheDocument();
    expect(screen.getByText(/Cliente estratégico, fecha hoje\./)).toBeInTheDocument();
  });

  it('aprova com motivo e registra a decisão', async () => {
    let body: Record<string, unknown> | undefined;
    let decided = false;
    server.use(
      http.get(`${API}/approvals`, () => HttpResponse.json(page(decided ? [] : [makeApproval()]))),
      http.post(`${API}/approvals/appr-1/decide`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        decided = true;
        return HttpResponse.json(makeApproval({ status: 'APPROVED' }));
      }),
    );
    renderApp('/crm/aprovacoes', { session: makeSession('SALES_MANAGER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Aprovar' }));
    expect(await within(dialog).findByText(/pelo menos 5 caracteres/)).toBeInTheDocument();
    expect(body).toBeUndefined();
    await user.type(within(dialog).getByLabelText('Motivo da decisão'), 'Volume compensa.');
    await user.click(within(dialog).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(body).toEqual({ approve: true, justification: 'Volume compensa.' }));
    expect(await screen.findByText('Nenhum pedido nesta situação.')).toBeInTheDocument();
  });

  it('recusa e mostra a mensagem quando a regra de segregação barra', async () => {
    server.use(
      http.get(`${API}/approvals`, () => HttpResponse.json(page([makeApproval()]))),
      http.post(`${API}/approvals/appr-1/decide`, () =>
        HttpResponse.json(
          {
            statusCode: 403,
            code: 'FORBIDDEN',
            message: 'Quem pediu a aprovação não pode decidir o próprio pedido.',
          },
          { status: 403 },
        ),
      ),
    );
    renderApp('/crm/aprovacoes', { session: makeSession('SALES_MANAGER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Motivo da decisão'), 'Margem baixa demais.');
    await user.click(within(dialog).getByRole('button', { name: 'Recusar' }));
    expect(await screen.findByText(/não pode decidir o próprio pedido/)).toBeInTheDocument();
  });

  it('mostra as decididas com quem decidiu e o motivo', async () => {
    server.use(
      http.get(`${API}/approvals`, ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        return HttpResponse.json(
          page(
            status === 'APPROVED'
              ? [
                  makeApproval({
                    status: 'APPROVED',
                    decidedByName: 'Marcos Gestor',
                    decidedAt: '2026-10-18T15:00:00.000Z',
                    decisionJustification: 'Volume compensa.',
                  }),
                ]
              : [],
          ),
        );
      }),
    );
    renderApp('/crm/aprovacoes', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Aprovadas' }));
    expect(await screen.findByText(/Marcos Gestor decidiu/)).toBeInTheDocument();
    expect(screen.getByText(/Volume compensa\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recusar' })).not.toBeInTheDocument();
  });

  it('vendedor não vê a área nem acessa a rota', async () => {
    renderApp('/crm/aprovacoes', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByText(/não tem permissão|Acesso negado|permissão/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Aprovações' })).not.toBeInTheDocument();
  });
});
