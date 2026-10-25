import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { AiChatEvent, AiChatResponseDto, AiStatusDto } from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const status = (overrides: Partial<AiStatusDto> = {}): AiStatusDto => ({
  available: true,
  code: null,
  message: null,
  provider: 'cloudflare',
  model: 'qwen3',
  quota: {
    tenant: { limit: 1500, used: 10, remaining: 1490 },
    user: { limit: 300, used: 30, remaining: 270 },
    resetsAt: '2026-10-26T00:00:00.000Z',
  },
  ...overrides,
});

const answer = (overrides: Partial<AiChatResponseDto> = {}): AiChatResponseDto => ({
  conversationId: 'c1c1c1c1-0000-4000-8000-000000000001',
  notice: null,
  message: {
    id: 'm-1',
    role: 'ASSISTANT',
    text: 'Você recebeu R$ 5.940,00.',
    parts: [
      { type: 'text', text: 'Você recebeu ' },
      { type: 'fact', factId: 'F1', text: 'R$ 5.940,00' },
      { type: 'text', text: '.' },
    ],
    kind: 'ANSWER',
    cannotAnswerReason: null,
    facts: [
      {
        id: 'F1',
        text: 'R$ 5.940,00',
        type: 'MONEY',
        tool: 'finance_overview',
        toolLabel: 'Visão do financeiro',
        field: 'receivedLast30DaysCents',
        queriedAt: '2026-10-25T12:00:00.000Z',
      },
    ],
    followUps: ['E as parcelas vencidas?'],
    removed: {},
    helpful: null,
    createdAt: '2026-10-25T12:00:00.000Z',
  },
  ...overrides,
});

/** Resposta em fluxo (SSE) com os eventos dados. */
function stream(events: AiChatEvent[]) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } });
}

async function openPanel() {
  const user = userEvent.setup();
  renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Pergunte ao Voltex' }));
  return user;
}

describe('assistente de IA', () => {
  it('mostra o botão só para quem tem a permissão', async () => {
    renderApp('/', { session: makeSession('CUSTOMER') });
    await screen.findByRole('main');
    expect(screen.queryByRole('button', { name: 'Pergunte ao Voltex' })).not.toBeInTheDocument();
  });

  it('pergunta, mostra progresso, resposta com chip de origem e o selo de IA', async () => {
    server.use(
      http.get(`${API}/ai/status`, () => HttpResponse.json(status())),
      http.post(`${API}/ai/chat`, () =>
        stream([
          { type: 'progress', label: 'Consultando o financeiro…' },
          { type: 'answer', data: answer() },
        ]),
      ),
    );
    const user = await openPanel();
    const box = await screen.findByLabelText('Sua pergunta');
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'Quanto recebi nos últimos 30 dias?');
    await user.click(screen.getByRole('button', { name: 'Enviar pergunta' }));

    const message = await screen.findByTestId('assistant-message');
    expect(within(message).getByText(/Você recebeu/)).toBeInTheDocument();
    expect(screen.getByText(/Gerado por IA a partir dos dados do sistema/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /R\$ 5\.940,00: ver de onde veio/ }));
    expect(screen.getByRole('note')).toHaveTextContent('Visão do financeiro');
    expect(screen.getByRole('note')).toHaveTextContent('receivedLast30DaysCents');

    await user.click(screen.getByRole('button', { name: 'Ver os dados' }));
    expect(screen.getByRole('button', { name: 'Ocultar os dados' })).toBeInTheDocument();
  });

  it('mostra o aviso de dado pessoal removido', async () => {
    server.use(
      http.get(`${API}/ai/status`, () => HttpResponse.json(status())),
      http.post(`${API}/ai/chat`, () =>
        stream([{ type: 'answer', data: answer({ notice: 'Removi um CPF da sua pergunta.' }) }]),
      ),
    );
    const user = await openPanel();
    const box = await screen.findByLabelText('Sua pergunta');
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'Resuma o cliente 123');
    await user.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    expect(await screen.findByText('Removi um CPF da sua pergunta.')).toBeInTheDocument();
  });

  it('com a IA indisponível mostra a mensagem do servidor e bloqueia o envio', async () => {
    server.use(
      http.get(`${API}/ai/status`, () =>
        HttpResponse.json(
          status({
            available: false,
            code: 'QUOTA_USER',
            message: 'Você atingiu o limite de hoje.',
            quota: null,
          }),
        ),
      ),
    );
    await openPanel();
    expect(await screen.findByText('Você atingiu o limite de hoje.')).toBeInTheDocument();
    expect(screen.getByLabelText('Sua pergunta')).toBeDisabled();
  });

  it('mostra a mensagem pronta quando o fluxo termina em erro', async () => {
    server.use(
      http.get(`${API}/ai/status`, () => HttpResponse.json(status())),
      http.post(`${API}/ai/chat`, () =>
        stream([
          { type: 'error', code: 'AI_TIMEOUT', message: 'A IA demorou demais.', status: 503 },
        ]),
      ),
    );
    const user = await openPanel();
    const box = await screen.findByLabelText('Sua pergunta');
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'Como está o funil?');
    await user.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A IA demorou demais.');
  });

  it('envia a avaliação e lista e apaga conversas do histórico', async () => {
    let feedback: unknown;
    let removed = false;
    server.use(
      http.get(`${API}/ai/status`, () => HttpResponse.json(status())),
      http.post(`${API}/ai/chat`, () => stream([{ type: 'answer', data: answer() }])),
      http.post(`${API}/ai/messages/m-1/feedback`, async ({ request }) => {
        feedback = await request.json();
        return HttpResponse.json({});
      }),
      http.get(`${API}/ai/conversations`, () =>
        HttpResponse.json(
          removed
            ? []
            : [
                {
                  id: 'c-9',
                  title: 'Funil de vendas',
                  updatedAt: '2026-10-25T12:00:00.000Z',
                  messagesCount: 2,
                },
              ],
        ),
      ),
      http.delete(`${API}/ai/conversations/c-9`, () => {
        removed = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = await openPanel();
    const box = await screen.findByLabelText('Sua pergunta');
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'Quanto recebi?');
    await user.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    await screen.findByTestId('assistant-message');

    await user.click(screen.getByRole('button', { name: 'Resposta útil' }));
    await waitFor(() => expect(feedback).toEqual({ helpful: true }));

    await user.click(screen.getByRole('button', { name: /Histórico/ }));
    expect(await screen.findByText('Funil de vendas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Apagar a conversa Funil de vendas/ }));
    expect(await screen.findByText('Nenhuma conversa ainda.')).toBeInTheDocument();
  });
});
