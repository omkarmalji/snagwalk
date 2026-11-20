import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Unit tests never touch AlloyDB, Cloud Storage or Gemini.
    env: { DB_FALLBACK: 'off', ALLOYDB_INSTANCE_URI: '', DB_HOST: '' },
  },
});
