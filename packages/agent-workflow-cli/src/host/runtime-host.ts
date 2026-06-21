/**
 * In-process runtime host for the actor-web CLI (design doc:
 * docs/actor-web-cli-runtime-host-design.md, phase v0).
 *
 * Boots a topology with `startRuntime` (in-memory transport — no network, no
 * LLM) and exposes the operator-console operations over it: list actors,
 * dynamic spawn, send/ask, and event watching. Operations return facts
 * (`ok`/`error`) instead of throwing so the console can report expected
 * failures verbatim.
 *
 * `executeCommand` implements the console grammar (`ls`, `spawn`, `send`,
 * `ask`, `watch`, ...) over a host instance so the REPL, `--exec` scripting,
 * and tests all share one code path.
 */

import type {
  ActorMessage,
  ActorRef,
  ActorWebTopology,
  ActorWebTopologyInput,
  Message,
} from '@actor-web/runtime';
import { Logger, parse, startRuntime } from '@actor-web/runtime';
import { loadModuleExport } from './load-module.js';

const log = Logger.namespace('ACTOR_WEB_CLI_HOST');

export type HostResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface HostActorEntry {
  readonly key: string;
  readonly path: string;
  readonly origin: 'topology' | 'spawned';
  readonly status: string;
}

export interface RuntimeHost {
  /** Topology node keys started by this host. */
  readonly nodeKeys: readonly string[];
  listActors(): Promise<HostActorEntry[]>;
  spawnFromFile(behaviorPath: string, id: string): Promise<HostResult<HostActorEntry>>;
  send(target: string, messageJson: string): Promise<HostResult<string>>;
  ask(target: string, messageJson: string, timeoutMs?: number): Promise<HostResult<unknown>>;
  watch(target: string, onEvent: (event: ActorMessage) => void): HostResult<() => void>;
  /** Resolve a registry key or actor:// path to an ActorRef. */
  resolve(target: string): ActorRef | undefined;
  /** Drain in-flight messages on every started node. */
  flush(): Promise<void>;
  stop(): Promise<void>;
}

interface RegisteredActor {
  readonly key: string;
  readonly ref: ActorRef;
  readonly origin: 'topology' | 'spawned';
}

type AnyTopology = ActorWebTopology<ActorWebTopologyInput>;

function isTopologyValue(value: unknown): value is AnyTopology {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { actors?: unknown }).actors === 'object' &&
    typeof (value as { nodes?: unknown }).nodes === 'object'
  );
}

function parseMessage(messageJson: string): HostResult<ActorMessage & Message> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(messageJson);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Message must be a JSON object with a string "type" field' };
  }
  if (typeof (parsed as { type?: unknown }).type !== 'string') {
    return { ok: false, error: 'Message must have a string "type" field' };
  }
  return { ok: true, value: parsed as ActorMessage & Message };
}

function describeStatus(ref: ActorRef): string {
  try {
    const status = (ref.getSnapshot() as { status?: unknown }).status;
    return typeof status === 'string' ? status : 'unknown';
  } catch {
    return 'unknown';
  }
}

function toEntry(actor: RegisteredActor): HostActorEntry {
  return {
    key: actor.key,
    path: actor.ref.address,
    origin: actor.origin,
    status: describeStatus(actor.ref),
  };
}

/**
 * Start an in-process host from a topology value (programmatic entry point).
 */
