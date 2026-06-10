/**
 * Module-loading adapter for the runtime host.
 *
 * Dynamically imports a user-supplied topology or behavior module and returns
 * the selected export as a fact (`ok`/`error`) instead of throwing — expected
 * failures (missing file, syntax error, missing export) are data the console
 * reports to the user.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type LoadResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface LoadModuleOptions {
  /** Named export to select. Defaults to the module's default export. */
  readonly exportName?: string;
  /** Base directory for relative paths. Defaults to process.cwd(). */
  readonly baseDir?: string;
}

/**
 * Import `filePath` and return the selected export.
 *
 * Falls back to the module's sole named export when there is no default
 * export and exactly one named export — covers `export const topology = ...`
 * modules without ceremony.
 */
export async function loadModuleExport(
  filePath: string,
  options: LoadModuleOptions = {}
): Promise<LoadResult<unknown>> {
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : resolve(options.baseDir ?? process.cwd(), filePath);

  if (!existsSync(absolutePath)) {
    return { ok: false, error: `Module not found: ${absolutePath}` };
  }

  let moduleNamespace: Record<string, unknown>;
  try {
    moduleNamespace = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tsHint =
      absolutePath.endsWith('.ts') && message.includes('Unknown file extension')
        ? ' (TypeScript modules need a TS loader — run the CLI via tsx, or point at compiled .js/.mjs)'
        : '';
    return { ok: false, error: `Failed to load ${absolutePath}: ${message}${tsHint}` };
  }

  if (options.exportName) {
    if (!(options.exportName in moduleNamespace)) {
      return {
        ok: false,
        error: `Export "${options.exportName}" not found in ${absolutePath}. Available: ${describeExports(moduleNamespace)}`,
      };
    }
    return { ok: true, value: moduleNamespace[options.exportName] };
  }

  if (moduleNamespace.default !== undefined) {
    return { ok: true, value: moduleNamespace.default };
  }

  const namedExports = Object.keys(moduleNamespace).filter((key) => key !== 'default');
  if (namedExports.length === 1) {
    return { ok: true, value: moduleNamespace[namedExports[0]] };
  }

  return {
    ok: false,
    error: `No default export in ${absolutePath} and ${
      namedExports.length === 0 ? 'no named exports' : 'multiple named exports'
    } to choose from. Available: ${describeExports(moduleNamespace)}`,
  };
}

function describeExports(moduleNamespace: Record<string, unknown>): string {
  const keys = Object.keys(moduleNamespace);
  return keys.length > 0 ? keys.join(', ') : '(none)';
}
