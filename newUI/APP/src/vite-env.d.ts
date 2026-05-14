/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_HOST: string;
  readonly VITE_RPC_PORT: string;
  readonly VITE_RPC_USER: string;
  readonly VITE_RPC_PASSWORD: string;
  readonly DEV: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
