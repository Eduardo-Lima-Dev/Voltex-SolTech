import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { AiAdminSettingsDto } from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const settings = (enabled: boolean, demo = false): AiAdminSettingsDto => ({
  settings: { enabled, termsAcceptedBy: null, termsAcceptedAt: null },
  demo,
  legalReviewed: false,
  status: {
    available: enabled,
    code: null,
    message: enabled ? null : 'A IA está desligada para a sua empresa.',
    provider: 'demo',
    model: 'demo',
    quota: null,
  },
});

describe('administração: inteligência', () => {
  it('liga a IA só depois do aceite dos termos', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/ai/admin/settings`, () => HttpResponse.json(settings(false))),
      http.get(`${API}/ai/admin/usage`, () =>
        HttpResponse.json({
          days: [],
          totals: { neurons: 0, calls: 0, failures: 0, questions: 0 },
          today: {
            questions: 0,
            neurons: 0,
            averageNeuronsPerQuestion: null,
            estimatedQuestionsLeft: null,
            platform: { used: 0, limit: 9000 },
            insights: { used: 0, limit: 150 },
          },
        }),
      ),
      http.put(`${API}/ai/admin/settings`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settings(true));
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin/inteligencia', { session: makeSession('OWNER') });
    const button = await screen.findByRole('button', { name: 'Ligar a IA' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/revisão jurídica/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await user.click(button);
    await waitFor(() => expect(body).toEqual({ enabled: true, acceptTerms: true }));
  });

  it('mostra o uso e roda o diagnóstico', async () => {
    server.use(
      http.get(`${API}/ai/admin/settings`, () => HttpResponse.json(settings(true, true))),
      http.get(`${API}/ai/admin/usage`, () =>
        HttpResponse.json({
          days: [
            {
              day: '2026-10-25',
              purpose: 'CHAT',
              neurons: 120,
              calls: 4,
              failures: 1,
              questions: 3,
            },
          ],
          totals: { neurons: 120, calls: 4, failures: 1, questions: 3 },
          today: {
            questions: 3,
            neurons: 120,
            averageNeuronsPerQuestion: 40,
            estimatedQuestionsLeft: 34,
            platform: { used: 1200, limit: 9000 },
            insights: { used: 0, limit: 150 },
          },
        }),
      ),
      http.post(`${API}/ai/admin/diagnostics`, () =>
        HttpResponse.json({
          ok: true,
          text: 'ok',
          model: 'demo',
          neurons: 3,
          durationMs: 420,
          code: null,
          message: null,
        }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/admin/inteligencia', { session: makeSession('OWNER') });
    expect(await screen.findByText('Empresa de demonstração')).toBeInTheDocument();
    expect(await screen.findByText('Assistente')).toBeInTheDocument();
    const today = screen.getByLabelText('Uso de hoje');
    expect(today).toHaveTextContent('Perguntas hoje');
    expect(today).toHaveTextContent('~34 perguntas');
    expect(today).toHaveTextContent('Média de 40 pontos por pergunta');
    expect(today).toHaveTextContent('1.200 de 9.000');
    await user.click(screen.getByRole('button', { name: 'Testar a IA' }));
    expect(await screen.findByText(/Funcionou em 420 ms/)).toBeInTheDocument();
  });

  it('esconde a aba de quem não administra a IA', async () => {
    renderApp('/admin/inteligencia', { session: makeSession('SALESPERSON') });
    expect(await screen.findByText(/sem acesso|Sem acesso/)).toBeInTheDocument();
  });
});

describe('administração: parâmetros de análise', () => {
  it('mostra os padrões, valida e salva os mínimos de amostra da empresa', async () => {
    let body: { minSamples: Record<string, number>; stalledDays: number } | null = null;
    const current = {
      minSamples: {
        potentialClients: 25,
        groupSize: 5,
        funnelClosed: 30,
        receivablesPaid: 20,
        installationsDone: 10,
        generationDays: 14,
        simpleAverage: 5,
      },
      bestClientShare: 0.2,
      bestClientCriterion: 'MARGIN',
      stalledDays: 14,
      usingDefaults: true,
    };
    server.use(
      http.get(`${API}/ai/admin/settings`, () => HttpResponse.json(settings(true, true))),
      http.get(`${API}/ai/admin/usage`, () =>
        HttpResponse.json({
          days: [],
          totals: { neurons: 0, calls: 0, failures: 0, questions: 0 },
          today: {
            questions: 0,
            neurons: 0,
            averageNeuronsPerQuestion: null,
            estimatedQuestionsLeft: null,
            platform: { used: 0, limit: 9000 },
            insights: { used: 0, limit: 150 },
          },
        }),
      ),
      http.get(`${API}/analytics/settings`, () => HttpResponse.json(current)),
      http.put(`${API}/analytics/settings`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...current, usingDefaults: false });
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin/inteligencia', { session: makeSession('OWNER') });
    const field = await screen.findByLabelText(/Parcelas pagas/);
    expect(field).toHaveValue('20');
    expect(screen.getByText(/padrões do sistema/)).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '2');
    await user.click(screen.getByRole('button', { name: 'Salvar parâmetros' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/de 3 a 1\.000/);
    await user.clear(field);
    await user.type(field, '12');
    await user.click(screen.getByRole('button', { name: 'Salvar parâmetros' }));
    await waitFor(() => expect(body?.minSamples.receivablesPaid).toBe(12));
    expect(body!.stalledDays).toBe(14);
  });
});
