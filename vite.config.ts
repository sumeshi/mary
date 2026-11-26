import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const base = process.env.BASE_URL ?? '/';
const normalizedBase = base.endsWith('/') ? base : `${base}/`;

export default defineConfig({
  base: normalizedBase,
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  plugins: [
    {
      name: 'drop-unused-ort-asyncify',
      generateBundle(_options, bundle) {
        for (const fileName of Object.keys(bundle)) {
          if (
            fileName.startsWith('assets/ort-wasm-simd-threaded.asyncify-') &&
            fileName.endsWith('.wasm')
          ) {
            delete bundle[fileName];
          }
        }
      },
    },
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Mary — Live English Captions',
        short_name: 'Mary',
        description:
          'Real-time English captions with optional Japanese translation. All processing stays on your device.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: [
          '**/*.{js,mjs,css,html,svg,png,ico,webmanifest,txt}',
          'moonshine/*.{js,mjs,wasm}',
        ],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
