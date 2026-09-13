import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createActorSource as canonicalCreateActorSource } from '../integration/actor-source.js';
import { createActorSource } from '../source.js';

describe('neutral public source entrypoint', () => {
  it('reexports the canonical source factory without a second implementation', () => {
    expect(createActorSource).toBe(canonicalCreateActorSource);
  });

  it('loads the built public entry in a fresh process with no DOM', () => {
    const cwd = fileURLToPath(new URL('../..', import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      assert.equal(typeof document, 'undefined');
      assert.equal(typeof HTMLElement, 'undefined');
      const entry = await import('@actor-web/runtime/source');
      assert.equal(typeof entry.createActorSource, 'function');
      assert.equal(typeof entry.createActorCommandSource, 'function');
      assert.equal(typeof entry.createActorReadModelSource, 'function');
      assert.equal(typeof document, 'undefined');
      assert.equal(typeof HTMLElement, 'undefined');
      console.log('neutral source entry passed');
    `,
      ],
      { cwd, encoding: 'utf8' }
    );
    expect(output).toContain('neutral source entry passed');
  });
});
