import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../backend/lib'),
    },
  },
  // Load .env from project root so VITE_* vars in root .env are available to the frontend
  envDir: path.basename(process.cwd()) === 'frontend' ? path.resolve(process.cwd(), '..') : process.cwd(),
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})

