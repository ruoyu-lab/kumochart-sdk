import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  platform: 'browser',
  target: 'es2022',
  dts: true,
  format: 'esm',
  // The component uses hooks, so React Server Components must render it on the client.
  banner: "'use client';"
});
