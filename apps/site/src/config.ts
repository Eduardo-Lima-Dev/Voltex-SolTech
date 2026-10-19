/**
 * Endereços que ligam o site à aplicação. Tudo vem do ambiente, porque o site e a aplicação ficam em endereços
 * separados (ex.: `www.suaempresa.com.br` e `app.suaempresa.com.br`).
 */
export interface SiteEnv {
  VITE_APP_URL?: string;
  VITE_LEAD_KEY?: string;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export function siteConfig(env: SiteEnv) {
  // Em desenvolvimento a aplicação roda na porta 5173.
  const app = trimSlash(env.VITE_APP_URL?.trim() || 'http://localhost:5173');
  const key = env.VITE_LEAD_KEY?.trim() || null;
  return {
    appUrl: app,
    loginUrl: `${app}/login`,
    /** Endereço (na mesma origem do site) que recebe o formulário de contato; `null` se não houver chave. */
    leadEndpoint: key ? `/api/v1/public/leads/${encodeURIComponent(key)}` : null,
  };
}

/** Campos de campanha (utm_*) da URL de entrada, guardados junto do contato para saber de onde ele veio. */
export function utmFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const pick = (name: string) => params.get(`utm_${name}`)?.trim().slice(0, 120) || undefined;
  const utm = {
    source: pick('source'),
    medium: pick('medium'),
    campaign: pick('campaign'),
    term: pick('term'),
    content: pick('content'),
  };
  return Object.values(utm).some(Boolean) ? utm : undefined;
}

export const config = siteConfig(import.meta.env);
