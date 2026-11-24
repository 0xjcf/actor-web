import { defineConfig } from 'tsup';

export default defineConfig([
  { entry: ['src/index.ts'], format: ['cjs', 'esm'] },
  {
    entry: ['src/portable.ts', 'src/zod.ts'],
    format: ['cjs', 'esm'],
    external: ['zod'],
    dts: { compilerOptions: { composite: false } },
  },
  {
    entry: ['src/runner.ts'],
    format: ['cjs', 'esm'],
    platform: 'browser',
  },
]);
