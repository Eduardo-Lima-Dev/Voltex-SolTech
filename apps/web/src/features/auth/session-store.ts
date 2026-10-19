import type { CurrentUser, SessionResponse } from '@voltex/shared';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  status: SessionStatus;
  /** Access token só em memória (nunca em localStorage): o refresh fica em cookie httpOnly. */
  accessToken: string | null;
  user: CurrentUser | null;
}

type Listener = () => void;

const HINT_KEY = 'voltex:session';

/**
 * Dica (não secreta) de que este navegador teve uma sessão. O refresh token fica em cookie httpOnly, que o
 * JavaScript não enxerga; sem a dica, toda visita ao login faria uma chamada de renovação fadada a falhar (401).
 * A dica nunca concede acesso: quem decide é o servidor.
 */
const hint = {
  /** `false` só quando o armazenamento funciona e não há dica; se ele estiver indisponível, tenta renovar. */
  mayHaveSession(): boolean {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return true;
    }
  },
  set(): void {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // sem armazenamento: segue sem dica
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(HINT_KEY);
    } catch {
      // idem
    }
  },
};

/** Store externo mínimo (compatível com `useSyncExternalStore`). O estado muda por substituição do objeto. */
export class SessionStore {
  private state: SessionState = { status: 'loading', accessToken: null, user: null };
  private readonly listeners = new Set<Listener>();

  getState = (): SessionState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Verdadeiro se vale tentar restaurar a sessão pelo cookie de refresh. */
  mayHaveSession = (): boolean => hint.mayHaveSession();

  setSession = (session: SessionResponse): void => {
    hint.set();
    this.set({ status: 'authenticated', accessToken: session.accessToken, user: session.user });
  };

  /** Sem sessão (login necessário). */
  clear = (): void => {
    hint.clear();
    this.set({ status: 'unauthenticated', accessToken: null, user: null });
  };

  private set(next: SessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export const sessionStore = new SessionStore();
