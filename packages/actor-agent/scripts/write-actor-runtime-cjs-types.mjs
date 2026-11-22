import { readFile, writeFile } from 'node:fs/promises';

// The entry has identical exports in both formats. Its dependencies publish
// ESM declarations, so keep TypeScript's CJS type resolution in import mode.
const declaration = await readFile(new URL('../dist/actor-runtime.d.ts', import.meta.url), 'utf8');
await writeFile(
  new URL('../dist/actor-runtime.d.cts', import.meta.url),
  declaration
    .replace(
      /^import \{ ((?:type \w+(?:, )?)+) \} from /gm,
      (_match, names) => `import type { ${names.replaceAll('type ', '')} } from `
    )
    .replace(/^(import type .+);$/gm, "$1 with { 'resolution-mode': 'import' };")
    .replace(/\/\/# sourceMappingURL=.*$/m, '')
);
