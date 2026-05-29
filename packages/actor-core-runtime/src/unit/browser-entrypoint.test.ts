import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function resolveLocalImport(fromFile: string, specifier: string): string {
  const sourcePath = specifier.endsWith('.js')
    ? `${specifier.slice(0, -3)}.ts`
    : specifier.endsWith('.mjs')
      ? `${specifier.slice(0, -4)}.ts`
      : path.extname(specifier).length === 0
        ? `${specifier}.ts`
        : specifier;

  return path.resolve(path.dirname(fromFile), sourcePath);
}

async function collectImportGraph(entrypoint: string): Promise<Map<string, string[]>> {
  const visited = new Map<string, string[]>();
  const pending = [entrypoint];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) {
      continue;
    }

    const source = await readFile(file, 'utf8');
    const imports = Array.from(source.matchAll(IMPORT_PATTERN), (match) => match[1]);
    visited.set(file, imports);

    for (const specifier of imports) {
      if (!specifier.startsWith('.')) {
        continue;
      }

      pending.push(resolveLocalImport(file, specifier));
    }
  }

  return visited;
}

describe('browser entrypoint import graph', () => {
  it('does not reach node crypto shims', async () => {
    const entrypoint = fileURLToPath(new URL('../browser.ts', import.meta.url));
    const graph = await collectImportGraph(entrypoint);

    const cryptoEdges = Array.from(graph.entries()).flatMap(([file, imports]) =>
      imports
        .filter((specifier) => specifier === 'node:crypto' || specifier === 'crypto')
        .map((specifier) => `${path.relative(process.cwd(), file)} -> ${specifier}`)
    );

    expect(cryptoEdges).toEqual([]);
  });
});
