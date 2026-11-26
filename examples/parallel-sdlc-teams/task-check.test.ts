// @vitest-environment node
import { createActorReadModelSource, createActorSystem } from '@actor-web/runtime/browser';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { checkout, profile } from './scenario.js';
import { type CheckBinding, taskCheckBehavior } from './task-check.js';

const local: CheckBinding = {
  taskId: checkout.id,
  taskRevision: checkout.revision,
  workspaceId: 'checkout-workspace',
  attemptId: 'checkout-test-1',
  checkId: 'expected-label',
  executorId: 'local',
  executorGeneration: 2,
  candidateDigest: `sha256:${'a'.repeat(64)}`,
};
const cloud: CheckBinding = {
  ...local,
  taskId: profile.id,
  taskRevision: profile.revision,
  workspaceId: 'profile-workspace',
  attemptId: 'profile-test-1',
  executorId: 'cloud',
  candidateDigest: `sha256:${'b'.repeat(64)}`,
};
const dispatch = { type: 'DISPATCH_CHECK' };
const timeout = (attemptId: string) => ({ type: 'RECEIPT_TIMEOUT', attemptId });
const receipt = (binding: CheckBinding, passed: boolean) => ({
  type: 'HOST_RECEIPT',
  receipt: { ...binding, passed },
});
const refusedIn = (state: string) => ({ ok: false, error: { code: 'INVALID_TRANSITION', state } });

let system: ReturnType<typeof createActorSystem>;
beforeEach(async () => {
  system = createActorSystem({ nodeAddress: 'offline' });
  await system.start();
});
afterEach(async () => {
  await system.stop();
});

test('a late read-only subscriber immediately sees the held attempt without commands or sessions', async () => {
  const task = await system.spawn(taskCheckBehavior(local));
  await task.ask(dispatch);
  expect(await task.ask(timeout(local.attemptId))).toMatchObject({ value: 'unknown' });

  const send = vi.spyOn(task, 'send');
  const ask = vi.spyOn(task, 'ask');
  const spawn = vi.spyOn(system, 'spawn');
  const open = () => createActorReadModelSource(task);
  const first = open();
  expect(first.snapshot()).toMatchObject({ phase: 'unknown', context: local });
  const phases: string[] = [];
  const unsubscribe = first.subscribe(({ phase }) => phases.push(phase));
  expect(phases).toEqual(['unknown']);
  unsubscribe();

  const reopened = open();
  expect('ask' in reopened || 'send' in reopened).toBe(false);
  const live: string[] = [];
  const detach = reopened.subscribe(({ phase }) => live.push(phase));
  try {
    expect(live).toEqual(['unknown']);
    expect(ask).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(await task.ask(receipt(local, true))).toMatchObject({ value: 'reviewReady' });
    expect(reopened.snapshot()).toMatchObject({ phase: 'reviewReady', context: local });
    expect(live.at(-1)).toBe('reviewReady');
    expect(phases).toEqual(['unknown']);
  } finally {
    detach();
  }
});

test.each([
  { passed: true, late: false, state: 'reviewReady' },
  { passed: false, late: false, state: 'checkFailed' },
  { passed: true, late: true, state: 'reviewReady' },
  { passed: false, late: true, state: 'checkFailed' },
])('passed=$passed, late=$late settles once as $state', async ({ passed, late, state }) => {
  const task = await system.spawn(taskCheckBehavior(local));
  expect(await task.ask(receipt(local, passed))).toMatchObject(refusedIn('ready'));
  expect(await task.ask(dispatch)).toMatchObject({ value: 'awaitingReceipt' });
  expect(await task.ask(timeout('another-attempt'))).toMatchObject(refusedIn('awaitingReceipt'));
  if (late) {
    expect(await task.ask(timeout(local.attemptId))).toMatchObject({ value: 'unknown' });
    expect(await task.ask(dispatch)).toMatchObject(refusedIn('unknown'));
  }
  expect(await task.ask(receipt(local, passed))).toMatchObject({ value: state });
  for (const event of [
    receipt(local, passed),
    receipt(local, !passed),
    timeout(local.attemptId),
    dispatch,
  ]) {
    expect(await task.ask(event)).toMatchObject(refusedIn(state));
  }
});

test('a held task rejects stale or malformed evidence without blocking the other lane', async () => {
  const input = { ...local };
  const a = await system.spawn(taskCheckBehavior(input));
  const b = await system.spawn(taskCheckBehavior(cloud));
  input.executorGeneration++; // Mutating allocation input cannot rebind an existing actor.
  await Promise.all([a.ask(dispatch), b.ask(dispatch)]);
  expect(await a.ask(timeout(local.attemptId))).toMatchObject({ value: 'unknown' });
  expect(await b.ask(receipt(local, true))).toMatchObject(refusedIn('awaitingReceipt'));
  expect(await b.ask(receipt(cloud, true))).toMatchObject({ value: 'reviewReady' });
  for (const mismatch of [
    { workspaceId: cloud.workspaceId },
    { taskId: cloud.taskId },
    { taskRevision: local.taskRevision + 1 },
    { attemptId: cloud.attemptId },
    { checkId: 'other-check' },
    { executorId: cloud.executorId },
    { executorGeneration: local.executorGeneration - 1 },
    { candidateDigest: cloud.candidateDigest },
  ]) {
    expect(await a.ask(receipt({ ...local, ...mismatch }, true))).toMatchObject(
      refusedIn('unknown')
    );
  }
  for (const event of [
    { type: 'HOST_RECEIPT' },
    { type: 'HOST_RECEIPT', receipt: { ...local, passed: 'true' } },
    { type: 'GUEST_FINISHED', passed: true },
    { type: 'PEER_CONNECTED' },
    { type: 'STAGE_COMPLETED' },
  ]) {
    expect(await a.ask(event)).toMatchObject(refusedIn('unknown'));
  }
  expect(await a.ask(receipt(local, true))).toMatchObject({ value: 'reviewReady' });
});
