// @vitest-environment node
import { createActorSystem } from '@actor-web/runtime/browser';
import { expect, test } from 'vitest';
import {
  type ExecuteCheck,
  type LookupReceipt,
  matchesCandidateBytes,
  pinCandidate,
  type ReceiptLookupReply,
  reviewHandoff,
} from './check-protocol.js';
import { expectOk } from './definitions.js';
import { checkout } from './scenario.js';
import { type CheckBinding, type TaskCheckReply, taskCheckBehavior } from './task-check.js';

const trace = { teamId: 'checkout-team', testSessionId: 'checkout-test-1' };
const utf8 = new TextEncoder();
async function checkoutBinding(): Promise<CheckBinding> {
  return {
    ...(await pinCandidate('checkout-workspace', utf8.encode(checkout.expectedLabel))),
    taskId: checkout.id,
    taskRevision: checkout.revision,
    attemptId: 'attempt-1',
    checkId: 'expected-label',
    executorId: 'local',
    executorGeneration: 1,
  };
}

test('a workspace-scoped artifact key pins exact bytes, not a path or normalized label', async () => {
  const bytes = utf8.encode('abc');
  const ref = await pinCandidate('workspace-a', bytes);
  expect(ref).toEqual({
    workspaceId: 'workspace-a',
    candidateDigest: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  });
  expect(await pinCandidate('workspace-b', bytes)).toEqual({ ...ref, workspaceId: 'workspace-b' });
  expect(await matchesCandidateBytes(ref, bytes)).toBe(true);
  expect(await matchesCandidateBytes(ref, utf8.encode('abc\n'))).toBe(false);
});

test('dispatch, lookup, stored receipt and unavailable reply round-trip as distinct JSON messages', async () => {
  const binding = await checkoutBinding();
  const execute: ExecuteCheck = {
    type: 'EXECUTE_CHECK',
    binding,
    trace,
    expectedLabel: checkout.expectedLabel,
  };
  const lookup: LookupReceipt = { type: 'LOOKUP_RECEIPT', binding, trace };
  const found: ReceiptLookupReply = { type: 'HOST_RECEIPT', receipt: { ...binding, passed: true } };
  const missing: ReceiptLookupReply = { type: 'RECEIPT_UNAVAILABLE', binding };
  for (const message of [execute, lookup, found, missing]) {
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
  }
  expect(lookup).not.toHaveProperty('expectedLabel');
  expect(missing).not.toHaveProperty('receipt');
});

test('only an accepted task decision yields a Review handoff, not a timeout or duplicate receipt', async () => {
  const binding = await checkoutBinding();
  const system = createActorSystem({ nodeAddress: 'protocol-test' });
  await system.start();
  try {
    const task = await system.spawn(taskCheckBehavior(binding));
    const decide = (message: Parameters<typeof task.ask>[0]) => task.ask<TaskCheckReply>(message);
    const refused = { ok: false, reason: 'REVIEW_NOT_READY' };
    expect(reviewHandoff(await decide({ type: 'DISPATCH_CHECK' }), trace)).toEqual(refused);
    expect(
      reviewHandoff(await decide({ type: 'RECEIPT_TIMEOUT', attemptId: binding.attemptId }), trace)
    ).toEqual(refused);
    const found: ReceiptLookupReply = {
      type: 'HOST_RECEIPT',
      receipt: { ...binding, passed: true },
    };
    const accepted = await decide(JSON.parse(JSON.stringify(found)));
    const handoff = expectOk(reviewHandoff(accepted, trace));
    expect(JSON.parse(JSON.stringify(handoff))).toEqual({
      type: 'START_REVIEW',
      binding,
      trace,
      handoffId: handoff.handoffId,
    });
    expect(expectOk(reviewHandoff(structuredClone(accepted), { ...trace }))).toEqual(handoff);
    expect(reviewHandoff(await decide(found), trace)).toEqual(refused);

    const other = await system.spawn(taskCheckBehavior(binding));
    await other.ask({ type: 'DISPATCH_CHECK' });
    const failed = await other.ask<TaskCheckReply>({
      type: 'HOST_RECEIPT',
      receipt: { ...binding, passed: false },
    });
    expect(reviewHandoff(failed, trace)).toEqual(refused);
  } finally {
    await system.stop();
  }
});

test('Review identity follows the destination team and pinned attempt, not a delivery or trace session', async () => {
  const binding = await checkoutBinding();
  const id = (context = binding, origin = trace) =>
    expectOk(reviewHandoff({ value: 'reviewReady', context }, origin)).handoffId;
  const first = id();
  expect(id(binding, { ...trace, testSessionId: 'another-correlation' })).toBe(first);
  expect(id(binding, { ...trace, teamId: 'another-team' })).not.toBe(first);
  for (const change of [
    { taskId: 'profile' },
    { taskRevision: 4 },
    { workspaceId: 'workspace-b' },
    { attemptId: 'attempt-2' },
    { checkId: 'other-check' },
    { executorId: 'cloud' },
    { executorGeneration: 2 },
    { candidateDigest: `sha256:${'b'.repeat(64)}` },
  ]) {
    expect(id({ ...binding, ...change })).not.toBe(first);
  }
});
