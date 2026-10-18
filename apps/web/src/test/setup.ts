import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import '@/lib/zod-locale';
import { server } from './server';

// As rotas carregam sob demanda (import dinâmico): a primeira renderização de cada tela pode levar mais de 1 s.
configure({ asyncUtilTimeout: 5000 });

// Qualquer chamada de rede sem handler FALHA o teste (não só a requisição): nada depende de uma API de verdade.
let unhandled: string[] = [];
beforeAll(() =>
  server.listen({
    onUnhandledFrame({ frame, defaults }) {
      const request = (frame as unknown as { request?: Request }).request;
      unhandled.push(request ? `${request.method} ${request.url}` : 'requisição desconhecida');
      defaults.error();
    },
  }),
);
beforeEach(() => {
  unhandled = [];
});
afterEach(() => {
  cleanup();
  const missing = unhandled;
  unhandled = [];
  expect(missing, 'requisições HTTP sem handler do MSW').toEqual([]);
  server.resetHandlers();
  try {
    localStorage.clear();
  } catch {
    // ambiente sem storage
  }
  document.documentElement.classList.remove('dark');
});
afterAll(() => server.close());

// jsdom não implementa estas APIs, mas componentes (Radix, tema) as usam.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;
