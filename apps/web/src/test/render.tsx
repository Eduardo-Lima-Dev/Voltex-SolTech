import { render, type RenderResult } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '@/app/providers';
import { createTestRouter } from '@/app/router';
import { sessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/api/endpoints';
import { makeSession } from './fixtures';
import type { SessionResponse } from '@voltex/shared';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

interface RenderAppOptions {
  /** Sessão já aberta. `null` = visitante sem login. Padrão: proprietário. */
  session?: SessionResponse | null;
}

/** Renderiza a aplicação inteira (rotas reais) em um caminho, com a sessão escolhida. */
export function renderApp(
  path: string,
  { session = makeSession('OWNER') }: RenderAppOptions = {},
): RenderResult & { router: ReturnType<typeof createTestRouter>; queryClient: QueryClient } {
  if (session) sessionStore.setSession(session);
  else sessionStore.clear();

  const queryClient = createTestQueryClient();
  const router = createTestRouter([path]);
  const utils = render(
    <AppProviders queryClient={queryClient} client={api} endpoints={endpoints} store={sessionStore}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router, queryClient };
}