export async function createRuntimeHost(
  topology: AnyTopology,
  options: { node?: string } = {}
): Promise<HostResult<RuntimeHost>> {
  let runtime: Awaited<ReturnType<typeof startRuntime>>;
  try {
    runtime = await startRuntime(topology);
  } catch (error) {
    return {
      ok: false,
      error: `Failed to start runtime: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const nodeKeys = Object.keys(runtime.nodes);
  const spawnNodeKey = options.node ?? nodeKeys[0];
  if (options.node && !runtime.nodes[options.node]) {
    await runtime.stop();
    return {
      ok: false,
      error: `Node "${options.node}" not found in topology. Available nodes: ${nodeKeys.join(', ')}`,
    };
  }

  const registry = new Map<string, RegisteredActor>();
  for (const key of Object.keys(topology.actors)) {
    const ref = runtime.getActor(key);
    if (ref) {
      registry.set(key, { key, ref, origin: 'topology' });
    }
  }
  log.debug('Runtime host started', { nodeKeys, actors: Array.from(registry.keys()) });

  const resolve = (target: string): ActorRef | undefined => {
    const byKey = registry.get(target);
    if (byKey) {
      return byKey.ref;
    }
    for (const entry of registry.values()) {
      if (entry.ref.address === target || parse(entry.ref.address).id === target) {
        return entry.ref;
      }
    }
    return undefined;
  };

  const unknownTargetError = (target: string): string =>
    `Unknown actor "${target}". Known: ${Array.from(registry.keys()).join(', ') || '(none)'}`;

  const flush = async (): Promise<void> => {
    for (const key of nodeKeys) {
      await runtime.nodes[key]?.system.flush();
    }
  };

  const host: RuntimeHost = {
    nodeKeys,

    async listActors() {
      return Array.from(registry.values()).map(toEntry);
    },

    async spawnFromFile(behaviorPath, id) {
      if (registry.has(id)) {
        return { ok: false, error: `Actor id "${id}" is already registered` };
      }
      const loaded = await loadModuleExport(behaviorPath);
      if (!loaded.ok) {
        return loaded;
      }
      const system = runtime.nodes[spawnNodeKey]?.system;
      if (!system) {
        return { ok: false, error: `No started system for node "${spawnNodeKey}"` };
      }
      let ref: ActorRef;
      try {
        // The runtime materializes built behaviors and builders alike; shape
        // errors surface here as facts rather than crashing the console.
        ref = await system.spawn(loaded.value as Parameters<typeof system.spawn>[0], { id });
      } catch (error) {
        return {
          ok: false,
          error: `Spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const entry: RegisteredActor = { key: id, ref, origin: 'spawned' };
      registry.set(id, entry);
      return { ok: true, value: toEntry(entry) };
    },

    async send(target, messageJson) {
      const ref = resolve(target);
      if (!ref) {
        return { ok: false, error: unknownTargetError(target) };
      }
      const message = parseMessage(messageJson);
      if (!message.ok) {
        return message;
      }
      try {
        await ref.send(message.value);
        await flush();
      } catch (error) {
        return {
          ok: false,
          error: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      return { ok: true, value: `Sent ${message.value.type} to ${ref.address}` };
    },

    async ask(target, messageJson, timeoutMs) {
      const ref = resolve(target);
      if (!ref) {
        return { ok: false, error: unknownTargetError(target) };
      }
      const message = parseMessage(messageJson);
      if (!message.ok) {
        return message;
      }
      try {
        const reply = await ref.ask(message.value, timeoutMs);
        return { ok: true, value: reply };
      } catch (error) {
        return {
          ok: false,
          error: `Ask failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    watch(target, onEvent) {
      const ref = resolve(target);
      if (!ref) {
        return { ok: false, error: unknownTargetError(target) };
      }
      if (typeof ref.subscribeEvent !== 'function') {
        return { ok: false, error: `Actor "${target}" does not expose an event stream` };
      }
      const unsubscribe = ref.subscribeEvent(onEvent);
      return { ok: true, value: unsubscribe };
    },

    resolve,
    flush,

    async stop() {
      await runtime.stop();
    },
  };

  return { ok: true, value: host };
}

/**
 * Start an in-process host from a topology module file (CLI entry point).
 */
export async function createRuntimeHostFromFile(
  topologyPath: string,
  options: { node?: string } = {}
): Promise<HostResult<RuntimeHost>> {
  const loaded = await loadModuleExport(topologyPath);
  if (!loaded.ok) {
    return loaded;
  }
  if (!isTopologyValue(loaded.value)) {
    return {
      ok: false,
      error: `${topologyPath} does not export a topology (expected a defineActorWebTopology(...) value with "actors" and "nodes")`,
    };
  }
  return createRuntimeHost(loaded.value, options);
}

// ============================================================================
// CONSOLE GRAMMAR
// ============================================================================

export interface CommandOutcome {
  readonly ok: boolean;
  readonly lines: readonly string[];
  /** True when the console should stop (exit/quit). */
  readonly exit?: boolean;
}

export interface CommandContext {
  /** Receives watch events; the REPL prints them, tests collect them. */
  readonly onEvent?: (target: string, event: ActorMessage) => void;
}

const HELP_LINES = [
  'Commands:',
  '  ls                              list actors (key, origin, status, path)',
  '  spawn <file> <id>               spawn a behavior module as a new actor',
  '  send <target> <json>            fire-and-forget message',
  '  ask <target> <json> [timeout]   request/response (timeout in ms)',
  '  watch <target>                  stream emitted events to the console',
  '  unwatch <target>                stop streaming',
  '  help                            show this help',
  '  exit                            stop the host and leave',
];

/**
 * Split an `--exec` script into console commands on semicolons, ignoring
 * semicolons inside single/double-quoted regions (and backslash escapes) so
 * JSON payloads like `send a {"text":"a;b"}` survive intact.
 */
export function splitExecScript(script: string): string[] {
  const commands: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of script) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';') {
      commands.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  commands.push(current);

  return commands.map((command) => command.trim()).filter((command) => command.length > 0);
}

/**
 * Execute one console line against a host. Shared by the REPL, `--exec`, and
 * tests. Watch subscriptions are tracked per-`watches` map so `unwatch` and
 * shutdown can release them.
 */
export async function executeCommand(
  host: RuntimeHost,
  line: string,
  watches: Map<string, () => void>,
  context: CommandContext = {}
): Promise<CommandOutcome> {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { ok: true, lines: [] };
  }

  const [command, ...rest] = trimmed.split(/\s+/);

  switch (command) {
    case 'help':
      return { ok: true, lines: HELP_LINES };

    case 'exit':
    case 'quit':
      return { ok: true, lines: ['Stopping host...'], exit: true };

    case 'ls': {
      const actors = await host.listActors();
      if (actors.length === 0) {
        return { ok: true, lines: ['(no actors)'] };
      }
      return {
        ok: true,
        lines: actors.map(
          (entry) => `${entry.key}  [${entry.origin}/${entry.status}]  ${entry.path}`
        ),
      };
    }

    case 'spawn': {
      const [file, id] = rest;
      if (!file || !id) {
        return { ok: false, lines: ['Usage: spawn <file> <id>'] };
      }
      const result = await host.spawnFromFile(file, id);
      return result.ok
        ? { ok: true, lines: [`Spawned ${result.value.key} at ${result.value.path}`] }
        : { ok: false, lines: [result.error] };
    }

    case 'send': {
      const target = rest[0];
      if (!target) {
        return { ok: false, lines: ['Usage: send <target> <json>'] };
      }
      const targetStart = trimmed.indexOf(target, command.length);
      const json = trimmed.slice(targetStart + target.length).trim();
      if (!json) {
        return { ok: false, lines: ['Usage: send <target> <json>'] };
      }
      const result = await host.send(target, json);
      return result.ok ? { ok: true, lines: [result.value] } : { ok: false, lines: [result.error] };
    }

    case 'ask': {
      const target = rest[0];
      if (!target) {
        return { ok: false, lines: ['Usage: ask <target> <json> [timeoutMs]'] };
      }
      let remainder = trimmed.slice(trimmed.indexOf(target, command.length) + target.length).trim();
      let timeoutMs: number | undefined;
      const trailingTimeout = remainder.match(/\s(\d+)$/);
      if (trailingTimeout && !remainder.endsWith('}')) {
        timeoutMs = Number.parseInt(trailingTimeout[1], 10);
        remainder = remainder.slice(0, trailingTimeout.index).trim();
      }
      if (!remainder) {
        return { ok: false, lines: ['Usage: ask <target> <json> [timeoutMs]'] };
      }
      const result = await host.ask(target, remainder, timeoutMs);
      return result.ok
        ? { ok: true, lines: [JSON.stringify(result.value)] }
        : { ok: false, lines: [result.error] };
    }

    case 'watch': {
      const [target] = rest;
      if (!target) {
        return { ok: false, lines: ['Usage: watch <target>'] };
      }
      if (watches.has(target)) {
        return { ok: true, lines: [`Already watching ${target}`] };
      }
      const result = host.watch(target, (event) => {
        context.onEvent?.(target, event);
      });
      if (!result.ok) {
        return { ok: false, lines: [result.error] };
      }
      watches.set(target, result.value);
      return { ok: true, lines: [`Watching ${target} (unwatch ${target} to stop)`] };
    }

    case 'unwatch': {
      const [target] = rest;
      if (!target) {
        return { ok: false, lines: ['Usage: unwatch <target>'] };
      }
      const unsubscribe = watches.get(target);
      if (!unsubscribe) {
        return { ok: false, lines: [`Not watching ${target}`] };
      }
      unsubscribe();
      watches.delete(target);
      return { ok: true, lines: [`Stopped watching ${target}`] };
    }

    default:
      return {
        ok: false,
        lines: [`Unknown command: ${command}. Type "help" for available commands.`],
      };
  }
}
