import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { endpoints } from '@/lib/api/endpoints';
import { opportunityPageHandlers } from '@/test/crm-handlers';
import {
  API,
  makeBill,
  makeCalculation,
  makeOpportunity,
  makeSession,
  makeTask,
  makeTimelineEvent,
  page,
} from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const opp = makeOpportunity();
const open = async (
  tab: string,
  options: { session?: ReturnType<typeof makeSession>; extra?: Parameters<typeof server.use> } = {},
) => {
  server.use(...opportunityPageHandlers(opp));
  // Registrados depois dos padrões: o MSW usa o handler mais recente que casa.
  if (options.extra) server.use(...options.extra);
  renderApp(`/crm/oportunidades/${opp.id}`, { session: options.session ?? makeSession('OWNER') });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: tab }));
  return user;
};
describe('Oportunidade · Linha do tempo', () => {
  it('mostra os fatos, do mais novo ao mais antigo, com tipo, autor e texto', async () => {
    server.use(
      http.get(`${API}/opportunities/${opp.id}/timeline`, () =>
        HttpResponse.json([
          makeTimelineEvent({
            id: 'e2',
            type: 'STAGE_CHANGED',
            summary: 'Etapa: Novo lead → Primeiro contato',
          }),
          makeTimelineEvent({ id: 'e1' }),
        ]),
      ),
    );
    await open('Linha do tempo');
    expect(await screen.findByText('Etapa: Novo lead → Primeiro contato')).toBeInTheDocument();
    expect(screen.getByText('Oportunidade criada (VLX-7K3M9QX2)')).toBeInTheDocument();
    expect(screen.getByText(/Mudança de etapa/)).toBeInTheDocument();
    expect(screen.getAllByText(/Eduardo Silva/).length).toBeGreaterThan(0);
  });

  it('adiciona uma nota e a lista se atualiza', async () => {
    let notes: string[] = [];
    server.use(
      http.get(`${API}/opportunities/${opp.id}/timeline`, () =>
        HttpResponse.json(
          notes.map((summary, i) => makeTimelineEvent({ id: `n${i}`, type: 'NOTE', summary })),
        ),
      ),
      http.post(`${API}/opportunities/${opp.id}/notes`, async ({ request }) => {
        notes = [((await request.json()) as { body: string }).body, ...notes];
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const user = await open('Linha do tempo');
    const button = await screen.findByRole('button', { name: 'Adicionar nota' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Nova nota'), 'Cliente pediu retorno na sexta');
    await user.click(button);
    expect(await screen.findByText('Cliente pediu retorno na sexta')).toBeInTheDocument();
    expect(screen.getByLabelText('Nova nota')).toHaveValue('');
  });

  it('quem só lê não vê o campo de nota', async () => {
    server.use(
      http.get(`${API}/opportunities/${opp.id}/timeline`, () =>
        HttpResponse.json([makeTimelineEvent()]),
      ),
    );
    await open('Linha do tempo', { session: makeSession('ENGINEERING') });
    await screen.findByText(/Oportunidade criada/);
    expect(screen.queryByLabelText('Nova nota')).not.toBeInTheDocument();
  });
});

describe('Oportunidade · Tarefas', () => {
  it('lista, cria com prazo e vínculo, e conclui', async () => {
    let created: Record<string, unknown> | undefined;
    let tasks = [makeTask({ title: 'Ligar para o cliente', overdue: true })];
    server.use(
      http.get(`${API}/tasks`, () => HttpResponse.json(page(tasks))),
      http.post(`${API}/tasks`, async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        tasks = [...tasks, makeTask({ id: 'task-2', title: 'Enviar proposta' })];
        return HttpResponse.json(tasks[1], { status: 201 });
      }),
      http.post(`${API}/tasks/task-1/complete`, () => {
        tasks = tasks.map((t) =>
          t.id === 'task-1' ? { ...t, status: 'DONE' as const, overdue: false } : t,
        );
        return HttpResponse.json(tasks[0]);
      }),
    );
    const user = await open('Tarefas');
    expect(await screen.findByText('Ligar para o cliente')).toBeInTheDocument();
    expect(screen.getByText('Atrasada')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Nova tarefa/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Criar tarefa' }));
    expect(await within(dialog).findByText('Informe o que precisa ser feito')).toBeInTheDocument();
    expect(created).toBeUndefined();
    await user.type(within(dialog).getByLabelText('O que fazer'), 'Enviar proposta');
    await user.click(within(dialog).getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({ title: 'Enviar proposta', opportunityId: 'opp-1' });
    expect(typeof created!.dueAt).toBe('string');
    expect(await screen.findByText('Enviar proposta')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Concluir Ligar para o cliente' }));
    expect(
      await screen.findByRole('button', { name: 'Reabrir Ligar para o cliente' }),
    ).toBeInTheDocument();
  });

  it('mostra que não há tarefas', async () => {
    server.use(http.get(`${API}/tasks`, () => HttpResponse.json(page([]))));
    await open('Tarefas');
    expect(await screen.findByText('Nenhuma tarefa.')).toBeInTheDocument();
  });
});

describe('Oportunidade · Fatura', () => {
  const bills = () =>
    http.get(`${API}/energy-bills`, () =>
      HttpResponse.json([
        makeBill(),
        makeBill({
          id: 'bill-2',
          filename: 'foto.png',
          status: 'UPLOADED',
          overallConfidence: null,
          extracted: {},
        }),
        makeBill({
          id: 'bill-3',
          filename: 'antiga.pdf',
          status: 'VALIDATED',
          overallConfidence: 0.9,
        }),
        makeBill({
          id: 'bill-4',
          filename: 'ruim.pdf',
          status: 'REJECTED',
          rejectedReason: 'Ilegível',
        }),
      ]),
    );

  it('lista as faturas com situação e confiança, e leva à revisão', async () => {
    await open('Fatura', { extra: [bills()] });
    expect(await screen.findByText('fatura.pdf')).toBeInTheDocument();
    expect(screen.getByText('Lida, aguardando revisão')).toBeInTheDocument();
    expect(screen.getAllByText(/confiança média da leitura 74%/)).toHaveLength(2);
    expect(screen.getByText(/confiança média da leitura 90%/)).toBeInTheDocument();
    expect(screen.getByText(/sem leitura automática/)).toBeInTheDocument();
    expect(screen.getByText('Validada')).toBeInTheDocument();
    expect(screen.getByText(/recusada: Ilegível/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Revisar' })[0]).toHaveAttribute(
      'href',
      '/crm/oportunidades/opp-1/faturas/bill-1',
    );
    expect(screen.getByRole('link', { name: 'Ver / revalidar' })).toHaveAttribute(
      'href',
      '/crm/oportunidades/opp-1/faturas/bill-3',
    );
  });

  it('envia a fatura com a oportunidade e orienta a revisar os campos lidos', async () => {
    const upload = vi.spyOn(endpoints.energyBills, 'upload').mockResolvedValue(makeBill());
    const user = await open('Fatura');
    const file = new File(['%PDF-1.4 teste'], 'fatura-agosto.pdf', { type: 'application/pdf' });
    await user.upload(await screen.findByLabelText('Arquivo da fatura'), file);
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file, { opportunityId: 'opp-1' }));
    expect(await screen.findByText('Fatura enviada. Revise os campos lidos.')).toBeInTheDocument();
    upload.mockRestore();
  });

  it('sem leitura automática (imagem), orienta a preencher na revisão', async () => {
    const upload = vi
      .spyOn(endpoints.energyBills, 'upload')
      .mockResolvedValue(makeBill({ status: 'UPLOADED', extracted: {}, overallConfidence: null }));
    const user = await open('Fatura');
    await user.upload(
      await screen.findByLabelText('Arquivo da fatura'),
      new File(['x'], 'foto.png', { type: 'image/png' }),
    );
    expect(
      await screen.findByText('Fatura enviada. Preencha os campos na revisão.'),
    ).toBeInTheDocument();
    upload.mockRestore();
  });

  it('arquivo recusado pelo servidor mostra a mensagem', async () => {
    const upload = vi
      .spyOn(endpoints.energyBills, 'upload')
      .mockRejectedValue(
        new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de arquivo não permitido'),
      );
    const user = await open('Fatura');
    await user.upload(
      await screen.findByLabelText('Arquivo da fatura'),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText('Tipo de arquivo não permitido')).toBeInTheDocument();
    upload.mockRestore();
  });

  it('gera o link de download do arquivo', async () => {
    let asked = false;
    window.open = () => null;
    const user = await open('Fatura', {
      extra: [
        http.get(`${API}/energy-bills`, () => HttpResponse.json([makeBill()])),
        http.get(`${API}/energy-bills/bill-1/download-url`, () => {
          asked = true;
          return HttpResponse.json({ url: 'http://rustfs.test/arquivo', expiresIn: 300 });
        }),
      ],
    });
    await user.click(await screen.findByRole('button', { name: 'Baixar fatura.pdf' }));
    await waitFor(() => expect(asked).toBe(true));
  });

  it('perfil sem permissão de escrita em fatura não vê o envio nem a revisão', async () => {
    await open('Fatura', {
      session: makeSession('SDR', {
        permissions: ['crm.opportunity.read', 'crm.energy-bill.read'],
      }),
      extra: [bills()],
    });
    await screen.findByText('fatura.pdf');
    expect(screen.queryByLabelText('Arquivo da fatura')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Revisar' })).not.toBeInTheDocument();
  });
});

describe('Oportunidade · Cálculos e engenharia', () => {
  it('lista os cálculos vinculados e leva ao novo cálculo já com a oportunidade', async () => {
    await open('Cálculos', {
      extra: [
        http.get(`${API}/opportunities/${opp.id}/calculations`, () =>
          HttpResponse.json([
            makeCalculation({ opportunityId: opp.id }),
            makeCalculation({ id: 'calc-2', title: 'Cenário B', opportunityId: opp.id }),
          ]),
        ),
      ],
    });
    expect(await screen.findByRole('link', { name: 'Residência Silva' })).toHaveAttribute(
      'href',
      '/calculator/calc-1',
    );
    expect(screen.getByRole('link', { name: 'Cenário B' })).toBeInTheDocument();
    expect(screen.getAllByText('Pré-viável').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Novo cálculo/ })).toHaveAttribute(
      'href',
      '/calculator/new?opportunityId=opp-1',
    );
  });

  it('sem cálculos explica o que o botão faz', async () => {
    await open('Cálculos');
    expect(await screen.findByText(/já vem preenchido com a fatura validada/)).toBeInTheDocument();
  });

  it('vincula um cálculo existente que ainda não está em nenhuma oportunidade', async () => {
    let linked: unknown;
    const user = await open('Cálculos', {
      extra: [
        http.get(`${API}/calculations/quick`, () =>
          HttpResponse.json(
            page([
              makeCalculation({ id: 'livre', title: 'Livre' }),
              makeCalculation({ id: 'preso', title: 'Preso', opportunityId: 'opp-x' }),
            ]),
          ),
        ),
        http.post(`${API}/opportunities/${opp.id}/calculations/link`, async ({ request }) => {
          linked = ((await request.json()) as { sessionId: string }).sessionId;
          return HttpResponse.json(makeCalculation({ id: 'livre', opportunityId: opp.id }));
        }),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /Vincular existente/ }));
    const dialog = await screen.findByRole('dialog');
    const select = await within(dialog).findByLabelText('Cálculo');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    expect(within(select).queryByText(/Preso/)).not.toBeInTheDocument();
    await user.selectOptions(select, 'livre');
    await user.click(within(dialog).getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(linked).toBe('livre'));
  });

  it('perfil sem permissão de criar cálculo não vê os botões', async () => {
    await open('Cálculos', {
      session: makeSession('SALES_MANAGER', {
        permissions: ['crm.opportunity.read', 'calculator.session.read'],
      }),
    });
    await screen.findByText(/Nenhum cálculo ainda/);
    expect(screen.queryByRole('link', { name: /Novo cálculo/ })).not.toBeInTheDocument();
  });

  it('lista os pedidos de engenharia abertos pelo semáforo amarelo', async () => {
    await open('Engenharia', {
      extra: [
        http.get(`${API}/opportunities/${opp.id}/engineering-requests`, () =>
          HttpResponse.json([
            {
              id: 'er-1',
              opportunityId: opp.id,
              calculationSessionId: 'calc-1',
              reason: 'Cliente do Grupo A: análise de demanda',
              status: 'PENDING',
              createdAt: '2026-10-18T12:00:00.000Z',
            },
          ]),
        ),
      ],
    });
    expect(await screen.findByText('Cliente do Grupo A: análise de demanda')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  it('sem pedidos mostra o estado vazio', async () => {
    await open('Engenharia', {
      extra: [
        http.get(`${API}/opportunities/${opp.id}/engineering-requests`, () =>
          HttpResponse.json([]),
        ),
      ],
    });
    expect(await screen.findByText('Nenhum pedido de engenharia.')).toBeInTheDocument();
  });
});
