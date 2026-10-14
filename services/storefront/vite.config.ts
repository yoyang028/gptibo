import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const mock = process.env.LOCAL_QUEFA_MOCK === 'true'
const frontendPort = mock ? 5176 : 5175
const backendOrigin = mock ? 'http://127.0.0.1:8094' : 'http://127.0.0.1:8093'

// Independent frontend preview; production Worker configuration is unchanged.
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react(), tailwindcss(), {
    name: 'storefront-test-environment',
    transformIndexHtml(html) {
      return html.replace('<title>', '<title>[测试站] ')
    },
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  // Local tools, mailboxes and test artifacts may contain unrelated HTML files.
  optimizeDeps: { entries: [fileURLToPath(new URL('../../index.html', import.meta.url))] },
  build: { outDir: mock ? 'services/storefront/.preview-quefa' : 'services/storefront/.preview', emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: frontendPort, strictPort: true,
    // PostgreSQL and Go caches change frequently and are not frontend inputs.
    watch: { ignored: ['**/artifacts/**', '**/services/storefront/.preview/**', '**/services/storefront/.preview-quefa/**'] },
    proxy: {
      '/api': {
        target: backendOrigin, changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            if (incoming.headers.origin === `http://127.0.0.1:${frontendPort}`) outgoing.setHeader('Origin', backendOrigin)
          })
        },
      },
    },
  },
})
