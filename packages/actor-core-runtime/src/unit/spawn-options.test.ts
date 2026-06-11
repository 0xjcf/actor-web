/**
 * @file spawn-options.test.ts
 * @description Pins the SpawnOptions contract: `id` plus an optional
 * per-actor `supervision` policy object.
 *
 * SpawnOptions once declared supervised/persistState/timeout/retries, none of
 * which the runtime ever read. The type-level assertions below keep removed
 * fields from silently returning without an implementation behind them (the
 * `@ts-expect-error` lines fail the typecheck lane if the fields reappear).
 * `supervision` carries the policy object — never a boolean (decisions.md
 * 2026-06-11) — and is honored by the runtime failure path (see
 * supervision-policy.test.ts for the behavioral pins).
 */

import { describe, expect, it } from 'vitest';
import type { SpawnOptions } from '../actor-system.js';
import { createActorSystem } from '../actor-system-impl.js';
import { defineBehavior } from '../unified-actor-builder.js';

function createEchoBehavior() {
  return defineBehavior<{ type: 'PING' }>()
    .withContext({ pings: 0 })
    .onMessage(({ message, actor }) => {
      if (message.type === 'PING') {
        return { reply: actor.getSnapshot().context.pings };
      }
    })
    .build();
}

describe('SpawnOptions contract', () => {
  it('spawns with id as the only option', async () => {
    const system = await createActorSystem({ nodeAddress: 'localhost:0' });
    await system.start();

    try {
      const options: SpawnOptions = { id: 'echo-1' };
      const ref = await system.spawn(createEchoBehavior(), options);
      expect(ref.address.id).toBe('echo-1');
      await expect(ref.ask({ type: 'PING' })).resolves.toBe(0);
    } finally {
      await system.stop();
    }
  });

  it('spawns with no options at all', async () => {
    const system = await createActorSystem({ nodeAddress: 'localhost:0' });
    await system.start();

    try {
      const ref = await system.spawn(createEchoBehavior());
      expect(ref.address.id).toBeTruthy();
    } finally {
      await system.stop();
    }
  });

  it('spawns with a supervision policy object', async () => {
    const system = await createActorSystem({ nodeAddress: 'localhost:0' });
    await system.start();

    try {
      const options: SpawnOptions = {
        id: 'echo-supervised',
        supervision: { strategy: 'restart', maxRestarts: 1, withinMs: 60_000 },
      };
      const ref = await system.spawn(createEchoBehavior(), options);
      expect(ref.address.id).toBe('echo-supervised');
      await expect(ref.ask({ type: 'PING' })).resolves.toBe(0);
    } finally {
      await system.stop();
    }
  });

  it('rejects the removed fields at the type level', () => {
    // @ts-expect-error supervised was never read by the runtime and is removed
    const supervised: SpawnOptions = { supervised: false };
    // @ts-expect-error persistState was never implemented and is removed
    const persist: SpawnOptions = { persistState: true };
    // @ts-expect-error timeout was never read by the runtime and is removed
    const timeout: SpawnOptions = { timeout: 5000 };
    // @ts-expect-error retries was never read by the runtime and is removed
    const retries: SpawnOptions = { retries: 3 };

    expect([supervised, persist, timeout, retries]).toBeDefined();
  });

  it('constrains supervision to a policy object at the type level', () => {
    const policy: SpawnOptions = {
      supervision: { strategy: 'stop' },
    };
    // @ts-expect-error supervision carries the policy object, never a boolean
    const boolPolicy: SpawnOptions = { supervision: true };
    // @ts-expect-error strategy must be restart | resume | stop | escalate
    const badStrategy: SpawnOptions = { supervision: { strategy: 'reboot' } };

    expect([policy, boolPolicy, badStrategy]).toBeDefined();
  });
});
