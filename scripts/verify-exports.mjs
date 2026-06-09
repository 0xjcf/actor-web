#!/usr/bin/env node
/**
 * Verify that every file referenced by a package's `exports`/`main`/`module`/
 * `types` fields actually exists in the built `dist`, and that the main entry
 * loads under both ESM and CJS. Run after `build` so a half-built dist (e.g. an
 * ESM-only output missing the `.cjs` that `require` points at) can never ship.
 *
 * Usage: node scripts/verify-exports.mjs <packageDir>
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageDir = resolve(process.argv[2] ?? '.');
const pkgPath = join(packageDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const label = `[verify:exports] ${pkg.name}`;

/** Collect every relative dist path referenced by the manifest. */
function collectTargets() {
  const targets = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.startsWith('.')) targets.add(value);
  };
  add(pkg.main);
  add(pkg.module);
  add(pkg.types);
  const walk = (node) => {
    if (typeof node === 'string') add(node);
    else if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
  };
  walk(pkg.exports ?? {});
  return [...targets];
}

const missing = collectTargets().filter((rel) => !existsSync(join(packageDir, rel)));
assert.equal(
  missing.length,
  0,
  `${label} missing built file(s) referenced by package.json: ${missing.join(', ')}`
);

// Smoke-load the main entry both ways so a broken/empty bundle fails loudly.
const requireFn = createRequire(pkgPath);
const cjsTarget = pkg.exports?.['.']?.require ?? pkg.main;
if (cjsTarget) {
  const mod = requireFn(resolve(packageDir, cjsTarget));
  assert.ok(
    mod && Object.keys(mod).length > 0,
    `${label} CJS entry ${cjsTarget} loaded but exported nothing.`
  );
}

const esmTarget = pkg.exports?.['.']?.import ?? pkg.module;
if (esmTarget) {
  const mod = await import(pathToFileURL(resolve(packageDir, esmTarget)).href);
  assert.ok(
    mod && Object.keys(mod).length > 0,
    `${label} ESM entry ${esmTarget} loaded but exported nothing.`
  );
}

console.info(`${label} OK — ${collectTargets().length} export target(s) resolved; ESM+CJS load.`);
