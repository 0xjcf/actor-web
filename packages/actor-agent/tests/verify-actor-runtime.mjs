import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire, isBuiltin, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { smoke } from './actor-runtime-smoke.mjs';

assert.deepEqual(await smoke(), { text: 'verified' });

const require = createRequire(import.meta.url);
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  assert(!/^zod(?:\/|$)/.test(id), 'The CJS executor must not load its optional Zod peer.');
  return originalRequire.call(this, id);
};
try {
  const { createActorRuntime } = require('@actor-web/agent/actor-runtime');
  const { createAgent } = require('@actor-web/agent/portable');
  assert.deepEqual(await smoke(createActorRuntime, createAgent), { text: 'verified' });
} finally {
  Module.prototype.require = originalRequire;
}

const browser = await build({
  configFile: false,
  logLevel: 'warn',
  // Vite library mode leaves the replacement that application builds do automatically.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    {
      name: 'require-browser-safe-executor',
      enforce: 'pre',
      resolveId(id) {
        if (isBuiltin(id) || /^zod(?:\/|$)/.test(id)) {
          throw new Error(`The browser executor must not import ${id}.`);
        }
      },
    },
  ],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./actor-runtime-smoke.mjs', import.meta.url)),
      formats: ['iife'],
      name: 'ActorRuntimeSmoke',
    },
    target: 'es2022',
    write: false,
    minify: false,
  },
});
const [bundle] = Array.isArray(browser) ? browser : [browser];
const chunks = bundle.output.filter((asset) => asset.type === 'chunk');
assert.equal(chunks.length, 1);
assert.deepEqual(chunks[0].imports, []);
assert.deepEqual(chunks[0].dynamicImports, []);
const context = {
  AbortController,
  AbortSignal,
  clearInterval,
  clearTimeout,
  console,
  crypto: webcrypto,
  performance,
  queueMicrotask,
  setInterval,
  setTimeout,
  TextDecoder,
  TextEncoder,
};
const browserResult = await runInNewContext(
  `${chunks[0].code}\nActorRuntimeSmoke.smoke();`,
  context
);
assert.equal(browserResult.text, 'verified');
