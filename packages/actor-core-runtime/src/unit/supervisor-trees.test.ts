/**
 * @file supervisor-trees.test.ts
 * @description Pins for topology supervisor() group semantics in the runtime
 * failure path.
 *
 * The pure tree core (`resolveTreeSupervisionDecision`) widens an
 * already-resolved per-actor decision to a group action:
 *
 * - `pass-through` — no group, one-for-one, non-member path, or a stop/resume
 *   child decision (deliberate containment).
 * - `restart-group` — stop in reverse declaration order, respawn in
 *   declaration order (`one-for-all` = all children, `rest-for-one` = the
 *   failed child and later-declared children).
 * - `give-up-group` — bound exhaustion or group-level escalate stops ALL
 *   children and emits one `actorEscalated`; the system itself never stops.
 */

import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  ActorSystemImpl,
  resolveTreeSupervisionDecision,
  type SupervisorGroupConfig,
} from '../actor-system-impl.js';
import { defineBehavior } from '../unified-actor-builder.js';

const PATH_A = 'actor://supervisor-trees-test/actor/a';
const PATH_B = 'actor://supervisor-trees-test/actor/b';
const PATH_C = 'actor://supervisor-trees-test/actor/c';

function group(
  strategy: SupervisorGroupConfig['strategy'],
  children: readonly string[] = [PATH_A, PATH_B, PATH_C]
): SupervisorGroupConfig {
  return { key: 'test-group', strategy, children };
}

const RESTART_DECISION = { kind: 'restart', restartCount: 0, maxRestarts: 3 } as const;
const STOP_PERMANENT_DECISION = {
  kind: 'stop-permanent',
  restartCount: 3,
  maxRestarts: 3,
} as const;

describe('resolveTreeSupervisionDecision (pure tree core)', () => {
  it('passes through when the actor belongs to no group', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: undefined,
        failedChildPath: PATH_B,
      })
    ).toEqual({ kind: 'pass-through' });
  });

  it('passes through stop and resume child decisions inside any group', () => {
    for (const childDecision of [{ kind: 'stop' }, { kind: 'resume' }] as const) {
      expect(
        resolveTreeSupervisionDecision({
          childDecision,
          group: group('one-for-all'),
          failedChildPath: PATH_B,
        })
      ).toEqual({ kind: 'pass-through' });
    }
  });

  it('passes through restart decisions in a one-for-one group', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('one-for-one'),
        failedChildPath: PATH_B,
      })
    ).toEqual({ kind: 'pass-through' });

    // Per-actor escalate inside a one-for-one group also stays per-actor.
    expect(
      resolveTreeSupervisionDecision({
        childDecision: { kind: 'escalate' },
        group: group('one-for-one'),
        failedChildPath: PATH_B,
      })
    ).toEqual({ kind: 'pass-through' });
  });

  it('one-for-all restart stops all children in reverse declaration order and respawns in declaration order', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('one-for-all'),
        failedChildPath: PATH_B,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B, PATH_A],
      respawnOrder: [PATH_A, PATH_B, PATH_C],
    });
  });

  it('rest-for-one restart affects the failed child and later-declared children only', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('rest-for-one'),
        failedChildPath: PATH_B,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B],
      respawnOrder: [PATH_B, PATH_C],
    });

    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('rest-for-one'),
        failedChildPath: PATH_C,
      })
    ).toEqual({ kind: 'restart-group', stopOrder: [PATH_C], respawnOrder: [PATH_C] });

    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('rest-for-one'),
        failedChildPath: PATH_A,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B, PATH_A],
      respawnOrder: [PATH_A, PATH_B, PATH_C],
    });
  });

  it('gives up the group on stop-permanent: all children stop in reverse order with max-restarts-exceeded', () => {
    for (const strategy of ['one-for-all', 'rest-for-one'] as const) {
      expect(
        resolveTreeSupervisionDecision({
          childDecision: STOP_PERMANENT_DECISION,
          group: group(strategy),
          failedChildPath: PATH_B,
        })
      ).toEqual({
        kind: 'give-up-group',
        stopOrder: [PATH_C, PATH_B, PATH_A],
        reason: 'max-restarts-exceeded',
      });
    }
  });

  it('group strategy escalate gives up the group with supervisor-escalated', () => {
    for (const childDecision of [
      RESTART_DECISION,
      STOP_PERMANENT_DECISION,
      { kind: 'escalate' } as const,
    ]) {
      expect(
        resolveTreeSupervisionDecision({
          childDecision,
          group: group('escalate'),
          failedChildPath: PATH_B,
        })
      ).toEqual({
        kind: 'give-up-group',
        stopOrder: [PATH_C, PATH_B, PATH_A],
        reason: 'supervisor-escalated',
      });
    }
  });

  it('treats a raw escalate decision in a widening group as a group restart', () => {
    // The shell normally substitutes restart bounds before calling; this pins
    // totality if a raw escalate ever reaches the core.
    expect(
      resolveTreeSupervisionDecision({
        childDecision: { kind: 'escalate' },
        group: group('one-for-all'),
        failedChildPath: PATH_B,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B, PATH_A],
      respawnOrder: [PATH_A, PATH_B, PATH_C],
    });
  });

  it('passes through when the failed path is not a group member', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('one-for-all'),
        failedChildPath: 'actor://supervisor-trees-test/actor/stranger',
      })
    ).toEqual({ kind: 'pass-through' });
  });
});

