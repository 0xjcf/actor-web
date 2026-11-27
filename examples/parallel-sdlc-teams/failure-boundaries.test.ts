// @vitest-environment node
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeGatewayServerFrame } from '@actor-web/runtime';
import { serveNode } from '@actor-web/runtime/node';
import { expect, it, onTestFinished, vi } from 'vitest';
import WebSocket from 'ws';
import { hostJournal, teamJournal } from './loopback/journal.js';
import { credential, credentials, launch } from './loopback/launcher.js';
import { address, type ControlConfig, peerAuth, type WorkerConfig } from './loopback/peer.js';
import { observeLane } from './loopback/reader.js';
import { type Lane, targets, topology } from './loopback/topology.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sdlc-boundary-'));
  const token = credential();
  const peers = credentials();
  const viewers = credentials();
  const children: Awaited<ReturnType<typeof launch>>[] = [];
  onTestFinished(async () => {
    await Promise.all(children.map((child) => child.stop()));
    await rm(root, { recursive: true, force: true });
  });
  async function start(config: WorkerConfig | ControlConfig) {
    const child = await launch(config);
    children.push(child);
    return child;
  }
  return {
    token,
    peers,
    viewers,
    team: (lane: Lane) => teamJournal(join(root, 'control'), lane).load(),
    host: (lane: Lane) => hostJournal(join(root, lane)),
    control: (options?: Pick<ControlConfig, 'ports' | 'deferReview'>) =>
      start({
        role: 'control',
        directory: join(root, 'control'),
        token,
        peers,
        viewers,
        ...options,
      }),
    worker: (role: Lane, controlUrl: string, deferReceipt = false) =>
      start({
        role,
        controlUrl,
        controlToken: token,
        token: peers[role],
        directory: join(root, role),
        deferReceipt,
      }),
  };
}
const until = (check: () => void | Promise<void>) => vi.waitFor(check, { timeout: 5000 });

it('recovers the accepted outbox after a worker disconnect and a control crash before Review', async () => {
  const run = await fixture();
  const control = await run.control({ deferReview: 'checkout' });
  const { gatewayUrl, transportUrl } = control.ready;
  const first = await run.worker('checkout', transportUrl);
  const other = await run.worker('profile', transportUrl);
  await control.call('begin');
  const binding = run.team('checkout')?.pending.execute.binding;
  if (!binding) throw new Error('Missing pinned binding');
  await until(() => expect(run.host('checkout').lookup(binding).type).toBe('HOST_RECEIPT'));
  await first.crash();
  await until(async () =>
    expect(await control.call('health')).toMatchObject({ peers: [address('profile')] })
  );
  await until(() => expect(run.team('checkout')?.decision).toBe('unknown'));
  await until(() => expect(run.team('profile')?.records.at(-1)?.role).toBe('document'));
  const profile = run.team('profile');
  const reader = observeLane(gatewayUrl, run.viewers.checkout, 'checkout');
  try {
    await until(() =>
      expect(reader.snapshot().context).toMatchObject({
        binding,
        ownerPhase: 'unknown',
        reviewSessions: 0,
      })
    );
    const host = await run.worker('checkout', transportUrl);
    expect(host.ready.pid).not.toBe(first.ready.pid);
    await control.call('lookup', 'checkout');
    await until(() =>
      expect(run.team('checkout')).toMatchObject({
        decision: 'reviewReady',
        handoff: { type: 'START_REVIEW' },
        claimed: null,
        reviewSessions: 0,
      })
    );
    const handoff = run.team('checkout')?.handoff;
    await control.crash();
    const restored = await run.control({
      ports: {
        gateway: Number(new URL(gatewayUrl).port),
        transport: Number(new URL(transportUrl).port),
      },
    });
    expect(restored.ready.pid).not.toBe(control.ready.pid);
    await Promise.all([host.call('reconnect'), other.call('reconnect')]);
    await restored.call('recover');
    await restored.call('recover');
    expect(run.team('checkout')).toMatchObject({
      claimed: handoff?.handoffId,
      reviewSessions: 1,
      handoff: null,
    });
    expect(run.team('checkout')?.records.map((record) => record.role)).toEqual([
      'plan',
      'build',
      'test',
      'review',
      'document',
    ]);
    const completed = run.team('checkout');
    const late = observeLane(gatewayUrl, run.viewers.checkout, 'checkout');
    try {
      await until(() =>
        expect(late.snapshot().context).toMatchObject({
          binding,
          reviewSessions: 1,
          documented: true,
        })
      );
    } finally {
      late.close();
    }
    expect(run.team('checkout')).toEqual(completed);
    expect(run.team('profile')).toEqual(profile);
    for (const lane of ['checkout', 'profile'] as const)
      expect(run.host(lane).executions()).toBe(1);
  } finally {
    reader.close();
  }
}, 60000);

