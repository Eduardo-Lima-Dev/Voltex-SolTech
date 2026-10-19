import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { endpoints } from '@/lib/api/endpoints';
import { opportunityPageHandlers } from '@/test/crm-handlers';
import { API, makeContract, makeOpportunity, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const opp = makeOpportunity({ stage: 'CONTRACT' });
const open = async (extra: Parameters<typeof server.use> = [], role = 'OWNER', o = opp) => {
  server.use(...opportunityPageHandlers(o), ...extra);
  renderApp(`/crm/oportunidades/${o.id}`, { session: makeSession(role as 'OWNER') });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: 'Contrato' }));
  return user;
};
const contracts = (list: ReturnType<typeof makeContract>[]) =>
  http.get(`${API}/opportunities/${opp.id}/contracts`, () => HttpResponse.json(list));

describe('Oportunidade · Contrato', () => {
  it('na etapa Contrato, gera o contrato com os dados que faltam', async () => {
    let body: Record<string, unknown> | undefined;
    const user = await open([
      contracts([]),
      http.post(`${API}/opportunities/${opp.id}/contracts`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeContract(), { status: 201 });
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: /Gerar contrato/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('CPF/CNPJ do cliente'), '123.456.789-09');
    await user.click(within(dialog).getByRole('button', { name: 'Gerar contrato' }));
    await waitFor(() => expect(body).toEqual({ customerDocument: '123.456.789-09' }));
  });

  it('com mais de um cenário, pede a escolha do cliente e reenvia com a cotação', async () => {
    const bodies: Record<string, unknown>[] = [];
    const user = await open([
      contracts([]),
      http.post(`${API}/opportunities/${opp.id}/contracts`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if (!body.quoteId)
          return HttpResponse.json(
            {
              statusCode: 422,
              code: 'SCENARIO_REQUIRED',
              message: 'A proposta tem mais de um cenário.',
              data: {
                scenarios: [
                  { quoteId: 'q1', label: 'Essencial' },
                  { quoteId: 'q2', label: 'Premium' },
                ],
              },
            },
            { status: 422 },
          );
        return HttpResponse.json(makeContract(), { status: 201 });
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: /Gerar contrato/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Gerar contrato' }));
    await user.click(await within(dialog).findByLabelText('Premium'));
    await user.click(within(dialog).getByRole('button', { name: 'Gerar contrato' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ quoteId: 'q2' });
  });

  it('rascunho com modelo-base avisa e mostra o texto; fora da etapa Contrato não oferece gerar', async () => {
    await open([contracts([makeContract({ missingVariables: ['cliente.documento'] })])]);
    expect(await screen.findByText(/modelo-base/)).toBeInTheDocument();
    expect(screen.getByText(/Faltam dados no texto: cliente.documento/)).toBeInTheDocument();
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerar contrato/ })).not.toBeInTheDocument();
  });

  it('registra a assinatura: exige o arquivo, envia o arquivo e os campos', async () => {
    // O jsdom não serializa multipart de forma confiável: confere a chamada ao cliente.
    const sign = vi
      .spyOn(endpoints.contracts, 'sign')
      .mockResolvedValue(makeContract({ status: 'SIGNED', projectId: 'proj-1' }));
    const user = await open([contracts([makeContract()])]);
    await user.click(await screen.findByRole('button', { name: /Registrar assinatura/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar assinatura' }));
    expect(await within(dialog).findByText(/Anexe o contrato assinado/)).toBeInTheDocument();
    expect(sign).not.toHaveBeenCalled();
    await user.upload(
      within(dialog).getByLabelText('Contrato assinado'),
      new File(['x'], 'c.pdf', { type: 'application/pdf' }),
    );
    await user.type(
      within(dialog).getByLabelText('Quem assinou pelo cliente (opcional)'),
      'Maria da Silva',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar assinatura' }));
    await waitFor(() => expect(sign).toHaveBeenCalled());
    const [id, file, fields] = sign.mock.calls[0]!;
    expect(id).toBe('contract-1');
    expect((file as File).name).toBe('c.pdf');
    expect(fields).toEqual({ signedByName: 'Maria da Silva', signedAt: undefined });
    sign.mockRestore();
  });

  it('assinado mostra o link do projeto e não permite cancelar nem assinar de novo', async () => {
    await open([
      contracts([
        makeContract({
          status: 'SIGNED',
          projectId: 'proj-1',
          signedDocumentId: 'doc-s',
          signedByName: 'Maria',
          signedAt: '2026-10-19T12:00:00.000Z',
        }),
      ]),
    ]);
    expect(await screen.findByRole('link', { name: 'Abrir o projeto' })).toHaveAttribute(
      'href',
      '/crm/projetos/proj-1',
    );
    expect(screen.getByText('Assinado', { selector: 'span' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Registrar assinatura|Cancelar rascunho/ }),
    ).not.toBeInTheDocument();
  });

  it('cancela o rascunho com motivo', async () => {
    let body: unknown;
    const user = await open([
      contracts([makeContract()]),
      http.post(`${API}/contracts/contract-1/cancel`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeContract({ status: 'CANCELLED' }));
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Cancelar rascunho' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Dados do cliente errados');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar contrato' }));
    await waitFor(() => expect(body).toEqual({ reason: 'Dados do cliente errados' }));
  });

  it('vendedor só lê: sem gerar, assinar nem cancelar', async () => {
    await open([contracts([makeContract()])], 'SALESPERSON');
    expect(await screen.findByText('Contrato v1')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /Registrar assinatura|Cancelar rascunho|Gerar contrato/,
      }),
    ).not.toBeInTheDocument();
  });
});
