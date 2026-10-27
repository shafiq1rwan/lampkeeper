/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'poki' for the Poki build, 'local' otherwise (set in vite.config.ts). */
  readonly VITE_PLATFORM: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
