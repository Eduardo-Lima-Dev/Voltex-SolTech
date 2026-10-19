/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço público da aplicação (ex.: https://app.suaempresa.com.br). Padrão em dev: http://localhost:5173. */
  readonly VITE_APP_URL?: string;
  /** Chave de captação de leads da empresa dona da plataforma (CRM Solar → Leads → captação). */
  readonly VITE_LEAD_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
