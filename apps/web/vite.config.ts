import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.ZEROTRACE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080';

const apiProxy = {
  '/api': apiTarget,
  '/health': apiTarget,
  '/metrics': apiTarget,
  '/docs': apiTarget,
  '/documentation': apiTarget,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: { port: 4173, strictPort: true, proxy: apiProxy },
  build: { sourcemap: true, target: 'es2022' },
});
