import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

const alias = {
  '@core': resolve(__dirname, 'src/core'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
}

// CrankHog's own Google app (src/main/integrations/google-app.ts), from CI
// secrets at build time. Without them, riders use their own Google app.
const googleApp =
  process.env.CRANKHOG_GOOGLE_CLIENT_ID && process.env.CRANKHOG_GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.CRANKHOG_GOOGLE_CLIENT_ID, clientSecret: process.env.CRANKHOG_GOOGLE_CLIENT_SECRET }
    : null

export default defineConfig({
  main: {
    resolve: { alias },
    define: { __CRANKHOG_GOOGLE_APP__: JSON.stringify(googleApp) },
    build: {
      // Bundle main-process dependencies so the packaged app needs no
      // node_modules at all (electron-builder.yml excludes them). Native or
      // optional modules must be listed in `external`.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['electron', 'bufferutil', 'utf-8-validate'],
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    define: { __CRANKHOG_WEB__: 'false', __CRANKHOG_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react(), tailwindcss()],
    server: { port: 5199, strictPort: true },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          minihud: resolve(__dirname, 'src/renderer/minihud.html'),
        },
      },
    },
  },
})
