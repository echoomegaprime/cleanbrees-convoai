import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `cloudflare:workers` only exists inside workerd; map it to a small stub for Node test runs.
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url)),
    },
  },
});
