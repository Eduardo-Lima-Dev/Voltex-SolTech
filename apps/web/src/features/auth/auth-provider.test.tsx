import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '@/lib/api/client';
import { createEndpoints } from '@/lib/api/endpoints';
import { makeSession } from '@/test/fixtures';
import { AuthProvider, useAuth } from './auth-provider';
import { SessionStore } from './session-store';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Probe() {
  const { status, user, can, canAny, login, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.email ?? '-'}</p>
      <p data-testid="can-margin">{String(can('crm.margin.approve'))}</p>
      <p data-testid="can-both">{String(can(['crm.lead.read', 'crm.margin.approve']))}</p>
      <p data-testid="can-any">{String(canAny(['engine.project.approve', 'crm.lead.read']))}</p>
      <button onClick={() => void login({ email: 'a@b.com', password: '12345678' })}>login</button>
      <button onClick={() => void logout().catch(() => undefined)}>logout</button>
    </div>
  );
}

function setup(
  handler: (url: string) => Response | Promise<Response>,
  { hint = true }: { hint?: boolean } = {},
) {
  if (hint) localStorage.setItem('voltex:session', '1');
  const store = new SessionStore();
  const fetchMock = vi.fn(async (url: string) => handler(url));
  const client = new ApiClient({
    baseUrl: 'http://api.test/api/v1',
    getToken: () => store.getState().accessToken,
    onSession: store.setSession,
    onUnauthenticated: store.clear,
    fetch: fetchMock as unknown as typeof fetch,
  });
  const queryClient = new QueryClient();
  const ui = (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={client} endpoints={createEndpoints(client)} store={store}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>
  );
  return { store, fetchMock, queryClient, ui };
}

describe('AuthProvider', () => {
  it('restaura a sessão pelo cookie de refresh quando há dica de sessão anterior', async () => {
    const { ui, store } = setup((url) =>
      url.endsWith('/auth/refresh') ? json(makeSession('SALESPERSON')) : json({}),
    );
    render(ui);
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('salesperson@voltex.test');
    expect(store.getState().accessToken).toBe('token-SALESPERSON');
  });

  it('sem dica de sessão, vai direto para "não autenticado" sem chamar a rede', async () => {
    const { ui, fetchMock } = setup(() => json({}), { hint: false });
    render(ui);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh recusado: fica deslogado e apaga a dica', async () => {
    const { ui } = setup(() => new Response('', { status: 401 }));
    render(ui);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(localStorage.getItem('voltex:session')).toBeNull();
  });

  it('StrictMode (efeitos em dobro) faz uma única renovação', async () => {
    const { ui, fetchMock } = setup((url) =>
      url.endsWith('/auth/refresh') ? json(makeSession('OWNER')) : json({}),
    );
    render(<StrictMode>{ui}</StrictMode>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh')),
    ).toHaveLength(1);
  });

  it('login abre a sessão e grava a dica; logout encerra, limpa o cache e apaga a dica', async () => {
    const { ui, queryClient } = setup(
      (url) =>
        url.endsWith('/auth/login')
          ? json(makeSession('OWNER'))
          : new Response(null, { status: 204 }),
      { hint: false },
    );
    render(ui);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

    await act(async () => screen.getByText('login').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(localStorage.getItem('voltex:session')).toBe('1');

    queryClient.setQueryData(['x'], 1);
    await act(async () => screen.getByText('logout').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(queryClient.getQueryData(['x'])).toBeUndefined();
    expect(localStorage.getItem('voltex:session')).toBeNull();
  });

  it('logout encerra a sessão local mesmo se o servidor estiver fora do ar', async () => {
    const { ui } = setup((url) => {
      if (url.endsWith('/auth/refresh')) return json(makeSession('OWNER'));
      throw new TypeError('Failed to fetch');
    });
    render(ui);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await act(async () => screen.getByText('logout').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('can() exige todas as permissões e canAny() basta uma', async () => {
    const { ui } = setup((url) =>
      url.endsWith('/auth/refresh') ? json(makeSession('SALESPERSON')) : json({}),
    );
    render(ui);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('can-margin')).toHaveTextContent('false'); // vendedor não aprova margem
    expect(screen.getByTestId('can-both')).toHaveTextContent('false');
    expect(screen.getByTestId('can-any')).toHaveTextContent('true');
  });

  it('useAuth fora do provider lança erro claro', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});
