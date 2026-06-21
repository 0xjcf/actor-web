/**
 * @file supervision-policy.test.ts
 * @description Behavioral pins for per-actor supervision policies.
 *
 * The topology DSL accepts `actor({ supervision: { strategy, maxRestarts,
 * withinMs } })` and SpawnOptions carries the same policy object. These tests
 * pin the runtime failure path:
 *
 * - `restart` (default): bounded restarts with exponential backoff; exceeding
 *   `maxRestarts` within `withinMs` stops the actor permanently.
 * - `stop`: zero restarts — the actor stops on first failure.
 * - `escalate`: stop + a distinct `actorEscalated` system event (supervisor
 *   tree propagation is the companion 6-agent task).
 * - `resume`: the actor keeps its current state, the failed message is
 *   skipped, and the rest of the mailbox is preserved.
 * - No policy: system-wide defaults (3 restarts per 30s) apply — pinned
 *   deterministically through the pure decision core.
 * - System actors (system-event actor) keep default restart behavior.
 */

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { createMachine } from 'xstate';
import type { ActorAddress, ActorSupervisionPolicy } from '../actor-system.js';
import { ActorSystemImpl, resolveSupervisionDecision } from '../actor-system-impl.js';
import { defineBehavior } from '../unified-actor-builder.js';

type SystemEventRecord = {
  eventType: string;
  timestamp: number;
  data?: { address?: string; reason?: string; [key: string]: unknown };
};

type CrashableMessage = { type: 'INC' } | { type: 'GET' } | { type: 'BOOM' };

function createCrashableCounter() {
  return defineBehavior<CrashableMessage>()
    .withContext({ count: 0 })
    .onMessage(({ message, actor }) => {
      const { count } = actor.getSnapshot().context;
      if (message.type === 'INC') {
        return { context: { count: count + 1 } };
      }
      if (message.type === 'GET') {
        return { reply: count };
      }
      throw new Error('induced failure');
    })
    .build();
}

type MachineCrashMessage = { type: 'ADVANCE' } | { type: 'BOOM' };

function createCrashableMachineBehavior() {
  const machine = createMachine({
    id: 'crashable-machine',
    initial: 'idle',
    states: {
      idle: { on: { ADVANCE: 'running', BOOM: 'idle' } },
      running: {},
    },
  });
  return defineBehavior<MachineCrashMessage>()
    .withMachine(machine)
    .onTransition({
      BOOM: () => {
        throw new Error('induced machine failure');
      },
    })
    .build();
}

// biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
function recordedEvents(spy: MockInstance<any>): SystemEventRecord[] {
  return spy.mock.calls.map((call) => call[0] as SystemEventRecord);
}

function eventsFor(
  // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
  spy: MockInstance<any>,
  eventType: string,
  address: string
): SystemEventRecord[] {
  return recordedEvents(spy).filter(
    (event) => event.eventType === eventType && event.data?.address === address
  );
}

