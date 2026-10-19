import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makePolicy, makeSession, team } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('Administração · Margens', () => {
  it('lista as políticas e mostra o alcance de cada uma', async () => {
    server.use(
      http.get(`${API}/margin-policies`, () =>
        HttpResponse.json([
          makePolicy(),
          makePolicy({
            id: 'p2',
            name: 'Off-grid',
            minMarginRate: 0.3,
            projectType: 'OFF_GRID',
            teamId: 't-1',
            active: false,
          }),
        ]),
      ),
      http.get(`${API}/teams`, () => HttpResponse.json([team()])),
    );
    renderApp('/admin/margens', { session: makeSession('OWNER') });
    expect(await screen.findByText('Mínimo geral')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('Todos os tipos de projeto · Todos os times')).toBeInTheDocument();
    expect(screen.getByText('Off-grid · Comercial')).toBeInTheDocument();
    expect(screen.getByText('Inativa')).toBeInTheDocument();
  });

  it('cria uma política validando o percentual', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/margin-policies`, () => HttpResponse.json([])),
      http.get(`${API}/teams`, () => HttpResponse.json([team()])),
      http.post(`${API}/margin-policies`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makePolicy(), { status: 201 });
      }),
    );
    renderApp('/admin/margens', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    expect(await screen.findByText(/Nenhuma política cadastrada/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Nova política/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'Mínimo geral');
    await user.type(within(dialog).getByLabelText('Margem mínima (%)'), '120');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Informe um percentual entre 0 e 95'),
    ).toBeInTheDocument();
    expect(body).toBeUndefined();
    await user.clear(within(dialog).getByLabelText('Margem mínima (%)'));
    await user.type(within(dialog).getByLabelText('Margem mínima (%)'), '22,5');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(body).toEqual({ name: 'Mínimo geral', minMarginRate: 0.225 }));
  });

  it('ativa/desativa e exclui depois de confirmar', async () => {
    let patched: Record<string, unknown> | undefined;
    let deleted = false;
    server.use(
      http.get(`${API}/margin-policies`, () => HttpResponse.json([makePolicy()])),
      http.get(`${API}/teams`, () => HttpResponse.json([])),
      http.patch(`${API}/margin-policies/policy-1`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makePolicy({ active: false }));
      }),
      http.delete(`${API}/margin-policies/policy-1`, () => {
        deleted = true;
        return HttpResponse.json({ id: 'policy-1' });
      }),
    );
    renderApp('/admin/margens', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Desativar Mínimo geral' }));
    await waitFor(() => expect(patched).toEqual({ active: false }));
    await user.click(screen.getByRole('button', { name: 'Excluir Mínimo geral' }));
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('administrador sem a permissão de margens não vê a aba', async () => {
    renderApp('/admin/empresa', { session: makeSession('FINANCE') });
    expect(screen.queryByRole('link', { name: /Margens/ })).not.toBeInTheDocument();
  });
});
