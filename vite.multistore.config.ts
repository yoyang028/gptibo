import { defineConfig, mergeConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import base from './vite.config.ts'

export default defineConfig(({ mode }) => {
  if (mode !== 'general' && mode !== 'wholesale') throw new Error('Select --mode general or --mode wholesale')
  const port = mode === 'general' ? 5181 : 5182
  const backend = mode === 'general' ? 'http://localhost:8801' : 'http://127.0.0.1:8802'
  return mergeConfig(base, {
    define: { 'import.meta.env.VITE_SITE_KIND': JSON.stringify(mode) },
    build: { outDir: fileURLToPath(new URL(`./artifacts/sites/${mode}/dist`, import.meta.url)) },
    server: {
      port, strictPort: true,
      proxy: { '/api': { target: backend, changeOrigin: true, configure(proxy: { on: (event: string, callback: (proxyRequest: { setHeader: (name: string, value: string) => void }, request: { headers: { origin?: string } }) => void) => void }) {
        proxy.on('proxyReq', (proxyRequest, request) => { if (request.headers.origin === `http://127.0.0.1:${port}`) proxyRequest.setHeader('Origin', backend) })
      } } },
    },
  })
})
