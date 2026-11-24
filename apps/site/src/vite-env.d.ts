/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço público da aplicação (ex.: https://app.suaempresa.com.br). Padrão em dev: http://localhost:5173. */
  readonly VITE_APP_URL?: string;
  /** Chave de captação de leads da empresa dona da plataforma (CRM Solar → Leads → captação). */
  readonly VITE_LEAD_KEY?: string;
  /** WhatsApp comercial da página de links (ex.: 85 99999-0000). */
  readonly VITE_CONTACT_WHATSAPP?: string;
  /** E-mail comercial da página de links. */
  readonly VITE_CONTACT_EMAIL?: string;
  /** Página da empresa no LinkedIn (https://…). */
  readonly VITE_LINKEDIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
