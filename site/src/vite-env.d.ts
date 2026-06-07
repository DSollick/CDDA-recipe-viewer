/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
  readonly VITE_DEPLOY_SHA: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
