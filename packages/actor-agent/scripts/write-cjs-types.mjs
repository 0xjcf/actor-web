import { readFile, writeFile } from 'node:fs/promises';

// CJS and ESM expose the same contracts. Type-only references resolve against
// ESM declarations; the root's bundled provider re-export uses its CJS entry.
for (const name of ['index', 'llm-provider', 'runner', 'trace', 'zod']) {
  let declaration = await readFile(new URL(`../dist/${name}.d.ts`, import.meta.url), 'utf8');
  if (name === 'zod') {
    // The declaration bundler emits plain imports for symbols used only as types.
    declaration = declaration.replace(
      /^import \{ (.+) \} from /gm,
      (_match, names) => `import type { ${names.replaceAll('type ', '')} } from `
    );
  }
  const cjsDeclaration = declaration
    .replace(
      /^import \{ ((?:type \w+(?:, )?)+) \} from /gm,
      (_match, names) => `import type { ${names.replaceAll('type ', '')} } from `
    )
    .replace(/^(import type .+);$/gm, "$1 with { 'resolution-mode': 'import' };")
    .replaceAll("from './llm-provider.js';", "from './llm-provider.cjs';")
    .replaceAll("from './trace.js';", "from './trace.cjs';")
    .replace(/\/\/# sourceMappingURL=.*$/m, '');
  await writeFile(new URL(`../dist/${name}.d.cts`, import.meta.url), cjsDeclaration);
}
