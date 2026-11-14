import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // The whole site is one small script and one stylesheet; keep them as files
    // (no inlining) so the page works under a strict Content-Security-Policy.
    assetsInlineLimit: 0,
  },
});
