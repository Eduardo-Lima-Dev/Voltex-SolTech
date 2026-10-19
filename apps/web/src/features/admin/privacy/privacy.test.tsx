import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeLead, makeSession, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const policy = (over = {}) => ({
  policy: {
    unconvertedLeadsMonths: null,
    lostOpportunitiesMonths: null,
    signedContractsMonths: 60,
    ...over,
  },
  floors: { signedContractsMonths: 60 },
  sources: {
    signedContractsMonths: 'CTN e CDC: 5 anos. Confirme com o seu jurídico.',
    accessLogs: 'Marco Civil: 6 meses de registros de acesso.',
  },
});
const request = (over = {}) => ({
  id: 'r1',
  subjectType: 'LEAD',
  subjectLabel: 'M. S.',
  status: 'COMPLETED',
  reason: 'Pedido por e-mail',
  blockedReason: null,
  retainedUntil: null,
  summary: { leads: 1 },
  requestedById: 'u1',
  requestedByName: 'Eduardo Silva',
  createdAt: '2026-10-19T12:00:00.000Z',
  ...over,
});
const base = (history: unknown[] = []) => [
  http.get(`${API}/privacy/retention`, () => HttpResponse.json(policy())),
  http.get(`${API}/privacy/erasures`, () => HttpResponse.json(page(history))),
];

describe('Administração · Privacidade (LGPD)', () => {
  it('mostra os prazos em linguagem simples, com o mínimo legal e a observação de confirmar com o jurídico', async () => {
    server.use(...base());
    renderApp('/admin/privacidade', { session: makeSession('OWNER') });
    expect(await screen.findByText('Prazos de guarda dos dados')).toBeInTheDocument();
    expect(await screen.findByLabelText('Contratos assinados (meses)')).toHaveValue('60');
    expect(screen.getByText(/Confirme com o seu jurídico/)).toBeInTheDocument();
    expect(screen.getByText(/Marco Civil/)).toBeInTheDocument();
    expect(screen.getByText('Nenhum pedido ainda.')).toBeInTheDocument();
  });

  it('recusa menos de 5 anos para contratos e salva prazos válidos (em branco = nunca apagar)', async () => {
    let body: unknown;
    server.use(
      ...base(),
      http.put(`${API}/privacy/retention`, async ({ request: req }) => {
        body = await req.json();
        return HttpResponse.json(policy(body as object));
      }),
    );
    renderApp('/admin/privacidade', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    const contracts = await screen.findByLabelText('Contratos assinados (meses)');
    await user.clear(contracts);
    await user.type(contracts, '48');
    await user.click(screen.getByRole('button', { name: 'Salvar prazos' }));
    expect(await screen.findByText(/no mínimo, 60 meses/)).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.clear(contracts);
    await user.type(contracts, '72');
    await user.type(screen.getByLabelText('Contatos que não viraram cliente (meses)'), '24');
    await user.click(screen.getByRole('button', { name: 'Salvar prazos' }));
    await waitFor(() =>
      expect(body).toEqual({
        unconvertedLeadsMonths: 24,
        lostOpportunitiesMonths: null,
        signedContractsMonths: 72,
      }),
    );
  });

  it('elimina os dados de um contato: busca, escolhe, anota a origem e confirma', async () => {
    let sent: unknown;
    server.use(
      ...base(),
      http.get(`${API}/leads`, () =>
        HttpResponse.json(
          page([makeLead({ id: 'l1', name: 'Maria Souza', email: 'maria@exemplo.com' })]),
        ),
      ),
      http.post(`${API}/privacy/erasures`, async ({ request: req }) => {
        sent = await req.json();
        return HttpResponse.json(request(), { status: 201 });
      }),
    );
    renderApp('/admin/privacidade', { session: makeSession('ADMIN') });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Buscar pessoa'), 'maria');
    await user.click(screen.getByRole('button', { name: /Buscar/ }));
    await user.click(await screen.findByRole('button', { name: /Maria Souza/ }));
    await user.click(screen.getByRole('button', { name: 'Eliminar os dados desta pessoa' }));
    expect(await screen.findByText(/Anote de onde veio o pedido/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('De onde veio o pedido'), 'E-mail do titular em 19/10');
    await user.click(screen.getByRole('button', { name: 'Eliminar os dados desta pessoa' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Não dá para desfazer/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }));
    await waitFor(() =>
      expect(sent).toEqual({
        subjectType: 'LEAD',
        subjectId: 'l1',
        reason: 'E-mail do titular em 19/10',
      }),
    );
    expect(await screen.findByText('Dados eliminados')).toBeInTheDocument();
  });

  it('pedido bloqueado por lei mostra o motivo e a data, sem apagar nada', async () => {
    server.use(
      ...base(),
      http.get(`${API}/accounts`, () =>
        HttpResponse.json(
          page([{ id: 'a1', name: 'Cliente Com Contrato', email: null, phone: '(85) 98888-0000' }]),
        ),
      ),
      http.post(`${API}/privacy/erasures`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'ERASURE_BLOCKED',
            message: 'A lei exige guardar o contrato assinado até 19/10/2031 (60 meses).',
            data: { retainedUntil: '2031-10-19T00:00:00.000Z' },
          },
          { status: 409 },
        ),
      ),
    );
    renderApp('/admin/privacidade', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Tipo de cadastro'), 'ACCOUNT');
    await user.type(screen.getByLabelText('Buscar pessoa'), 'cliente');
    await user.click(screen.getByRole('button', { name: /Buscar/ }));
    await user.click(await screen.findByRole('button', { name: /Cliente Com Contrato/ }));
    await user.type(screen.getByLabelText('De onde veio o pedido'), 'Pedido do titular');
    await user.click(screen.getByRole('button', { name: 'Eliminar os dados desta pessoa' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Eliminar definitivamente',
      }),
    );
    expect(
      await screen.findByText(/A lei exige guardar o contrato assinado até 19\/10\/2031/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Não foi possível eliminar agora/)).toBeInTheDocument();
  });

  it('o histórico mostra iniciais e resultado, nunca o nome; pedidos automáticos são identificados', async () => {
    server.use(
      ...base([
        request(),
        request({
          id: 'r2',
          subjectLabel: 'J. P.',
          status: 'BLOCKED',
          blockedReason: 'Contrato guardado',
          retainedUntil: '2031-10-19T00:00:00.000Z',
          requestedById: null,
          requestedByName: null,
          reason: 'Política de retenção',
        }),
      ]),
    );
    renderApp('/admin/privacidade', { session: makeSession('OWNER') });
    expect(await screen.findByText('M. S.')).toBeInTheDocument();
    expect(screen.getByText('Eliminado')).toBeInTheDocument();
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.getByText(/automático \(prazos de guarda\)/)).toBeInTheDocument();
    expect(screen.getByText(/Contrato guardado \(até/)).toBeInTheDocument();
  });

  it('gestor comercial não vê a aba', async () => {
    renderApp('/admin/privacidade', { session: makeSession('SALES_MANAGER') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
});