type SystemEventRecord = {
  eventType: string;
  timestamp: number;
  data?: { address?: string; reason?: string; supervisor?: string; [key: string]: unknown };
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
      throw new Error('induced group failure');
    })
    .build();
}

type PublisherMessage = { type: 'PING' } | { type: 'BOOM' };
type PublishedEvent = { type: 'PINGED' };
type SubscriberMessage = { type: 'PINGED' } | { type: 'GET' };

function createPublisherBehavior() {
  return defineBehavior<PublisherMessage, PublishedEvent>()
    .withContext({})
    .onMessage(({ message }) => {
      if (message.type === 'PING') {
        return { emit: [{ type: 'PINGED' as const }] };
      }
      throw new Error('induced publisher failure');
    })
    .build();
}

function createSubscriberBehavior() {
  return defineBehavior<SubscriberMessage>()
    .withContext({ received: 0 })
    .onMessage(({ message, actor }) => {
      const { received } = actor.getSnapshot().context;
      if (message.type === 'PINGED') {
        // Auto-publishing delivers events through the ask path; reply so the
        // delivery does not log a missing-reply warning.
        return { context: { received: received + 1 }, reply: { ok: true } };
      }
      return { reply: received };
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

describe('supervisor group failure path (behavioral)', () => {
  const NODE = 'supervisor-trees-test';
  let system: ActorSystemImpl;
  // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
  let emitSystemEventSpy: MockInstance<any>;

  function pathOf(id: string): string {
    return `actor://${NODE}/actor/${id}`;
  }

  async function makeSystem(supervisors: SupervisorGroupConfig[]): Promise<void> {
    system = new ActorSystemImpl({ nodeAddress: NODE, supervisors });
    await system.start();
    // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
    emitSystemEventSpy = vi.spyOn(system as any, 'emitSystemEvent');
  }

  afterEach(async () => {
    if (system?.isRunning()) {
      await system.stop();
    }
  });

  it(
    'one-for-one group isolates a failure: only the failed child restarts, sibling untouched',
    { timeout: 20_000 },
    async () => {
      await makeSystem([
        { key: 'pair', strategy: 'one-for-one', children: [pathOf('solo-a'), pathOf('solo-b')] },
      ]);
      const crasher = await system.spawn(createCrashableCounter(), { id: 'solo-a' });
      const sibling = await system.spawn(createCrashableCounter(), { id: 'solo-b' });

      await sibling.send({ type: 'INC' });
      await system.flush();
      await crasher.send({ type: 'BOOM' });
      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) => event.eventType === 'actorRestarted' && event.data?.address === pathOf('solo-a'),
        'restart of the failed one-for-one child'
      );

      expect(eventsFor(emitSystemEventSpy, 'actorStopping', pathOf('solo-b'))).toHaveLength(0);
      expect(eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('solo-b'))).toHaveLength(0);
      await expect(sibling.ask<number>({ type: 'GET' })).resolves.toBe(1);
    }
  );

  it(
    'one-for-all restarts every child on a single failure with ordered reason-coded events',
    { timeout: 30_000 },
    async () => {
      const paths = [pathOf('all-a'), pathOf('all-b'), pathOf('all-c')];
      await makeSystem([{ key: 'trio', strategy: 'one-for-all', children: paths }]);
      await system.spawn(createCrashableCounter(), { id: 'all-a' });
      const middle = await system.spawn(createCrashableCounter(), { id: 'all-b' });
      await system.spawn(createCrashableCounter(), { id: 'all-c' });

      await middle.send({ type: 'BOOM' });
      for (const path of paths) {
        await waitForSystemEvent(
          emitSystemEventSpy,
          (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
          `group restart of ${path}`
        );
      }

      const groupStops = recordedEvents(emitSystemEventSpy).filter(
        (event) =>
          event.eventType === 'actorStopped' && event.data?.reason === 'supervisor-group-restart'
      );
      expect(groupStops.map((event) => event.data?.address)).toEqual([
        pathOf('all-c'),
        pathOf('all-b'),
        pathOf('all-a'),
      ]);

      const restarts = recordedEvents(emitSystemEventSpy).filter(
        (event) => event.eventType === 'actorRestarted'
      );
      expect(restarts.map((event) => event.data?.address)).toEqual(paths);
      for (const event of restarts) {
        expect(event.data?.supervisor).toBe('trio');
      }
      for (const path of paths) {
        expect(eventsFor(emitSystemEventSpy, 'actorStopped', path)).toHaveLength(1);
      }
    }
  );

  it(
    'auto-publishing subscriptions still deliver after a one-for-all group restart',
    { timeout: 30_000 },
    async () => {
      const paths = [pathOf('pub'), pathOf('sub')];
      await makeSystem([{ key: 'pubsub', strategy: 'one-for-all', children: paths }]);
      const publisher = await system.spawn(createPublisherBehavior(), { id: 'pub' });
      const subscriber = await system.spawn(createSubscriberBehavior(), { id: 'sub' });
      await system.subscribe(publisher, { subscriber });

      await publisher.send({ type: 'BOOM' });
      for (const path of paths) {
        await waitForSystemEvent(
          emitSystemEventSpy,
          (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
          `group restart of ${path}`
        );
      }

      const restartedPublisher = await system.lookup(pathOf('pub'));
      expect(restartedPublisher).toBeDefined();
      await restartedPublisher?.send({ type: 'PING' });
      await system.flush();

      const restartedSubscriber = await system.lookup(pathOf('sub'));
      await expect(restartedSubscriber?.ask<number>({ type: 'GET' })).resolves.toBe(1);
    }
  );

  it(
    'rest-for-one restarts only the failed child and later-declared children',
    { timeout: 30_000 },
    async () => {
      const paths = [pathOf('rest-a'), pathOf('rest-b'), pathOf('rest-c')];
      await makeSystem([{ key: 'chain', strategy: 'rest-for-one', children: paths }]);
      const first = await system.spawn(createCrashableCounter(), { id: 'rest-a' });
      const middle = await system.spawn(createCrashableCounter(), { id: 'rest-b' });
      await system.spawn(createCrashableCounter(), { id: 'rest-c' });

      await first.send({ type: 'INC' });
      await system.flush();
      await middle.send({ type: 'BOOM' });
      for (const path of [pathOf('rest-b'), pathOf('rest-c')]) {
        await waitForSystemEvent(
          emitSystemEventSpy,
          (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
          `rest-for-one restart of ${path}`
        );
      }

      expect(eventsFor(emitSystemEventSpy, 'actorStopping', pathOf('rest-a'))).toHaveLength(0);
      expect(eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('rest-a'))).toHaveLength(0);
      await expect(first.ask<number>({ type: 'GET' })).resolves.toBe(1);
    }
  );

  it(
    'group restart counts against the failing child only: sibling budgets reset, failing child bound enforced',
    { timeout: 30_000 },
    async () => {
      const bounded = { strategy: 'restart', maxRestarts: 1, withinMs: 60_000 } as const;
      const paths = [pathOf('budget-a'), pathOf('budget-b')];
      await makeSystem([{ key: 'budget', strategy: 'one-for-all', children: paths }]);
      const crasher = await system.spawn(createCrashableCounter(), {
        id: 'budget-a',
        supervision: bounded,
      });
      await system.spawn(createCrashableCounter(), { id: 'budget-b', supervision: bounded });

      await crasher.send({ type: 'BOOM' });
      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) =>
          event.eventType === 'actorRestarted' && event.data?.address === pathOf('budget-a'),
        'first group restart'
      );

      const restartedCrasher = await system.lookup(pathOf('budget-a'));
      await restartedCrasher?.send({ type: 'BOOM' });
      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) =>
          event.eventType === 'actorEscalated' &&
          event.data?.reason === 'max-restarts-exceeded' &&
          event.data?.supervisor === 'budget',
        'group give-up after the failing child exhausted its bound'
      );

      expect(
        recordedEvents(emitSystemEventSpy).filter(
          (event) =>
            event.eventType === 'actorStopped' &&
            event.data?.address === pathOf('budget-a') &&
            event.data?.reason === 'max-restarts-exceeded'
        )
      ).toHaveLength(1);
      expect(
        recordedEvents(emitSystemEventSpy).filter(
          (event) =>
            event.eventType === 'actorStopped' &&
            event.data?.address === pathOf('budget-b') &&
            event.data?.reason === 'supervisor-max-restarts-exceeded'
        )
      ).toHaveLength(1);
      expect(
        recordedEvents(emitSystemEventSpy).filter((event) => event.eventType === 'actorEscalated')
      ).toHaveLength(1);
    }
  );

  it('sibling budgets are not consumed by collateral restarts', { timeout: 30_000 }, async () => {
    const bounded = { strategy: 'restart', maxRestarts: 1, withinMs: 60_000 } as const;
    const paths = [pathOf('collateral-a'), pathOf('collateral-b')];
    await makeSystem([{ key: 'collateral', strategy: 'one-for-all', children: paths }]);
    const crasher = await system.spawn(createCrashableCounter(), {
      id: 'collateral-a',
      supervision: bounded,
    });
    await system.spawn(createCrashableCounter(), { id: 'collateral-b', supervision: bounded });

    await crasher.send({ type: 'BOOM' });
    for (const path of paths) {
      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
        `first group restart of ${path}`
      );
    }

    // The sibling was restarted as collateral; its own budget must be
    // intact, so its first own failure restarts rather than gives up.
    const sibling = await system.lookup(pathOf('collateral-b'));
    await sibling?.send({ type: 'BOOM' });
    await waitForSystemEvent(
      emitSystemEventSpy,
      (event) =>
        event.eventType === 'actorRestarted' &&
        event.data?.address === pathOf('collateral-b') &&
        (event.data?.restartAttempt as number) >= 1 &&
        recordedEvents(emitSystemEventSpy).filter(
          (candidate) =>
            candidate.eventType === 'actorRestarted' &&
            candidate.data?.address === pathOf('collateral-b')
        ).length >= 2,
      'sibling restarts on its own budget after collateral restart'
    );

    expect(
      recordedEvents(emitSystemEventSpy).filter((event) => event.eventType === 'actorEscalated')
    ).toHaveLength(0);
  });

  it(
    'bound exhaustion on first failure stops the whole group (maxRestarts: 0)',
    { timeout: 20_000 },
    async () => {
      const paths = [pathOf('fatal-a'), pathOf('fatal-b')];
      await makeSystem([{ key: 'fatal', strategy: 'one-for-all', children: paths }]);
      const crasher = await system.spawn(createCrashableCounter(), {
        id: 'fatal-a',
        supervision: { strategy: 'restart', maxRestarts: 0 },
      });
      await system.spawn(createCrashableCounter(), { id: 'fatal-b' });

      await crasher.send({ type: 'BOOM' });
      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) =>
          event.eventType === 'actorEscalated' &&
          event.data?.reason === 'max-restarts-exceeded' &&
          event.data?.supervisor === 'fatal',
        'immediate group give-up'
      );

      expect(
        eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('fatal-a'))[0]?.data?.reason
      ).toBe('max-restarts-exceeded');
      expect(
        eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('fatal-b'))[0]?.data?.reason
      ).toBe('supervisor-max-restarts-exceeded');
      expect(
        recordedEvents(emitSystemEventSpy).filter((event) => event.eventType === 'actorRestarted')
      ).toHaveLength(0);
    }
  );

  it(
    'escalating child inside a one-for-all group triggers a bounded group restart',
    { timeout: 30_000 },
    async () => {
      const paths = [pathOf('esc-a'), pathOf('esc-b')];
      await makeSystem([{ key: 'escalating', strategy: 'one-for-all', children: paths }]);
      const escalator = await system.spawn(createCrashableCounter(), {
        id: 'esc-a',
        supervision: { strategy: 'escalate' },
      });
      await system.spawn(createCrashableCounter(), { id: 'esc-b' });

      await escalator.send({ type: 'BOOM' });
      for (const path of paths) {
        await waitForSystemEvent(
          emitSystemEventSpy,
          (event) => event.eventType === 'actorRestarted' && event.data?.address === path,
          `escalate-driven group restart of ${path}`
        );
      }

      expect(
        recordedEvents(emitSystemEventSpy).filter((event) => event.eventType === 'actorEscalated')
      ).toHaveLength(0);
    }
  );

  it(
    'escalating child with exhausted bounds stops the whole group',
    { timeout: 20_000 },
    async () => {
      const paths = [pathOf('esc-fatal-a'), pathOf('esc-fatal-b')];
      await makeSystem([{ key: 'esc-fatal', strategy: 'one-for-all', children: paths }]);
      const escalator = await system.spawn(createCrashableCounter(), {
        id: 'esc-fatal-a',
        supervision: { strategy: 'escalate', maxRestarts: 0 },
      });
      await system.spawn(createCrashableCounter(), { id: 'esc-fatal-b' });

      await escalator.send({ type: 'BOOM' });
      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) =>
          event.eventType === 'actorEscalated' &&
          event.data?.reason === 'max-restarts-exceeded' &&
          event.data?.supervisor === 'esc-fatal',
        'give-up from an escalating child with exhausted bounds'
      );
    }
  );

  it(
    'group strategy escalate stops the group without stopping the system',
    { timeout: 20_000 },
    async () => {
      const paths = [pathOf('loud-a'), pathOf('loud-b')];
      await makeSystem([{ key: 'loud', strategy: 'escalate', children: paths }]);
      const crasher = await system.spawn(createCrashableCounter(), { id: 'loud-a' });
      await system.spawn(createCrashableCounter(), { id: 'loud-b' });

      await crasher.send({ type: 'BOOM' });
      const escalation = await waitForSystemEvent(
        emitSystemEventSpy,
        (event) => event.eventType === 'actorEscalated' && event.data?.supervisor === 'loud',
        'group-level escalation'
      );

      expect(escalation.data?.reason).toBe('supervisor-escalated');
      expect(escalation.data?.error).toContain('induced group failure');
      for (const path of paths) {
        expect(eventsFor(emitSystemEventSpy, 'actorStopped', path)[0]?.data?.reason).toBe(
          'supervisor-escalated'
        );
      }

      expect(system.isRunning()).toBe(true);
      const fresh = await system.spawn(createCrashableCounter(), { id: 'post-escalation' });
      await fresh.send({ type: 'INC' });
      await expect(fresh.ask<number>({ type: 'GET' })).resolves.toBe(1);
    }
  );

  it(
    'give-up skips already-stopped members instead of emitting a second terminal event',
    { timeout: 20_000 },
    async () => {
      const paths = [pathOf('ghost-a'), pathOf('ghost-b')];
      await makeSystem([{ key: 'ghosts', strategy: 'one-for-all', children: paths }]);
      const crasher = await system.spawn(createCrashableCounter(), {
        id: 'ghost-a',
        supervision: { strategy: 'restart', maxRestarts: 0 },
      });
      const departed = await system.spawn(createCrashableCounter(), { id: 'ghost-b' });

      // The sibling stops before the group gives up (e.g. a manual stop or an
      // earlier per-actor stop policy). Teardown emits its single terminal
      // actorStopped here.
      await departed.stop();
      expect(eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('ghost-b'))).toHaveLength(1);

      await crasher.send({ type: 'BOOM' });
      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) =>
          event.eventType === 'actorEscalated' &&
          event.data?.reason === 'max-restarts-exceeded' &&
          event.data?.supervisor === 'ghosts',
        'group give-up with an already-stopped member'
      );

      // The already-stopped member must NOT receive a second terminal event;
      // its single actorStopped is the one teardown emitted at stop() time.
      expect(eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('ghost-b'))).toHaveLength(1);
      expect(
        eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('ghost-a'))[0]?.data?.reason
      ).toBe('max-restarts-exceeded');
    }
  );

  it(
    'group restart neither re-stops nor resurrects a member stopped during the backoff window',
    { timeout: 20_000 },
    async () => {
      const paths = [pathOf('window-a'), pathOf('window-b')];
      await makeSystem([{ key: 'window', strategy: 'one-for-all', children: paths }]);
      const crasher = await system.spawn(createCrashableCounter(), { id: 'window-a' });
      const departing = await system.spawn(createCrashableCounter(), { id: 'window-b' });

      await crasher.send({ type: 'BOOM' });
      // The group restart is now waiting out its backoff (1s at count 0).
      // Stop the sibling inside that window — a deliberate stop must win.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await departing.stop();
      expect(eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('window-b'))).toHaveLength(1);

      await waitForSystemEvent(
        emitSystemEventSpy,
        (event) =>
          event.eventType === 'actorRestarted' && event.data?.address === pathOf('window-a'),
        'failing child restarts after the backoff'
      );

      // The departed sibling keeps its single terminal event and stays gone.
      expect(eventsFor(emitSystemEventSpy, 'actorStopped', pathOf('window-b'))).toHaveLength(1);
      expect(eventsFor(emitSystemEventSpy, 'actorRestarted', pathOf('window-b'))).toHaveLength(0);
      await expect(system.lookup(pathOf('window-b'))).resolves.toBeUndefined();
    }
  );

  it(
    'group restart does not respawn over a member whose stop failed while still registered',
    { timeout: 20_000 },
    async () => {
      const paths = [pathOf('stuck-a'), pathOf('stuck-b')];
      await makeSystem([{ key: 'stuck', strategy: 'one-for-all', children: paths }]);
      const crasher = await system.spawn(createCrashableCounter(), { id: 'stuck-a' });
      const survivor = await system.spawn(createCrashableCounter(), { id: 'stuck-b' });
      await survivor.send({ type: 'INC' });
      await system.flush();

      // Induce a stop failure for the sibling that leaves it registered:
      // respawning over a still-live instance would stack a duplicate.
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const originalStopActor = (system as any).stopActor.bind(system);
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const stopSpy = vi
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        .spyOn(system as any, 'stopActor')
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        .mockImplementation(async (pid: any, reason?: unknown) => {
          if (pid?.address?.path === pathOf('stuck-b') && reason === 'supervisor-group-restart') {
            throw new Error('induced stop failure');
          }
          return originalStopActor(pid, reason);
        });

      try {
        await crasher.send({ type: 'BOOM' });
        await waitForSystemEvent(
          emitSystemEventSpy,
          (event) =>
            event.eventType === 'actorRestarted' && event.data?.address === pathOf('stuck-a'),
          'failing child restarts despite the sibling stop failure'
        );

        // The sibling must not be respawned over its still-live instance:
        // no actorRestarted for it, and the ORIGINAL instance (with its
        // pre-failure state) is still the one registered.
        expect(eventsFor(emitSystemEventSpy, 'actorRestarted', pathOf('stuck-b'))).toHaveLength(0);
        await expect(survivor.ask<number>({ type: 'GET' })).resolves.toBe(1);
      } finally {
        stopSpy.mockRestore();
      }
    }
  );

  it(
    're-entrancy guard swallows failures during an in-flight group action',
    { timeout: 15_000 },
    async () => {
      const paths = [pathOf('guard-a'), pathOf('guard-b')];
      await makeSystem([{ key: 'guarded', strategy: 'one-for-all', children: paths }]);
      await system.spawn(createCrashableCounter(), { id: 'guard-a' });
      await system.spawn(createCrashableCounter(), { id: 'guard-b' });
      emitSystemEventSpy.mockClear();

      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      (system as any).restartingGroups.add('guarded');
      try {
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        await (system as any).applySupervisionStrategy(
          { id: 'guard-a', type: 'actor', node: NODE, path: pathOf('guard-a') },
          new Error('induced during group action')
        );
      } finally {
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        (system as any).restartingGroups.delete('guarded');
      }

      for (const eventType of ['actorStopping', 'actorStopped', 'actorRestarted']) {
        expect(eventsFor(emitSystemEventSpy, eventType, pathOf('guard-a'))).toHaveLength(0);
      }
    }
  );
});
