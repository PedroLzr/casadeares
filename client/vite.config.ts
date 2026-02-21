import { defineConfig } from 'vite';

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001';
const defaultAllowedHosts = [
  'localhost',
  '127.0.0.1',
  'casadeares.online',
  'www.casadeares.online'
];
const allowedHosts = process.env.VITE_ALLOWED_HOSTS
  ? process.env.VITE_ALLOWED_HOSTS.split(',').map((host) => host.trim()).filter(Boolean)
  : defaultAllowedHosts;

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
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
