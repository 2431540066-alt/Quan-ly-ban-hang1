import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': process.env.API_TARGET || 'http://localhost:4000' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/victory-vendor/')) return 'chart-vendor';
          if (id.includes('node_modules/recharts/')) return 'charts';
        },
      },
    },
  },
});
