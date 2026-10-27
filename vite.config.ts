/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

// The official Poki SDK script tag, injected only into the Poki build (mode "poki").
// See https://developers.poki.com/guide/sdk-html5 — it is the one approved external script.
const POKI_SDK = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

function pokiSdk(enabled: boolean): Plugin {
  return {
    name: 'lampkeeper-poki-sdk',
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace('</title>', `</title>\n    <script src="${POKI_SDK}"></script>`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative asset paths so the build works under any static-hosting sub-path.
  base: './',
  define: {
    'import.meta.env.VITE_PLATFORM': JSON.stringify(mode === 'poki' ? 'poki' : 'local'),
  },
  plugins: [pokiSdk(mode === 'poki')],
  build: {
    outDir: mode === 'poki' ? 'dist-poki' : 'dist',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
}));
