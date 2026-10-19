import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Backend-only test-fixture relay routes (no frontend route matches
      // these paths) — without this, Vite's dev server falls back to
      // serving the SPA shell for them instead of proxying to Flask, which
      // silently replaced the Bitbucket/GitLab test fixture page with our
      // own app's HTML whenever reached through the ngrok-tunneled frontend
      // instead of hitting the backend port directly (confirmed live
      // 2026-10-06: scanning this path through the tunnel found our own
      // app's violations, not the test fixture's).
      '^/_ada_.*_relay.*': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals:     true,
    environment: 'jsdom',
    setupFiles:  ['./src/test-setup.js'],
    include:     ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include:  ['src/utils/**', 'src/context/**', 'src/components/**', 'src/pages/**'],
      exclude:  ['src/**/*.test.*', 'src/test-setup.js'],
    },
  },
})
