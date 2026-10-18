/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API. Padrão: `/api/v1` (mesma origem, via proxy do Vite ou do nginx). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
