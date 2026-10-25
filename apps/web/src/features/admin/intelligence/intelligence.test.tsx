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
        HttpResponse.json({ days: [], totals: { neurons: 0, calls: 0, failures: 0 } }),
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
          days: [{ day: '2026-10-25', purpose: 'CHAT', neurons: 120, calls: 4, failures: 1 }],
          totals: { neurons: 120, calls: 4, failures: 1 },
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
    await user.click(screen.getByRole('button', { name: 'Testar a IA' }));
    expect(await screen.findByText(/Funcionou em 420 ms/)).toBeInTheDocument();
  });

  it('esconde a aba de quem não administra a IA', async () => {
    renderApp('/admin/inteligencia', { session: makeSession('SALESPERSON') });
    expect(await screen.findByText(/sem acesso|Sem acesso/)).toBeInTheDocument();
  });
});
