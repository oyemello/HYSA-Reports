import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: '../public',
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});
