import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { opportunityPageHandlers } from '@/test/crm-handlers';
import {
  API,
  distributor,
  makeBill,
  makeBillSnapshot,
  makeOpportunity,
  makeSession,
  page,
} from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const error = (status: number, message: string) =>
  HttpResponse.json({ statusCode: status, code: 'ERR', message }, { status });
const PATH = '/crm/oportunidades/opp-1/faturas/bill-1';

const open = (
  bill = makeBill(),
  snapshots = [] as ReturnType<typeof makeBillSnapshot>[],
  session = makeSession('OWNER'),
) => {
  server.use(
    http.get(`${API}/energy-bills/${bill.id}`, () => HttpResponse.json(bill)),
    http.get(`${API}/energy-bills/${bill.id}/snapshots`, () => HttpResponse.json(snapshots)),
    http.get(`${API}/distributors`, () => HttpResponse.json([distributor()])),
    // Depois de confirmar ou recusar, a pessoa volta para a oportunidade.
    ...opportunityPageHandlers(makeOpportunity()),
    http.get(`${API}/tasks`, () => HttpResponse.json(page([]))),
    http.get(`${API}/opportunities/opp-1/timeline`, () => HttpResponse.json([])),
  );
  return renderApp(PATH, { session });
};

describe('CRM · Revisão da fatura', () => {
  it('mostra o que foi lido e destaca o que precisa de atenção (baixa confiança e não lido)', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Revisar fatura' })).toBeInTheDocument();
    expect(screen.getByLabelText('Unidade consumidora (UC)')).toHaveValue('12345678-9');
    expect(screen.getByLabelText('Distribuidora')).toHaveValue('Enel Ceará');
    expect(screen.getByLabelText('Tipo de ligação')).toHaveValue('TWO_PHASE');
    expect(screen.getByText('Lido com 85% de confiança')).toBeInTheDocument();
    // Nome do cliente (50%) e histórico (65%) ficam abaixo do limite de 75%.
    expect(screen.getAllByText(/Confirme: leitura com/)).toHaveLength(2);
    expect(screen.getByText('Confirme: leitura com 50% de confiança')).toBeInTheDocument();
    // Campos que a leitura não encontrou aparecem como não lidos.
    expect(screen.getAllByText(/Não lido automaticamente/).length).toBeGreaterThan(3);
    // Histórico preenchido pela leitura.
    expect(screen.getByLabelText('Consumo 3 (kWh)')).toHaveValue('1020');
    expect(screen.getByLabelText('Mês 1')).toHaveValue('2026-06');
  });

  it('confirmar envia só os campos preenchidos (tarifa em centavos, meses em ordem) e volta à oportunidade', async () => {
    let body: { fields: Record<string, unknown>; note?: string } | undefined;
    const { router } = open();
    server.use(
      http.post(`${API}/energy-bills/bill-1/validate`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(makeBill({ status: 'VALIDATED' }));
      }),
    );
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText('Consumo 3 (kWh)'));
    await user.type(screen.getByLabelText('Consumo 3 (kWh)'), '480,5');
    await user.type(screen.getByLabelText('Tarifa (R$/kWh, com impostos)'), '1,025');
    await user.selectOptions(screen.getByLabelText('Grupo tarifário'), 'B');
    await user.click(screen.getByRole('button', { name: 'Confirmar dados da fatura' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body!.fields).toMatchObject({
      ucNumber: '12345678-9',
      distributorName: 'Enel Ceará',
      phaseSystem: 'TWO_PHASE',
      customerGroup: 'B',
      tariffCentsPerKwh: 102.5,
    });
    expect(body!.fields.consumptionHistory).toEqual([
      { month: '2026-06', kwh: 400 },
      { month: '2026-07', kwh: 405 },
      { month: '2026-08', kwh: 480.5 },
    ]);
    expect(body!.fields).not.toHaveProperty('dueDate');
    await waitFor(() => expect(router.state.location.pathname).toBe('/crm/oportunidades/opp-1'));
  });

  it('sem UC ou sem consumo, mostra a mensagem no campo e não envia', async () => {
    let calls = 0;
    open(makeBill({ extracted: {}, status: 'UPLOADED', overallConfidence: null }));
    server.use(
      http.post(
        `${API}/energy-bills/bill-1/validate`,
        () => ((calls += 1), HttpResponse.json(makeBill())),
      ),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar dados da fatura' }));
    expect(await screen.findByText('Informe o número da UC')).toBeInTheDocument();
    expect(screen.getByText(/pelo menos um mês/)).toBeInTheDocument();
    expect(screen.getByLabelText('Unidade consumidora (UC)')).toBeInvalid();
    expect(calls).toBe(0);
  });

  it('linha de consumo incompleta aponta o campo; dá para adicionar e remover meses', async () => {
    open(makeBill({ extracted: {}, status: 'UPLOADED', overallConfidence: null }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Unidade consumidora (UC)'), '7001234');
    fireEvent.change(screen.getByLabelText('Mês 1'), { target: { value: '2026-08' } });
    await user.click(screen.getByRole('button', { name: 'Confirmar dados da fatura' }));
    expect(await screen.findByText('Informe o consumo (kWh)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Adicionar mês/ }));
    expect(screen.getByLabelText('Mês 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover mês 2' }));
    expect(screen.queryByLabelText('Mês 2')).not.toBeInTheDocument();
    // a última linha não pode ser removida
    expect(screen.getByRole('button', { name: 'Remover mês 1' })).toBeDisabled();
  });

  it('revalidar parte do último snapshot confirmado, não da leitura automática', async () => {
    open(makeBill({ status: 'VALIDATED' }), [
      makeBillSnapshot({
        fields: {
          ucNumber: 'UC-CORRIGIDA',
          tariffCentsPerKwh: 99,
          consumptionHistory: [{ month: '2026-08', kwh: 480 }],
        },
      }),
    ]);
    expect(await screen.findByLabelText('Unidade consumidora (UC)')).toHaveValue('UC-CORRIGIDA');
    expect(screen.getByLabelText('Tarifa (R$/kWh, com impostos)')).toHaveValue('0,99');
    expect(screen.getByLabelText('Consumo 1 (kWh)')).toHaveValue('480');
  });

  it('recusar exige o motivo e volta à oportunidade', async () => {
    let body: unknown;
    const { router } = open();
    server.use(
      http.post(`${API}/energy-bills/bill-1/reject`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBill({ status: 'REJECTED' }));
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Recusar fatura' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Recusar fatura' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motivo'), 'Foto ilegível');
    await user.click(confirm);
    await waitFor(() => expect(body).toEqual({ reason: 'Foto ilegível' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/crm/oportunidades/opp-1'));
  });

  it('erro do servidor na confirmação aparece como aviso e mantém os dados na tela', async () => {
    open();
    server.use(http.post(`${API}/energy-bills/bill-1/validate`, () => error(500, 'x')));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar dados da fatura' }));
    expect(await screen.findByText(/O sistema encontrou um problema/)).toBeInTheDocument();
    expect(screen.getByLabelText('Unidade consumidora (UC)')).toHaveValue('12345678-9');
  });

  it('fatura inexistente mostra mensagem; sem permissão de escrita em fatura não abre a revisão', async () => {
    server.use(
      http.get(`${API}/energy-bills/bill-x`, () => error(404, 'x')),
      http.get(`${API}/energy-bills/bill-x/snapshots`, () => HttpResponse.json([])),
      http.get(`${API}/distributors`, () => HttpResponse.json([])),
    );
    const { unmount } = renderApp('/crm/oportunidades/opp-1/faturas/bill-x');
    expect(await screen.findByText('Fatura não encontrada.')).toBeInTheDocument();
    unmount();
    renderApp(PATH, { session: makeSession('ENGINEERING') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
});
