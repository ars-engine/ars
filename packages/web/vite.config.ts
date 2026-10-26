import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  server: { port: 5317, proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } } },
});
