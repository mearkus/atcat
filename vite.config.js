import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works at any sub-path (e.g. user.github.io/repo/).
  base: './',
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1000 },
});
