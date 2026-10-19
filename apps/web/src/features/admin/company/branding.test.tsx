import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { endpoints } from '@/lib/api/endpoints';
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
];

describe('Empresa · Identidade visual das propostas', () => {
  it('salva a cor principal', async () => {
    let body: unknown;
    server.use(
      ...base(),
      http.get(`${API}/branding`, () => HttpResponse.json({})),
      http.put(`${API}/branding`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderApp('/admin/empresa', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Cor principal');
    await user.clear(input);
    await user.type(input, 'verde');
    expect(await screen.findByText('Use o formato #RRGGBB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar cor' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '#112233');
    await user.click(screen.getByRole('button', { name: 'Salvar cor' }));
    await waitFor(() => expect(body).toEqual({ primaryColor: '#112233' }));
  });

  it('envia a logo como documento e a associa à empresa; recusa tipo inválido', async () => {
    const upload = vi
      .spyOn(endpoints.documents, 'upload')
      .mockResolvedValue({ id: 'doc-logo' } as never);
    let body: unknown;
    server.use(
      ...base(),
      http.get(`${API}/branding`, () => HttpResponse.json({})),
      http.put(`${API}/branding`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderApp('/admin/empresa', { session: makeSession('OWNER') });
    const user = userEvent.setup({ applyAccept: false });
    const input = await screen.findByLabelText('Enviar logo');

    await user.upload(input, new File(['x'], 'logo.gif', { type: 'image/gif' }));
    expect(await screen.findByText('Use uma imagem PNG ou JPEG')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();

    await user.upload(input, new File(['x'], 'logo.png', { type: 'image/png' }));
    await waitFor(() => expect(body).toEqual({ logoDocumentId: 'doc-logo' }));
    upload.mockRestore();
  });

  it('remove a logo cadastrada', async () => {
    let body: unknown;
    server.use(
      ...base(),
      http.get(`${API}/branding`, () => HttpResponse.json({ logoDocumentId: 'doc-1' })),
      http.put(`${API}/branding`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderApp('/admin/empresa', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remover logo' }));
    await waitFor(() => expect(body).toEqual({ logoDocumentId: null }));
  });
});
