/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API. Padrão: `/api/v1` (mesma origem, via proxy do Vite ou do nginx). */
  readonly VITE_API_URL?: string;
  /** Endereço público do site de apresentação; quando definido, a tela de entrada mostra o link "Voltar ao site". */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
