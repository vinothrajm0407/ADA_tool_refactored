import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json',              dest: '.' },
        { src: 'icons',                      dest: '.' },
        { src: 'src/background/service-worker.js', dest: '.' },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
      },
      output: {
        entryFileNames:  'assets/[name].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name].[ext]',
      },
    },
  },
  // Inject VITE_PLATFORM_URL at build time so the service worker
  // (plain JS, no import.meta.env) doesn't need it.
  define: {
    __PLATFORM_URL__: JSON.stringify(
      process.env.VITE_PLATFORM_URL || 'http://localhost:5000'
    ),
  },
})
