import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { htmlPartialsPlugin } from './vite-html-partials'

// https://vite.dev/config/
export default defineConfig({
  plugins: [htmlPartialsPlugin(), react()],
  server: {
    // Bind IPv4 explicitly so Chrome/MCP and Node agree on the same host.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        timeout: 30_000
      },
      '/events': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        // SSE streams must not be buffered/timeout-killed by the proxy.
        timeout: 0,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('connection', 'keep-alive');
          });
        }
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true
      }
    }
  },
})
