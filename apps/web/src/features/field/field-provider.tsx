import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { FieldEngine, type FieldState } from './field-engine';
import { openFieldDb } from './field-db';
import { getPosition } from './media';

interface FieldContextValue {
  engine: FieldEngine;
  state: FieldState;
}

const FieldContext = createContext<FieldContextValue | null>(null);

const SYNC_EVERY_MS = 60_000;

export function useField(): FieldContextValue {
  const ctx = useContext(FieldContext);
  if (!ctx) throw new Error('useField deve ser usado dentro de <FieldProvider>');
  return ctx;
}

interface FieldProviderProps {
  children: ReactNode;
  /** Mostrado enquanto o banco do aparelho e a sessão carregam. */
  loading: ReactNode;
  /** Sem sessão e sem perfil guardado: sem internet não há o que mostrar. */
  noAccess: ReactNode;
}

/**
 * Cria o motor do campo, liga-o à sessão e à conexão e o mantém sincronizando. Com sessão, usa o usuário logado;
 * sem sessão (sem internet, ou login vencido), abre com o perfil guardado no aparelho para o técnico continuar
 * trabalhando, e avisa que precisa entrar de novo para enviar.
 */
export function FieldProvider({ children, loading, noAccess }: FieldProviderProps) {
  const [engine, setEngine] = useState<FieldEngine | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openFieldDb()
      .then((db) => {
        if (cancelled) return;
        setEngine(
          new FieldEngine({
            db,
            endpoints,
            isOnline: () => navigator.onLine,
            position: () => getPosition(),
          }),
        );
      })
      // Navegação privada de alguns navegadores não deixa usar o IndexedDB.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // A tela saiu: o motor para de enviar e de atualizar.
  useEffect(() => () => engine?.dispose(), [engine]);

  if (failed)
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        Este navegador não permite guardar dados no aparelho. Saia da navegação anônima para usar o
        app de campo.
      </p>
    );
  if (!engine) return <>{loading}</>;
  return (
    <Bound engine={engine} loading={loading} noAccess={noAccess}>
      {children}
    </Bound>
  );
}

function Bound({
  engine,
  children,
  loading,
  noAccess,
}: FieldProviderProps & { engine: FieldEngine }) {
  const { status, user } = useAuth();
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const [noProfile, setNoProfile] = useState(false);
  const userId = user?.id ?? null;
  const userName = user?.name ?? null;

  // Quem está usando: o usuário da sessão ou o perfil guardado no aparelho.
  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;
    void (async () => {
      if (status === 'authenticated' && userId && userName) {
        await engine.setUser({ id: userId, name: userName });
        if (cancelled) return;
        await engine.refresh();
        await engine.flush();
        return;
      }
      const profile = await engine.cachedProfile();
      if (cancelled) return;
      if (!profile) {
        setNoProfile(true);
        return;
      }
      await engine.setUser({ id: profile.userId, name: profile.name }, { persist: false });
      engine.requireLogin();
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, status, userId, userName]);

  // Conexão: voltou → envia; periodicamente (e ao voltar para a aba) envia e atualiza.
  useEffect(() => {
    engine.setOnline(navigator.onLine);
    const onOnline = () => engine.setOnline(true);
    const onOffline = () => engine.setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void engine.flush().then(() => engine.refresh());
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (navigator.onLine) void engine.flush().then(() => engine.refresh());
    }, SYNC_EVERY_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [engine]);

  if (noProfile && status !== 'authenticated') return <>{noAccess}</>;
  if (!state.ready || !state.user) return <>{loading}</>;
  return <FieldContext.Provider value={{ engine, state }}>{children}</FieldContext.Provider>;
}