async function waitForSystemEvent(
  // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
  spy: MockInstance<any>,
  predicate: (event: SystemEventRecord) => boolean,
  description: string,
  timeoutMs = 10_000
): Promise<SystemEventRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = recordedEvents(spy).find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for system event: ${description}`);
}

describe('per-actor supervision policies (behavioral)', () => {
  let system: ActorSystemImpl;
  // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
  let emitSystemEventSpy: MockInstance<any>;

  beforeEach(async () => {
    system = new ActorSystemImpl({ nodeAddress: 'supervision-policy-test' });
    await system.start();
    // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
    emitSystemEventSpy = vi.spyOn(system as any, 'emitSystemEvent');
  });

  afterEach(async () => {
    if (system?.isRunning()) {
      await system.stop();
    }
  });

  it('honors a custom maxRestarts bound: exactly one restart, then permanent stop', async () => {
    const ref = await system.spawn(createCrashableCounter(), {
      id: 'bounded-crasher',
      supervision: { strategy: 'restart', maxRestarts: 1, withinMs: 60_000 },
    });
    const path = ref.address;

    await ref.send({ type: 'BOOM' });
    await waitForSystemEvent(
      emitSystemEventSpy,
      (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
      'first restart of bounded-crasher'
    );

    await ref.send({ type: 'BOOM' });
    await waitForSystemEvent(
      emitSystemEventSpy,
      (event) =>
        event.eventType === 'actorStopped' &&
        event.data?.address === path &&
        event.data?.reason === 'max-restarts-exceeded',
      'permanent stop of bounded-crasher'
    );

    expect(eventsFor(emitSystemEventSpy, 'actorRestarted', path)).toHaveLength(1);
    // Exactly one terminal actorStopped per stop: one plain stop from the
    // restart teardown plus exactly one reason-coded permanent stop — the
    // permanent stop must not double-emit.
    const stoppedEvents = eventsFor(emitSystemEventSpy, 'actorStopped', path);
    expect(
      stoppedEvents.filter((event) => event.data?.reason === 'max-restarts-exceeded')
    ).toHaveLength(1);
    expect(stoppedEvents).toHaveLength(2);
    await expect(system.lookup(path)).resolves.toBeFalsy();
  }, 30_000);

  it('stop policy stops the actor with zero restarts', async () => {
    const ref = await system.spawn(createCrashableCounter(), {
      id: 'stop-on-failure',
      supervision: { strategy: 'stop' },
    });
    const path = ref.address;

    await ref.send({ type: 'BOOM' });
    await waitForSystemEvent(
      emitSystemEventSpy,
      (event) =>
        event.eventType === 'actorStopped' &&
        event.data?.address === path &&
        event.data?.reason === 'supervision-stop',
      'supervision-stop of stop-on-failure'
    );

    expect(eventsFor(emitSystemEventSpy, 'actorRestarted', path)).toHaveLength(0);
    // Exactly one terminal actorStopped, carrying the reason — not a plain
    // stop plus a second reason-coded duplicate.
    const stoppedEvents = eventsFor(emitSystemEventSpy, 'actorStopped', path);
    expect(stoppedEvents).toHaveLength(1);
    expect(stoppedEvents[0]?.data?.reason).toBe('supervision-stop');
    await expect(system.lookup(path)).resolves.toBeFalsy();
  }, 15_000);

  it('escalate policy stops the actor and emits a distinct escalation event', async () => {
    const ref = await system.spawn(createCrashableCounter(), {
      id: 'escalate-on-failure',
      supervision: { strategy: 'escalate' },
    });
    const path = ref.address;

    await ref.send({ type: 'BOOM' });
    const escalated = await waitForSystemEvent(
      emitSystemEventSpy,
      (event) => event.eventType === 'actorEscalated' && event.data?.address === path,
      'escalation event for escalate-on-failure'
    );

    expect(escalated.data?.reason).toBe('supervision-escalate');
    expect(eventsFor(emitSystemEventSpy, 'actorRestarted', path)).toHaveLength(0);
    expect(eventsFor(emitSystemEventSpy, 'actorStopping', path).length).toBeGreaterThan(0);
    await expect(system.lookup(path)).resolves.toBeFalsy();
  }, 15_000);

  it('resume policy keeps state, skips the failed message, and preserves the mailbox', async () => {
    const ref = await system.spawn(createCrashableCounter(), {
      id: 'resume-on-failure',
      supervision: { strategy: 'resume' },
    });
    const path = ref.address;

    await ref.send({ type: 'INC' });
    await ref.send({ type: 'BOOM' });
    await ref.send({ type: 'INC' });

    await waitForSystemEvent(
      emitSystemEventSpy,
      (event) => event.eventType === 'actorResumed' && event.data?.address === path,
      'resume event for resume-on-failure'
    );

    // State survived the failure and the message after the failure was
    // processed: two INCs landed, the BOOM in between was skipped.
    await expect(ref.ask({ type: 'GET' })).resolves.toBe(2);
    expect(eventsFor(emitSystemEventSpy, 'actorRestarted', path)).toHaveLength(0);
    expect(eventsFor(emitSystemEventSpy, 'actorStopping', path)).toHaveLength(0);
  }, 15_000);

  it('actor with no policy keeps the default restart behavior', async () => {
    const ref = await system.spawn(createCrashableCounter(), { id: 'default-crasher' });
    const path = ref.address;

    await ref.send({ type: 'BOOM' });
    await waitForSystemEvent(
      emitSystemEventSpy,
      (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
      'default restart of default-crasher'
    );

    expect(
      eventsFor(emitSystemEventSpy, 'actorStopped', path).filter(
        (event) => event.data?.reason === 'max-restarts-exceeded'
      )
    ).toHaveLength(0);
  }, 15_000);

  it('rejects an unsupported strategy value at spawn time', async () => {
    // Runtime validation pin for non-TypeScript consumers (the type-level pin
    // lives in spawn-options.test.ts).
    const invalidPolicy = { strategy: 'reboot' } as unknown as ActorSupervisionPolicy;
    await expect(
      system.spawn(createCrashableCounter(), {
        id: 'bad-policy',
        supervision: invalidPolicy,
      })
    ).rejects.toThrow(/restart, resume, stop, escalate/);
  });

  it('rejects a negative or non-integer maxRestarts at spawn time', async () => {
    // Runtime validation pins for non-TypeScript consumers: maxRestarts must
    // be a non-negative integer when provided.
    await expect(
      system.spawn(createCrashableCounter(), {
        id: 'bad-max-restarts-negative',
        supervision: { strategy: 'restart', maxRestarts: -1 },
      })
    ).rejects.toThrow(/non-negative integer/);

    await expect(
      system.spawn(createCrashableCounter(), {
        id: 'bad-max-restarts-fraction',
        supervision: { strategy: 'restart', maxRestarts: 1.5 },
      })
    ).rejects.toThrow(/non-negative integer/);
  });

  it('rejects a non-positive or non-finite withinMs at spawn time', async () => {
    // Runtime validation pins for non-TypeScript consumers: withinMs must be
    // a positive finite number of milliseconds when provided.
    await expect(
      system.spawn(createCrashableCounter(), {
        id: 'bad-within-ms-zero',
        supervision: { strategy: 'restart', withinMs: 0 },
      })
    ).rejects.toThrow(/positive finite number/);

    await expect(
      system.spawn(createCrashableCounter(), {
        id: 'bad-within-ms-nan',
        supervision: { strategy: 'restart', withinMs: Number.NaN },
      })
    ).rejects.toThrow(/positive finite number/);
  });

  it('machine-backed actor is still a machine actor after a supervised restart', async () => {
    // Machine lookups key on behavior object identity; the restart path must
    // respawn from the original behavior reference, not the normalized copy,
    // or the actor silently comes back as a context/stateless actor.
    const ref = await system.spawn(createCrashableMachineBehavior(), {
      id: 'machine-crasher',
      supervision: { strategy: 'restart', maxRestarts: 2, withinMs: 60_000 },
    });
    const path = ref.address;

    // biome-ignore lint/suspicious/noExplicitAny: pinning the runtime actor kind requires private access
    expect((system as any).actorInstances.get(path)?.getType()).toBe('machine');

    await ref.send({ type: 'BOOM' });
    await waitForSystemEvent(
      emitSystemEventSpy,
      (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
      'restart of machine-crasher'
    );

    // Still a MachineActor after the supervised restart...
    // biome-ignore lint/suspicious/noExplicitAny: pinning the runtime actor kind requires private access
    expect((system as any).actorInstances.get(path)?.getType()).toBe('machine');

    // ...and the machine still drives behavior: a legal transition resolves
    // ask(...) with the post-transition machine snapshot ({ value, context }).
    await expect(ref.ask({ type: 'ADVANCE' })).resolves.toMatchObject({ value: 'running' });
  }, 20_000);

  it('system-event actor failure path keeps default restart behavior', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
    const address = (system as any).systemEventActorAddress as ActorAddress;
    expect(address).toBeDefined();

    // Drive the failure path directly: the system-event actor's handler is
    // total over its message union, so a behavioral crash cannot be staged
    // through messages. This pins that a failure still restarts it under
    // the system defaults instead of silently opting it out.
    // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
    await (system as any).applySupervisionStrategy(
      address,
      new Error('induced system actor failure')
    );

    expect(eventsFor(emitSystemEventSpy, 'actorRestarted', address)).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
    expect((system as any).actorMailboxes.has(address)).toBe(true);

    // The restarted system-event actor still receives system events.
    emitSystemEventSpy.mockClear();
    await system.spawn(createCrashableCounter(), { id: 'post-restart-spawn' });
    expect(
      recordedEvents(emitSystemEventSpy).some((event) => event.eventType === 'actorSpawned')
    ).toBe(true);
  }, 20_000);
});

describe('resolveSupervisionDecision (pure decision core)', () => {
  const now = 1_750_000_000_000;

  it('defaults to bounded restart: 3 restarts within 30 seconds', () => {
    expect(
      resolveSupervisionDecision({ restartCount: 0, lastRestartTimeMs: 0, nowMs: now })
    ).toEqual({ kind: 'restart', restartCount: 0, maxRestarts: 3 });

    expect(
      resolveSupervisionDecision({ restartCount: 2, lastRestartTimeMs: now, nowMs: now })
    ).toEqual({ kind: 'restart', restartCount: 2, maxRestarts: 3 });

    expect(
      resolveSupervisionDecision({ restartCount: 3, lastRestartTimeMs: now, nowMs: now }).kind
    ).toBe('stop-permanent');
  });

  it('resets the restart count when the default 30s window has elapsed', () => {
    expect(
      resolveSupervisionDecision({
        restartCount: 3,
        lastRestartTimeMs: now - 30_001,
        nowMs: now,
      })
    ).toEqual({ kind: 'restart', restartCount: 0, maxRestarts: 3 });

    expect(
      resolveSupervisionDecision({
        restartCount: 3,
        lastRestartTimeMs: now - 29_999,
        nowMs: now,
      }).kind
    ).toBe('stop-permanent');
  });

  it('honors policy maxRestarts/withinMs overrides', () => {
    const policy: ActorSupervisionPolicy = {
      strategy: 'restart',
      maxRestarts: 5,
      withinMs: 60_000,
    };

    expect(
      resolveSupervisionDecision({ policy, restartCount: 4, lastRestartTimeMs: now, nowMs: now })
    ).toEqual({ kind: 'restart', restartCount: 4, maxRestarts: 5 });

    expect(
      resolveSupervisionDecision({ policy, restartCount: 5, lastRestartTimeMs: now, nowMs: now })
        .kind
    ).toBe('stop-permanent');

    expect(
      resolveSupervisionDecision({
        policy,
        restartCount: 5,
        lastRestartTimeMs: now - 60_001,
        nowMs: now,
      })
    ).toEqual({ kind: 'restart', restartCount: 0, maxRestarts: 5 });
  });

  it('treats maxRestarts: 0 as stop on first failure', () => {
    expect(
      resolveSupervisionDecision({
        policy: { strategy: 'restart', maxRestarts: 0 },
        restartCount: 0,
        lastRestartTimeMs: 0,
        nowMs: now,
      }).kind
    ).toBe('stop-permanent');
  });

  it('maps stop, escalate, and resume strategies to their decisions', () => {
    expect(
      resolveSupervisionDecision({
        policy: { strategy: 'stop' },
        restartCount: 0,
        lastRestartTimeMs: 0,
        nowMs: now,
      })
    ).toEqual({ kind: 'stop' });

    expect(
      resolveSupervisionDecision({
        policy: { strategy: 'escalate' },
        restartCount: 0,
        lastRestartTimeMs: 0,
        nowMs: now,
      })
    ).toEqual({ kind: 'escalate' });

    expect(
      resolveSupervisionDecision({
        policy: { strategy: 'resume' },
        restartCount: 0,
        lastRestartTimeMs: 0,
        nowMs: now,
      })
    ).toEqual({ kind: 'resume' });
  });
});
