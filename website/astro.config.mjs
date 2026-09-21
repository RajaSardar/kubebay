import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://rajasardar.github.io',
  base: '/kubebay',
  output: 'static',
  integrations: [],
  build: {
    // Inline small assets to reduce requests
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      // Improve chunking for production builds
      cssCodeSplit: true,
    },
  },
});
