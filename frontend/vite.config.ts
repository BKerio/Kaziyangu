import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Split the heaviest library into its own cacheable chunk so it isn't in
    // the initial bundle (charts load with the report pages).
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-charts': ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
