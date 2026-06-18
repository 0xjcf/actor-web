import { describe, expect, it, vi } from 'vitest';
import { safeDispatchListener } from '../transport/transport-channel.js';

// safeDispatchListener is the permanent PR#27-class fix (architecture §3). It isolates
// every listener so neither a synchronous throw nor a rejected promise escapes or blocks
// sibling listeners. Pure: its only effect is the injected onError callback.

describe('safeDispatchListener', () => {
  it('passes the event through and never re-throws on success', () => {
    const received: number[] = [];
    const onError = vi.fn();

    expect(() =>
      safeDispatchListener((event: number) => received.push(event), 42, onError)
    ).not.toThrow();

    expect(received).toEqual([42]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('contains a synchronous throw and routes it to onError', () => {
    const error = new Error('boom');
    const onError = vi.fn();

    expect(() =>
      safeDispatchListener(
        () => {
          throw error;
        },
        'event',
        onError
      )
    ).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('does not block sibling listeners when one throws synchronously', () => {
    const received: string[] = [];
    const onError = vi.fn();
    const listeners = [
      () => {
        throw new Error('first fails');
      },
      (event: string) => {
        received.push(event);
      },
    ];

    for (const listener of listeners) {
      safeDispatchListener(listener, 'hello', onError);
    }

    expect(received).toEqual(['hello']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('contains an async rejection and routes it to onError (PR#27 root cause)', async () => {
    const error = new Error('async boom');
    const onError = vi.fn();

    safeDispatchListener(() => Promise.reject(error), 'event', onError);

    // The rejection is routed asynchronously; flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('ignores a resolved promise result without calling onError', async () => {
    const onError = vi.fn();

    safeDispatchListener(() => Promise.resolve('ok'), 'event', onError);
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });
});
