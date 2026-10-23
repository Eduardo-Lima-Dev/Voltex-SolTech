import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AcceptInvitationInput,
  CurrentUser,
  LoginInput,
  MfaChallengeDto,
  Permission,
  SessionResponse,
} from '@voltex/shared';
import type { ApiClient } from '@/lib/api/client';
import type { Endpoints } from '@/lib/api/endpoints';
import {
  sessionStore as defaultStore,
  type SessionStore,
  type SessionStatus,
} from './session-store';

interface AuthContextValue {
  status: SessionStatus;
  user: CurrentUser | null;
  /** Devolve o desafio do segundo fator, ou `null` quando a sessão já foi aberta. */
  login: (input: LoginInput) => Promise<MfaChallengeDto | null>;
  /** Abre a sessão com o resultado de uma etapa do segundo fator. */
  establishSession: (session: SessionResponse) => void;
  acceptInvitation: (input: AcceptInvitationInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Verdadeiro se o usuário tem a permissão (todas, se vier uma lista). */
  can: (permission: Permission | readonly Permission[]) => boolean;
  /** Verdadeiro se tem ao menos uma das permissões. */
  canAny: (permissions: readonly Permission[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  client: ApiClient;
  endpoints: Endpoints;
  store?: SessionStore;
}

/** Restaura a sessão uma única vez por store (o StrictMode executa efeitos em dobro em desenvolvimento). */
const bootstrapped = new WeakSet<SessionStore>();

export function AuthProvider({
  children,
  client,
  endpoints,
  store = defaultStore,
}: AuthProviderProps) {
  const queryClient = useQueryClient();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    if (bootstrapped.has(store)) return;
    bootstrapped.add(store);
    // Sessão já definida (login recém-feito, recarga de módulo em desenvolvimento): nada a restaurar.
    if (store.getState().status !== 'loading') return;
    if (!store.mayHaveSession()) {
      store.clear();
      return;
    }
    void client.refreshSession().then((session) => {
      if (!session) store.clear();
    });
  }, [client, store]);

  const login = useCallback(
    async (input: LoginInput): Promise<MfaChallengeDto | null> => {
      const result = await endpoints.auth.login(input);
      if ('mfaToken' in result) return result;
      store.setSession(result);
      return null;
    },
    [endpoints, store],
  );

  const establishSession = useCallback(
    (session: SessionResponse) => store.setSession(session),
    [store],
  );

  const acceptInvitation = useCallback(
    async (input: AcceptInvitationInput) => {
      store.setSession(await endpoints.auth.acceptInvitation(input));
    },
    [endpoints, store],
  );

  const logout = useCallback(async () => {
    try {
      await endpoints.auth.logout();
    } finally {
      // Mesmo que a chamada falhe (rede), a sessão local termina e os dados em cache são descartados.
      store.clear();
      queryClient.clear();
    }
  }, [endpoints, store, queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const granted = new Set<string>(state.user?.permissions ?? []);
    const can = (permission: Permission | readonly Permission[]) =>
      (Array.isArray(permission) ? permission : [permission]).every((p) => granted.has(p));
    return {
      status: state.status,
      user: state.user,
      login,
      establishSession,
      acceptInvitation,
      logout,
      can,
      canAny: (permissions) => permissions.some((p) => granted.has(p)),
    };
  }, [state, login, establishSession, acceptInvitation, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return context;
}

/** Usuário autenticado (use dentro de rotas protegidas). */
export function useCurrentUser(): CurrentUser {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser usado sem usuário autenticado');
  return user;
}
