import { describe, expect, it } from 'vitest';

import { type ActorContext, FallbackContextStorage } from '../actor-context-manager.js';

function createContext(actorId: string): ActorContext {
  return { actorId };
}

describe('FallbackContextStorage', () => {
  it('preserves context until async completion and restores it afterward', async () => {
    const storage = new FallbackContextStorage<ActorContext>();
    const context = createContext('async-actor');
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = storage.run(context, async () => {
      expect(storage.getStore()).toEqual(context);
      await completion;
      expect(storage.getStore()).toEqual(context);
      return 'done';
    });

    expect(storage.getStore()).toEqual(context);
    release();

    await expect(pending).resolves.toBe('done');
    expect(storage.getStore()).toBeUndefined();
  });

  it('restores the previous context after a synchronous return', () => {
    const storage = new FallbackContextStorage<ActorContext>();
    const outer = createContext('outer-actor');
    const inner = createContext('inner-actor');

    storage.run(outer, () => {
      expect(storage.getStore()).toEqual(outer);

      const value = storage.run(inner, () => {
        expect(storage.getStore()).toEqual(inner);
        return 'inner-result';
      });

      expect(value).toBe('inner-result');
      expect(storage.getStore()).toEqual(outer);
    });

    expect(storage.getStore()).toBeUndefined();
  });

  it('restores the previous context after a synchronous throw', () => {
    const storage = new FallbackContextStorage<ActorContext>();
    const outer = createContext('outer-actor');
    const inner = createContext('inner-actor');

    storage.run(outer, () => {
      expect(() =>
        storage.run(inner, () => {
          expect(storage.getStore()).toEqual(inner);
          throw new Error('boom');
        })
      ).toThrow('boom');

      expect(storage.getStore()).toEqual(outer);
    });

    expect(storage.getStore()).toBeUndefined();
  });

  it('restores the previous active context after a nested async run settles', async () => {
    const storage = new FallbackContextStorage<ActorContext>();
    const outer = createContext('outer-actor');
    const inner = createContext('inner-actor');
    let releaseInner!: () => void;
    const innerGate = new Promise<void>((resolve) => {
      releaseInner = resolve;
    });

    const pending = storage.run(outer, async () => {
      const innerPending = storage.run(inner, async () => {
        await innerGate;
        expect(storage.getStore()).toEqual(inner);
      });

      expect(storage.getStore()).toEqual(inner);
      releaseInner();
      await innerPending;
      expect(storage.getStore()).toEqual(outer);
    });

    await pending;
    expect(storage.getStore()).toBeUndefined();
  });

  it('releases a throwing frame even when a nested async frame is still active', async () => {
    const storage = new FallbackContextStorage<ActorContext>();
    const outer = createContext('outer-actor');
    const inner = createContext('inner-actor');
    let releaseInner!: () => void;
    let innerPending!: Promise<void>;
    const innerGate = new Promise<void>((resolve) => {
      releaseInner = resolve;
    });

    expect(() =>
      storage.run(outer, () => {
        innerPending = storage.run(inner, async () => {
          await innerGate;
          expect(storage.getStore()).toEqual(inner);
        });

        expect(storage.getStore()).toEqual(inner);
        throw new Error('outer-boom');
      })
    ).toThrow('outer-boom');

    expect(storage.getStore()).toEqual(inner);
    releaseInner();
    await innerPending;
    expect(storage.getStore()).toBeUndefined();
  });

  it('rejects overlapping top-level async runs and preserves the original context', async () => {
    const storage = new FallbackContextStorage<ActorContext>();
    const first = createContext('first-actor');
    const second = createContext('second-actor');
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstPending = storage.run(first, async () => {
      await firstGate;
      expect(storage.getStore()).toEqual(first);
    });

    expect(() =>
      storage.run(second, async () => {
        throw new Error('should-not-run');
      })
    ).toThrow(
      'FallbackContextStorage cannot start overlapping top-level async runs without AsyncLocalStorage'
    );

    releaseFirst();
    await firstPending;

    expect(storage.getStore()).toBeUndefined();
  });
});
