// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { hostJournal, teamJournal } from './loopback/journal.js';
import { startCluster } from './loopback/launcher.js';

it('restores both bindings in fresh processes and looks up the held receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdlc-restore-'));
  const team = (lane: 'profile' | 'checkout') => teamJournal(join(root, 'control'), lane).load();
  let cluster: Awaited<ReturnType<typeof startCluster>> | undefined;
  try {
    cluster = await startCluster(undefined, root);
    await cluster.control.call('begin');
    await vi.waitFor(() => expect(team('profile')?.records.at(-1)?.role).toBe('document'));
    await vi.waitFor(() => expect(hostJournal(join(root, 'checkout')).executions()).toBe(1));
    await cluster.control.call('timeout', 'checkout');
    const held = team('checkout');
    const finished = team('profile');
    await cluster.stop();
    cluster = await startCluster(undefined, root);
    await expect(cluster.control.call('begin')).rejects.toThrow('already dispatched');
    await vi.waitFor(() => expect(team('checkout')?.records.at(-1)?.role).toBe('document'));
    expect(team('checkout')).toMatchObject({
      pending: held?.pending,
      decision: 'reviewReady',
      reviewSessions: 1,
      handoff: null,
    });
    expect(team('profile')).toEqual(finished);
    expect(await cluster.checkout.call('stats')).toEqual({ executions: 1 });
    expect(await cluster.profile.call('stats')).toEqual({ executions: 1 });
    // A separate interrupted host has only a claim: lookup is not an execution path.
    if (!held) throw new Error('Missing attempt');
    const binding = held.pending.execute.binding;
    const dir = join(root, 'ambiguous');
    expect(hostJournal(dir).claim(binding)).toBe(true);
    expect(hostJournal(dir).claim(binding)).toBe(false);
    expect(hostJournal(dir).executions()).toBeNull();
    expect(hostJournal(dir).lookup(binding)).toEqual({ type: 'RECEIPT_UNAVAILABLE', binding });
  } finally {
    await cluster?.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
