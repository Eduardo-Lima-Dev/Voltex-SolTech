/**
 * Endereços que ligam o site à aplicação. Tudo vem do ambiente, porque o site e a aplicação ficam em endereços
 * separados (ex.: `www.suaempresa.com.br` e `app.suaempresa.com.br`).
 */
export interface SiteEnv {
  VITE_APP_URL?: string;
  VITE_LEAD_KEY?: string;
  /** Identificação da empresa nas páginas de privacidade e termos (não inventamos: vem do ambiente). */
  VITE_LEGAL_COMPANY?: string;
  VITE_LEGAL_CNPJ?: string;
  VITE_LEGAL_ADDRESS?: string;
  VITE_LEGAL_PRIVACY_EMAIL?: string;
  VITE_LEGAL_DPO?: string;
  VITE_LEGAL_FORUM?: string;
  /** Contatos da página de links (`/links`). Sem valor, o item correspondente não aparece. */
  VITE_CONTACT_WHATSAPP?: string;
  VITE_CONTACT_EMAIL?: string;
  VITE_LINKEDIN_URL?: string;
}

/** Perfil oficial no Instagram (o mesmo do briefing de marketing). */
export const INSTAGRAM = {
  handle: 'voltexsoltech',
  url: 'https://www.instagram.com/voltexsoltech/',
};

const WHATSAPP_MESSAGE = 'Olá! Vim pela Voltex SolTech e quero saber mais sobre a plataforma.';

/**
 * Contatos da página de links. O WhatsApp aceita o número em qualquer formato (com ou sem +55, espaços e traços)
 * e vira um link `wa.me` com uma mensagem pronta. Número com menos de 10 dígitos é descartado.
 */
export function contactLinks(env: SiteEnv) {
  const digits = env.VITE_CONTACT_WHATSAPP?.replace(/\D/g, '') ?? '';
  const phone = digits.length >= 12 ? digits : digits.length >= 10 ? `55${digits}` : null;
  const email = env.VITE_CONTACT_EMAIL?.trim() || null;
  const linkedin = env.VITE_LINKEDIN_URL?.trim() || null;
  return {
    whatsapp: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}` : null,
    email: email ? `mailto:${email}` : null,
    linkedin: linkedin && /^https:\/\//.test(linkedin) ? linkedin : null,
  };
}

/**
 * Link do pedido de demonstração a partir da página de links: leva os `utm_*` de quem chegou (ex.: o QR code das
 * apresentações) até o formulário, para o lead registrar a origem. Sem campanha na entrada, marca `link-bio`.
 */
export function demoHref(search: string): string {
  const incoming = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const [key, value] of incoming) if (key.startsWith('utm_')) params.set(key, value);
  if (!params.has('utm_source')) params.set('utm_source', 'link-bio');
  return `/?${params.toString()}#contato`;
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

/** Campos que as páginas legais preenchem a partir do ambiente. Sem valor, a página mostra o aviso "a informar". */
export const LEGAL_FIELDS = ['company', 'cnpj', 'address', 'privacyEmail', 'dpo', 'forum'] as const;
export type LegalField = (typeof LEGAL_FIELDS)[number];

export function legalInfo(env: SiteEnv): Record<LegalField, string | null> {
  const pick = (value?: string) => value?.trim() || null;
  return {
    company: pick(env.VITE_LEGAL_COMPANY),
    cnpj: pick(env.VITE_LEGAL_CNPJ),
    address: pick(env.VITE_LEGAL_ADDRESS),
    privacyEmail: pick(env.VITE_LEGAL_PRIVACY_EMAIL),
    dpo: pick(env.VITE_LEGAL_DPO),
    forum: pick(env.VITE_LEGAL_FORUM),
  };
}
