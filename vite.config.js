import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
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
