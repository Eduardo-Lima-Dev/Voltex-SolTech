/*
 * Service worker do Voltex SolTech (Fase 11C, ADR-0021).
 *
 * Objetivo: o app abrir sem internet, para o técnico de campo continuar trabalhando. Ele guarda a casca do aplicativo
 * (a página inicial e os arquivos com hash em /assets/) e NUNCA guarda respostas da API: os dados do técnico ficam no
 * IndexedDB, sob o controle do próprio app. Atualização: este arquivo é revalidado a cada visita (sem cache) e, ao
 * mudar a versão abaixo, os caches antigos são apagados.
 */
const VERSION = 'v1';
const SHELL = `voltex-shell-${VERSION}`;
const ASSETS = `voltex-assets-${VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS))
      // Instalar sem a casca completa não impede o app de funcionar online.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('voltex-') && key !== SHELL && key !== ASSETS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // A API nunca passa pelo cache: o app trata a falta de conexão com o que guarda no IndexedDB.
  if (url.pathname.startsWith('/api/')) return;

  // Navegação: tenta a rede (versão nova) e, sem internet, cai na página inicial guardada (o app é uma SPA).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  // Arquivos com hash no nome nunca mudam: o guardado vale; o que falta vem da rede e fica guardado.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            }),
        ),
      ),
    );
    return;
  }

  // Ícones e manifesto: rede primeiro, guardado como reserva.
  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error())),
    );
  }
});
