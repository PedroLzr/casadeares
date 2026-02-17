import { defineConfig } from 'vite';

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/socket.io': {
        target: proxyTarget,
        ws: true
      },
      '/health': {
        target: proxyTarget
      }
    }
  }
});
