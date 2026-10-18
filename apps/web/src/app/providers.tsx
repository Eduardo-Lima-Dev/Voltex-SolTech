import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Toaster } from '@voltex/ui';
import { AuthProvider } from '@/features/auth/auth-provider';
import type { SessionStore } from '@/features/auth/session-store';
import type { ApiClient } from '@/lib/api/client';
import type { Endpoints } from '@/lib/api/endpoints';
import { ThemeProvider, useTheme } from './theme';

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} richColors closeButton position="top-right" />;
}

interface AppProvidersProps {
  children: ReactNode;
  queryClient: QueryClient;
  client: ApiClient;
  endpoints: Endpoints;
  store?: SessionStore;
}

/** Tema → cache de consultas → autenticação. Recebe as dependências por parâmetro para poder ser testado. */
export function AppProviders({
  children,
  queryClient,
  client,
  endpoints,
  store,
}: AppProvidersProps) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client} endpoints={endpoints} store={store}>
          {children}
          <ThemedToaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
