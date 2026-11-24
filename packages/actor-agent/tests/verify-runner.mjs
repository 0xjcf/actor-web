import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire, isBuiltin, Module } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { smoke } from './runner-smoke.mjs';

const events = [
  'LOCAL_MODEL_DISPATCHED',
  'LOCAL_MODEL_OUTCOME',
  'LOCAL_TOOL_DISPATCHED',
  'LOCAL_TOOL_OUTCOME',
  'LOCAL_MODEL_DISPATCHED',
  'LOCAL_MODEL_OUTCOME',
  'LOCAL_CLEANUP_STARTED',
  'LOCAL_CLEANUP_OUTCOME',
  'LOCAL_OUTPUT_VALIDATION',
];
assert.deepEqual(await smoke(), { text: 'verified' });
assert.deepEqual(await smoke(undefined, undefined, {}, true), {
  text: 'verified',
  status: 'settled',
  evidence: events,
});
await assert.rejects(smoke(undefined, undefined, { maxModelTurns: 1 }), {
  name: 'AgentRunnerError',
  code: 'MODEL_TURN_LIMIT',
});

const require = createRequire(import.meta.url);
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  assert(!/^zod(?:\/|$)/.test(id), 'The CJS runner must not load its optional Zod peer.');
  return originalRequire.call(this, id);
};
try {
  const agent = require('@actor-web/agent');
  assert.equal(agent.ACTOR_WEB_LLM_TOOL_NAME, 'llm');
  assert.equal(typeof agent.createLlmProvider, 'function');
  const { createAgentRunner } = require('@actor-web/agent/runner');
  const { createAgent } = require('@actor-web/agent/portable');
  assert.deepEqual(await smoke(createAgentRunner, createAgent), { text: 'verified' });
  assert.deepEqual(await smoke(createAgentRunner, createAgent, {}, true), {
    text: 'verified',
    status: 'settled',
    evidence: events,
  });
  await assert.rejects(smoke(createAgentRunner, createAgent, { maxToolAttempts: 0 }), {
    name: 'AgentRunnerError',
    code: 'TOOL_ATTEMPT_LIMIT',
  });
} finally {
  Module.prototype.require = originalRequire;
}

const browserOptions = {
  configFile: false,
  logLevel: 'warn',
  // Vite library mode leaves the replacement that application builds do automatically.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    {
      name: 'require-browser-safe-runner',
      enforce: 'pre',
      resolveId(id) {
        if (isBuiltin(id) || /^zod(?:\/|$)/.test(id)) {
          throw new Error(`The browser runner must not import ${id}.`);
        }
      },
    },
  ],
};
const browser = await build({
  ...browserOptions,
  build: {
    lib: {
      entry: fileURLToPath(new URL('./runner-smoke.mjs', import.meta.url)),
      formats: ['iife'],
      name: 'AgentRunnerSmoke',
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
  structuredClone,
  TextDecoder,
  TextEncoder,
};
const browserResult = await runInNewContext(
  `${chunks[0].code}\nAgentRunnerSmoke.smoke(undefined, undefined, {}, true);`,
  context
);
assert.equal(browserResult.text, 'verified');
assert.equal(browserResult.status, 'settled');
assert.deepEqual(Array.from(browserResult.evidence), events);
await assert.rejects(
  runInNewContext(
    `${chunks[0].code}\nAgentRunnerSmoke.smoke(undefined, undefined, { maxPayloadBytes: 1 });`,
    context
  ),
  { name: 'AgentRunnerError', code: 'PAYLOAD_BYTE_LIMIT' }
);

// The IIFE smoke runs after module initialization and cannot catch a split ES
// bundle's inlined dynamic imports reading bindings during top-level await.
const esmOutput = await mkdtemp(join(tmpdir(), 'runner-browser-entry-'));
try {
  await build({
    ...browserOptions,
    build: {
      target: 'es2022',
      outDir: esmOutput,
      emptyOutDir: false,
      modulePreload: false,
      rollupOptions: {
        input: fileURLToPath(new URL('./runner-browser-entry.mjs', import.meta.url)),
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: 'entry.mjs', chunkFileNames: '[name]-[hash].mjs' },
      },
    },
  });
  // Vite dispatches failed preload imports on window; allow the original error
  // to reach the assertion when evaluating a browser bundle in Node.
  globalThis.window = new EventTarget();
  const { toolName, execution } = await import(pathToFileURL(join(esmOutput, 'entry.mjs')).href);
  assert.equal(toolName, 'llm');
  assert.deepEqual(execution, { text: 'verified', status: 'settled', evidence: events });
} finally {
  delete globalThis.window;
  await rm(esmOutput, { recursive: true, force: true });
}
