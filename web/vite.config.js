import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// host: true exposes the dev server on the LAN so the same build can be opened
// on a phone for the responsive/PWA demo.
export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
