import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/ui'),
  base: '/',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/plugin/sidecars/sidebar/public'),
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
});
