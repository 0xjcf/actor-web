// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { startCluster } from './loopback/launcher.js';
import { observeLane } from './loopback/reader.js';

it('holds one checked lane while its peer documents, then reconciles over loopback', async () => {
  const cluster = await startCluster();
  const { control, checkout, profile, viewers } = cluster;
  try {
    expect(new Set([control, checkout, profile].map((p) => p.ready.pid)).size).toBe(3);
    await control.call('begin');
    await vi.waitFor(async () => expect(await checkout.call('stats')).toEqual({ executions: 1 }));
    await control.call('timeout', 'checkout');
    const read = (lane: 'checkout' | 'profile') =>
      observeLane(control.ready.gatewayUrl, viewers[lane], lane);
    const a = read('checkout');
    const b = read('profile');
    try {
      await vi.waitFor(
        () => {
          expect(a.snapshot().context).toMatchObject({
            ownerPhase: 'unknown',
            reviewSessions: 0,
            documented: false,
          });
          expect(b.snapshot().context).toMatchObject({
            ownerPhase: 'reviewReady',
            reviewSessions: 1,
            documented: true,
          });
        },
        { timeout: 5000 }
      );
      await control.call('lookup', 'checkout');
      await vi.waitFor(() =>
        expect(a.snapshot().context).toMatchObject({ reviewSessions: 1, documented: true })
      );
      expect(await checkout.call('stats')).toEqual({ executions: 1 });
      expect(await profile.call('stats')).toEqual({ executions: 1 });
    } finally {
      a.close();
      b.close();
    }
  } finally {
    await cluster.stop();
  }
}, 60000);
