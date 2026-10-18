import { describe, expect, it, vi } from 'vitest';
import { makeSession } from '@/test/fixtures';
import { SessionStore } from './session-store';

describe('SessionStore', () => {
  it('começa carregando, abre e encerra a sessão notificando quem assina', () => {
    const store = new SessionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getState()).toEqual({ status: 'loading', accessToken: null, user: null });

    store.setSession(makeSession('OWNER'));
    expect(store.getState()).toMatchObject({ status: 'authenticated', accessToken: 'token-OWNER' });
    store.clear();
    expect(store.getState()).toEqual({ status: 'unauthenticated', accessToken: null, user: null });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.setSession(makeSession('OWNER'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('cada mudança troca o objeto de estado (requisito do useSyncExternalStore)', () => {
    const store = new SessionStore();
    const before = store.getState();
    store.setSession(makeSession('OWNER'));
    expect(store.getState()).not.toBe(before);
  });

  it('o access token NUNCA vai para o armazenamento do navegador; só a dica de sessão', () => {
    const store = new SessionStore();
    store.setSession(makeSession('OWNER'));
    expect(JSON.stringify({ ...localStorage })).not.toContain('token-OWNER');
    expect(localStorage.getItem('voltex:session')).toBe('1');
    store.clear();
    expect(localStorage.getItem('voltex:session')).toBeNull();
  });

  it('sem dica não vale tentar restaurar; sem armazenamento, tenta (fail-open para não deslogar à toa)', () => {
    const store = new SessionStore();
    expect(store.mayHaveSession()).toBe(false);
    store.setSession(makeSession('OWNER'));
    expect(store.mayHaveSession()).toBe(true);

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(store.mayHaveSession()).toBe(true);
    spy.mockRestore();
  });
});
