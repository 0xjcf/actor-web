/**
 * Tests for the v0 in-process runtime host.
 *
 * Host behavior is exercised through the programmatic API with topology values
 * built inline (same pattern as the runtime's own topology tests). Module
 * loading is exercised against dependency-free fixtures in os.tmpdir(), and
 * spawn-from-file against a fixture under the package's node_modules so the
 * bare `@actor-web/runtime` specifier resolves from the fixture's location.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type ActorMessage,
  actor,
  defineActorWebTopology,
  defineBehavior,
  node,
} from '@actor-web/runtime';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadModuleExport } from './load-module';
import {
  createRuntimeHost,
  executeCommand,
  type RuntimeHost,
  splitExecScript,
} from './runtime-host';

type CounterMsg = { type: 'INCREMENT' } | { type: 'GET_COUNT' };

function buildCounterTopology() {
  const counter = defineBehavior<CounterMsg>()
    .withContext({ count: 0 })
    .onMessage(({ message, context }) => {
      if (message.type === 'INCREMENT') {
        const count = context.count + 1;
        return { context: { count }, emit: [{ type: 'COUNT_CHANGED', count }] };
      }
      if (message.type === 'GET_COUNT') {
        return { reply: { count: context.count } };
      }
      return {};
    })
    .build();

  return defineActorWebTopology({
    nodes: { local: node('local') },
    actors: { counter: actor({ id: 'counter', node: 'local', behavior: counter }) },
  });
}

type AgentPackage = {
  readonly ACTOR_WEB_LLM_TOOL_NAME: 'llm';
  createAgentLoopBehavior(options?: { readonly system?: string }): unknown;
};

async function loadAgentPackage(): Promise<AgentPackage | null> {
  try {
    return (await import('@actor-web/agent')) as AgentPackage;
  } catch {
    return null;
  }
}

function buildAgentLoopTopology(input: {
  readonly agentPackage: AgentPackage;
  readonly grantLlm: boolean;
}) {
  return defineActorWebTopology({
    nodes: { local: node('local') },
    actors: {
      agent: actor({
        id: 'agent',
        node: 'local',
        behavior: input.agentPackage.createAgentLoopBehavior({
          system: 'You are a runtime-hosted agent.',
        }),
        tools: input.grantLlm ? [input.agentPackage.ACTOR_WEB_LLM_TOOL_NAME] : [],
      }),
    },
  });
}

// ============================================================================
// MODULE LOADING ADAPTER
// ============================================================================

describe('loadModuleExport', () => {
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'actor-web-cli-load-'));
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('loads a default export', async () => {
    const file = join(fixtureDir, 'default-export.mjs');
    await writeFile(file, 'export default { hello: 1 };\n');

    const result = await loadModuleExport(file);
    expect(result).toEqual({ ok: true, value: { hello: 1 } });
  });

  it('falls back to a sole named export', async () => {
    const file = join(fixtureDir, 'sole-named.mjs');
    await writeFile(file, 'export const topology = { sole: true };\n');

    const result = await loadModuleExport(file);
    expect(result).toEqual({ ok: true, value: { sole: true } });
  });

  it('selects a named export when requested', async () => {
    const file = join(fixtureDir, 'named.mjs');
    await writeFile(file, 'export const a = 1;\nexport const b = 2;\n');

    const result = await loadModuleExport(file, { exportName: 'b' });
    expect(result).toEqual({ ok: true, value: 2 });
  });

  it('reports a missing file as a fact', async () => {
    const result = await loadModuleExport(join(fixtureDir, 'does-not-exist.mjs'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Module not found');
    }
  });

  it('reports a missing named export with the available exports', async () => {
    const file = join(fixtureDir, 'missing-named.mjs');
    await writeFile(file, 'export const a = 1;\n');

    const result = await loadModuleExport(file, { exportName: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"nope" not found');
      expect(result.error).toContain('a');
    }
  });

  it('reports a broken module as a fact instead of throwing', async () => {
    const file = join(fixtureDir, 'broken.mjs');
    await writeFile(file, 'export default {;\n');

    const result = await loadModuleExport(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to load');
    }
  });

  it('reports ambiguous exports (no default, several named) as a fact', async () => {
    const file = join(fixtureDir, 'ambiguous.mjs');
    await writeFile(file, 'export const a = 1;\nexport const b = 2;\n');

    const result = await loadModuleExport(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('multiple named exports');
    }
  });
});

// ============================================================================
// RUNTIME HOST
// ============================================================================

describe('createRuntimeHost', () => {
  let host: RuntimeHost;

  beforeEach(async () => {
    const started = await createRuntimeHost(buildCounterTopology());
    expect(started.ok).toBe(true);
    if (started.ok) {
      host = started.value;
    }
  });

  afterEach(async () => {
    await host.stop();
  });

  it('lists topology actors with origin and address', async () => {
    const actors = await host.listActors();
    expect(actors).toHaveLength(1);
    expect(actors[0].key).toBe('counter');
    expect(actors[0].origin).toBe('topology');
    expect(actors[0].path).toContain('counter');
  });

  it('sends a message and observes the effect via ask', async () => {
    const sent = await host.send('counter', '{"type":"INCREMENT"}');
    expect(sent.ok).toBe(true);

    const reply = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);
    expect(reply).toEqual({ ok: true, value: { count: 1 } });
  });

  it('resolves targets by key and by actor:// path', async () => {
    const byKey = host.resolve('counter');
    expect(byKey).toBeDefined();
    const byPath = host.resolve(byKey?.address ?? '');
    expect(byPath).toBe(byKey);
  });

  it('streams emitted events through watch until unsubscribed', async () => {
    const events: ActorMessage[] = [];
    const watching = host.watch('counter', (event) => events.push(event));
    expect(watching.ok).toBe(true);

    await host.send('counter', '{"type":"INCREMENT"}');
    expect(events.some((event) => event.type === 'COUNT_CHANGED')).toBe(true);

    if (watching.ok) {
      watching.value();
    }
    const seen = events.length;
    await host.send('counter', '{"type":"INCREMENT"}');
    expect(events).toHaveLength(seen);
  });

  it('returns facts for unknown targets and malformed messages', async () => {
    const unknown = await host.send('nope', '{"type":"X"}');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error).toContain('Unknown actor "nope"');
    }

    const badJson = await host.send('counter', '{nope');
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) {
      expect(badJson.error).toContain('Invalid JSON');
    }

    const noType = await host.send('counter', '{"kind":"X"}');
    expect(noType.ok).toBe(false);
    if (!noType.ok) {
      expect(noType.error).toContain('string "type"');
    }
  });

  it('rejects an unknown --node selection as a fact', async () => {
    const started = await createRuntimeHost(buildCounterTopology(), { node: 'remote' });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error).toContain('Node "remote" not found');
      expect(started.error).toContain('local');
    }
  });

  it('hosts @actor-web/agent loops with an explicitly registered llm provider', async () => {
    const agentPackage = await loadAgentPackage();
    expect(agentPackage).not.toBeNull();
    if (!agentPackage) {
      return;
    }
    const provider = (request: { readonly messages: readonly { readonly content: string }[] }) => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: `hosted:${request.messages.at(-1)?.content}`,
        },
      },
    });
    const started = await createRuntimeHost(
      buildAgentLoopTopology({ agentPackage, grantLlm: true }),
      {
        agent: { llm: provider },
      }
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    try {
      const reply = await started.value.ask(
        'agent',
        '{"type":"START_AGENT","prompt":"ship v1"}',
        2000
      );

      expect(reply).toMatchObject({
        ok: true,
        value: {
          ok: true,
          status: 'responded',
          message: {
            role: 'assistant',
            content: 'hosted:ship v1',
          },
        },
      });
    } finally {
      await started.value.stop();
    }
  });

  it('keeps the hosted llm provider behind topology toolAccess', async () => {
    const agentPackage = await loadAgentPackage();
    expect(agentPackage).not.toBeNull();
    if (!agentPackage) {
      return;
    }
    let called = false;
    const provider = () => {
      called = true;
      return {
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: 'should not run',
          },
        },
      };
    };
    const started = await createRuntimeHost(
      buildAgentLoopTopology({ agentPackage, grantLlm: false }),
      {
        agent: { llm: provider },
      }
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    try {
      const reply = await started.value.ask(
        'agent',
        '{"type":"START_AGENT","prompt":"blocked"}',
        2000
      );

      expect(called).toBe(false);
      expect(reply).toMatchObject({
        ok: true,
        value: {
          ok: false,
          error: {
            code: 'LLM_TOOL_UNAVAILABLE',
          },
        },
      });
    } finally {
      await started.value.stop();
    }
  });
});

// ============================================================================
// DYNAMIC SPAWN FROM FILE
// ============================================================================

describe('spawnFromFile', () => {
  // Fixture lives under the package's node_modules so its bare
  // `@actor-web/runtime` import resolves through pnpm's workspace links.
  const fixtureDir = resolve(__dirname, '../../node_modules/.actor-web-cli-test-fixtures');
  const behaviorFile = join(fixtureDir, 'echo-behavior.mjs');
  let host: RuntimeHost;

  beforeAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      behaviorFile,
      [
        "import { defineBehavior } from '@actor-web/runtime';",
        'export default defineBehavior()',
        '  .withContext({ seen: 0 })',
        '  .onMessage(({ message, context }) => {',
        "    if (message.type === 'PING') {",
        '      return { context: { seen: context.seen + 1 }, reply: { pong: context.seen + 1 } };',
        '    }',
        '    return {};',
        '  })',
        '  .build();',
        '',
      ].join('\n')
    );
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const started = await createRuntimeHost(buildCounterTopology());
    expect(started.ok).toBe(true);
    if (started.ok) {
      host = started.value;
    }
  });

  afterEach(async () => {
    await host.stop();
  });

  it('spawns a behavior module and serves ask on it', async () => {
    const spawned = await host.spawnFromFile(behaviorFile, 'echo1');
    expect(spawned.ok).toBe(true);
    if (spawned.ok) {
      expect(spawned.value.origin).toBe('spawned');
    }

    const reply = await host.ask('echo1', '{"type":"PING"}', 2000);
    expect(reply).toEqual({ ok: true, value: { pong: 1 } });

    const actors = await host.listActors();
    expect(actors.map((entry) => entry.key).sort()).toEqual(['counter', 'echo1']);
  });

  it('rejects a duplicate actor id as a fact', async () => {
    const first = await host.spawnFromFile(behaviorFile, 'echo1');
    expect(first.ok).toBe(true);

    const second = await host.spawnFromFile(behaviorFile, 'echo1');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain('already registered');
    }
  });

  it('reports a missing behavior module as a fact', async () => {
    const spawned = await host.spawnFromFile(join(fixtureDir, 'missing.mjs'), 'ghost');
    expect(spawned.ok).toBe(false);
    if (!spawned.ok) {
      expect(spawned.error).toContain('Module not found');
    }
  });
});

// ============================================================================
// EXEC SCRIPT SPLITTING
// ============================================================================

describe('splitExecScript', () => {
  it('splits commands on semicolons and trims whitespace', () => {
    expect(splitExecScript('ls;  help ; exit')).toEqual(['ls', 'help', 'exit']);
  });

  it('drops empty segments', () => {
    expect(splitExecScript('; ls;; help ;')).toEqual(['ls', 'help']);
  });

  it('keeps semicolons inside double-quoted JSON strings', () => {
    expect(splitExecScript('send a {"text":"a;b"}; ls')).toEqual(['send a {"text":"a;b"}', 'ls']);
  });

  it('keeps semicolons inside single-quoted regions', () => {
    expect(splitExecScript("send a 'x;y'; ls")).toEqual(["send a 'x;y'", 'ls']);
  });

  it('honors backslash escapes inside strings', () => {
    expect(splitExecScript('send a {"text":"say \\";\\" ok"}; ls')).toEqual([
      'send a {"text":"say \\";\\" ok"}',
      'ls',
    ]);
  });
});

// ============================================================================
// CONSOLE GRAMMAR
// ============================================================================

describe('executeCommand', () => {
  let host: RuntimeHost;
  let watches: Map<string, () => void>;

  beforeEach(async () => {
    const started = await createRuntimeHost(buildCounterTopology());
    expect(started.ok).toBe(true);
    if (started.ok) {
      host = started.value;
    }
    watches = new Map();
  });

  afterEach(async () => {
    for (const unsubscribe of watches.values()) {
      unsubscribe();
    }
    await host.stop();
  });

  it('lists actors via ls', async () => {
    const outcome = await executeCommand(host, 'ls', watches);
    expect(outcome.ok).toBe(true);
    expect(outcome.lines.some((line) => line.includes('counter'))).toBe(true);
  });

  it('parses send with JSON containing spaces', async () => {
    const outcome = await executeCommand(host, 'send counter {"type": "INCREMENT"}', watches);
    expect(outcome.ok).toBe(true);

    const reply = await executeCommand(host, 'ask counter {"type":"GET_COUNT"}', watches);
    expect(reply.ok).toBe(true);
    expect(reply.lines[0]).toBe('{"count":1}');
  });

  it('parses a trailing ask timeout without eating JSON', async () => {
    const outcome = await executeCommand(host, 'ask counter {"type":"GET_COUNT"} 2000', watches);
    expect(outcome.ok).toBe(true);
    expect(outcome.lines[0]).toBe('{"count":0}');
  });

  it('watch streams events through the context callback and unwatch stops them', async () => {
    const events: Array<{ target: string; event: ActorMessage }> = [];
    const watching = await executeCommand(host, 'watch counter', watches, {
      onEvent: (target, event) => events.push({ target, event }),
    });
    expect(watching.ok).toBe(true);
    expect(watches.has('counter')).toBe(true);

    await executeCommand(host, 'send counter {"type":"INCREMENT"}', watches);
    expect(events.some(({ event }) => event.type === 'COUNT_CHANGED')).toBe(true);

    const unwatched = await executeCommand(host, 'unwatch counter', watches);
    expect(unwatched.ok).toBe(true);
    expect(watches.size).toBe(0);
  });

  it('reports unknown commands and surfaces usage for partial ones', async () => {
    const unknown = await executeCommand(host, 'frobnicate', watches);
    expect(unknown.ok).toBe(false);
    expect(unknown.lines[0]).toContain('Unknown command');

    const usage = await executeCommand(host, 'send counter', watches);
    expect(usage.ok).toBe(false);
    expect(usage.lines[0]).toContain('Usage: send');
  });

  it('help lists every verb and exit signals shutdown', async () => {
    const help = await executeCommand(host, 'help', watches);
    for (const verb of ['ls', 'spawn', 'send', 'ask', 'watch', 'unwatch', 'exit']) {
      expect(help.lines.join('\n')).toContain(verb);
    }

    const exit = await executeCommand(host, 'exit', watches);
    expect(exit.exit).toBe(true);
  });
});
