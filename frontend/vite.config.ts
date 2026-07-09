import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { htmlPartialsPlugin } from './vite-html-partials'

// https://vite.dev/config/
export default defineConfig({
  plugins: [htmlPartialsPlugin(), react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