async function checkGatewayScope(url: string, viewer: string) {
  const socket = new WebSocket(url);
  const frames: RuntimeGatewayServerFrame[] = [];
  socket.on('message', (bytes) => frames.push(JSON.parse(bytes.toString())));
  const send = (frame: object) => socket.send(JSON.stringify(frame));
  try {
    await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
    send({ type: 'hello', auth: { scheme: 'token', token: viewer } });
    await until(() => expect(frames).toContainEqual(expect.objectContaining({ type: 'ready' })));
    for (const lane of ['profile', 'checkout'] as const) {
      send({
        type: 'subscribe',
        streamId: lane,
        scope: { kind: 'progress', params: { workspace: targets[lane].workspaceId } },
      });
    }
    await until(() => {
      expect(frames).toContainEqual(
        expect.objectContaining({ type: 'error', streamId: 'profile', code: 'invalid_scope' })
      );
      expect(frames).toContainEqual(
        expect.objectContaining({ type: 'snapshot', streamId: 'checkout' })
      );
    });
    send({
      type: 'send',
      streamId: 'checkout',
      requestId: 'cmd',
      message: { type: 'DISPATCH_CHECK' },
    });
    await until(() =>
      expect(frames).toContainEqual(
        expect.objectContaining({ type: 'error', requestId: 'cmd', code: 'forbidden' })
      )
    );
    expect(frames.some((f) => f.type === 'snapshot' && f.streamId === 'profile')).toBe(false);
  } finally {
    socket.close();
  }
}

it('holds an executed check with no receipt and rejects cross-workspace evidence and access', async () => {
  const run = await fixture();
  const control = await run.control();
  const { gatewayUrl, transportUrl } = control.ready;
  const worker = await run.worker('checkout', transportUrl, true);
  const profile = await run.worker('profile', transportUrl);
  await control.call('begin');
  await until(() => expect(run.host('checkout').executions()).toBe(1));
  await worker.crash();
  await until(() => expect(run.team('profile')?.records.at(-1)?.role).toBe('document'));
  const completed = run.team('profile');
  await run.worker('checkout', transportUrl);
  await control.call('lookup', 'checkout');
  await until(async () =>
    expect(await control.call('health')).toMatchObject({ unavailable: { checkout: 1 } })
  );
  await until(() => expect(run.team('checkout')?.decision).toBe('unknown'));
  const held = run.team('checkout');
  if (!held) throw new Error('Missing held checkout');
  const binding = held.pending.execute.binding;
  expect(run.host('checkout').lookup(binding).type).toBe('RECEIPT_UNAVAILABLE');
  await checkGatewayScope(gatewayUrl, run.viewers.checkout);

  // A legitimate Profile peer returns a syntactically matching Checkout result.
  // The admission decision must use the connection, not even a perfect payload.
  await profile.stop();
  const peer = await serveNode(topology, {
    node: 'profile',
    peers: { control: transportUrl },
    transport: { auth: peerAuth(run.peers.profile, new Map([[address('control'), run.token]])) },
  });
  try {
    const event = { type: 'HOST_RECEIPT', receipt: { ...binding, passed: true } };
    await peer.transport.send(address('control'), event);
    await until(async () =>
      expect(await control.call('health')).toMatchObject({ refusedBindings: 1 })
    );
  } finally {
    await peer.stop();
  }
  expect(run.team('checkout')).toEqual(held);
  expect(held).toMatchObject({ claimed: null, handoff: null, reviewSessions: 0 });
  expect(run.team('profile')).toEqual(completed);
  for (const lane of ['checkout', 'profile'] as const) expect(run.host(lane).executions()).toBe(1);
}, 60000);
