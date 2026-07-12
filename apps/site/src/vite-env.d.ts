/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_TARGET?: 'marketing' | 'admin';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
