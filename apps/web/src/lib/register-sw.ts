/**
 * Registra o service worker (só em produção): ele guarda a casca do aplicativo para o app de campo abrir sem
 * internet. Falha de registro (navegador antigo, modo privado) não afeta o uso online.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator))
    return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
