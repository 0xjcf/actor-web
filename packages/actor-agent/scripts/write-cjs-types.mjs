import { readFile, writeFile } from 'node:fs/promises';

// CJS and ESM have identical exports. Type references still point at the ESM
// declarations, except for the root's re-export of the bundled provider.
for (const name of ['index', 'llm-provider', 'runner']) {
  const declaration = await readFile(new URL(`../dist/${name}.d.ts`, import.meta.url), 'utf8');
  const cjsDeclaration = declaration
    .replace(
      /^import \{ ((?:type \w+(?:, )?)+) \} from /gm,
      (_match, names) => `import type { ${names.replaceAll('type ', '')} } from `
    )
    .replace(/^(import type .+);$/gm, "$1 with { 'resolution-mode': 'import' };")
    .replaceAll("from './llm-provider.js';", "from './llm-provider.cjs';")
    .replace(/\/\/# sourceMappingURL=.*$/m, '');
  await writeFile(new URL(`../dist/${name}.d.cts`, import.meta.url), cjsDeclaration);
}
