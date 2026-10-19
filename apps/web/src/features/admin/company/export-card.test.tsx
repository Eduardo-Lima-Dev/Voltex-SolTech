import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, branch, makeSession, team } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const tenant = {
  id: 't',
  name: 'Voltex Demo',
  slug: 'voltex-demo',
  document: null,
  status: 'ACTIVE',
  settings: {},
  createdAt: '2026-01-01T00:00:00Z',
};
const base = () => [
  http.get(`${API}/tenant`, () => HttpResponse.json(tenant)),
  http.get(`${API}/branches`, () => HttpResponse.json([branch()])),
  http.get(`${API}/teams`, () => HttpResponse.json([team()])),
  http.get(`${API}/branding`, () => HttpResponse.json({})),
];

describe('Empresa · Exportar dados (LGPD)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('baixa o arquivo JSON com os dados da empresa', async () => {
    let blob: Blob | undefined;
    // O jsdom não implementa URL.createObjectURL.
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blob = b as Blob;
      return 'blob:teste';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    server.use(
      ...base(),
      http.get(`${API}/tenant/export`, () =>
        HttpResponse.json({ exportVersion: 1, accounts: [{ name: 'Cliente' }] }),
      ),
    );
    renderApp('/admin/empresa', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Exportar dados' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(JSON.parse(await blob!.text())).toMatchObject({
      exportVersion: 1,
      accounts: [{ name: 'Cliente' }],
    });
    expect(await screen.findByText('Exportação gerada')).toBeInTheDocument();
  });

  it('mostra o erro quando a exportação falha', async () => {
    server.use(
      ...base(),
      http.get(`${API}/tenant/export`, () =>
        HttpResponse.json(
          { statusCode: 429, code: 'TOO_MANY_REQUESTS', message: 'Muitas requisições' },
          { status: 429 },
        ),
      ),
    );
    renderApp('/admin/empresa', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Exportar dados' }));
    expect(await screen.findByText(/Muitas requisições/)).toBeInTheDocument();
  });
});
