import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeSession, makeTask, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('CRM · Tarefas', () => {
  it('mostra as minhas tarefas em aberto por padrão, com prazo, atraso e link para a oportunidade', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/tasks`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page([
            makeTask({ title: 'Ligar para o cliente', overdue: true }),
            makeTask({
              id: 'task-2',
              title: 'Enviar proposta',
              opportunityId: null,
              description: 'Versão com 2 cenários',
            }),
          ]),
        );
      }),
    );
    renderApp('/crm/tarefas');
    expect(await screen.findByText('Ligar para o cliente')).toBeInTheDocument();
    expect(screen.getByText('Atrasada')).toBeInTheDocument();
    expect(screen.getByText('Versão com 2 cenários')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Ver oportunidade' })).toHaveLength(1);
    expect(queries[0]?.get('status')).toBe('OPEN');
    expect(queries[0]?.get('assigneeId')).toBe('user-owner');
  });

  it('filtra por situação e por responsável', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/tasks`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([]));
      }),
    );
    renderApp('/crm/tarefas');
    const user = userEvent.setup();
    await screen.findByText('Nenhuma tarefa.');
    await user.selectOptions(screen.getByLabelText('Filtrar tarefas'), 'overdue');
    await waitFor(() => expect(queries.at(-1)?.get('overdue')).toBe('true'));
    expect(queries.at(-1)?.get('status')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Filtrar tarefas'), 'done');
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('DONE'));
    await user.selectOptions(screen.getByLabelText('Responsável'), 'all');
    await waitFor(() => expect(queries.at(-1)?.get('assigneeId')).toBeNull());
  });

  it('conclui uma tarefa e depois a reabre', async () => {
    let status: 'OPEN' | 'DONE' = 'OPEN';
    const calls: string[] = [];
    server.use(
      http.get(`${API}/tasks`, () => HttpResponse.json(page([makeTask({ status })]))),
      http.post(`${API}/tasks/task-1/complete`, () => {
        status = 'DONE';
        calls.push('complete');
        return HttpResponse.json(makeTask({ status }));
      }),
      http.patch(`${API}/tasks/task-1`, async ({ request }) => {
        status = ((await request.json()) as { status: 'OPEN' }).status;
        calls.push(`patch:${status}`);
        return HttpResponse.json(makeTask({ status }));
      }),
    );
    renderApp('/crm/tarefas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Concluir Ligar para o cliente' }));
    await user.click(await screen.findByRole('button', { name: 'Reabrir Ligar para o cliente' }));
    await waitFor(() => expect(calls).toEqual(['complete', 'patch:OPEN']));
  });

  it('cria uma tarefa avulsa (sem oportunidade) com prazo', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/tasks`, () => HttpResponse.json(page([]))),
      http.post(`${API}/tasks`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeTask(), { status: 201 });
      }),
    );
    renderApp('/crm/tarefas');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Nova tarefa/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('O que fazer'), 'Conferir estoque de módulos');
    await user.type(within(dialog).getByLabelText('Detalhes (opcional)'), 'Ver 550 Wp');
    await user.click(within(dialog).getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ title: 'Conferir estoque de módulos', description: 'Ver 550 Wp' });
    expect(body).not.toHaveProperty('opportunityId');
    expect(new Date(body!.dueAt as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('só leitura: sem botão de nova tarefa; erro de carregamento não quebra', async () => {
    server.use(http.get(`${API}/tasks`, () => HttpResponse.json(page([makeTask()]))));
    const { unmount } = renderApp('/crm/tarefas', {
      session: makeSession('SDR', { permissions: ['crm.task.read'] }),
    });
    await screen.findByText('Ligar para o cliente');
    expect(screen.queryByRole('button', { name: /Nova tarefa/ })).not.toBeInTheDocument();
    unmount();
    server.use(
      http.get(`${API}/tasks`, () =>
        HttpResponse.json({ statusCode: 500, code: 'X', message: 'x' }, { status: 500 }),
      ),
    );
    renderApp('/crm/tarefas');
    expect(await screen.findByText('Não foi possível carregar as tarefas.')).toBeInTheDocument();
  });
});
