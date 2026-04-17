import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5212,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:37212',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:37212',
        ws: true,
      },
    },
  },
});
