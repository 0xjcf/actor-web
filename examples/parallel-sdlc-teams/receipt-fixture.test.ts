// @vitest-environment node
import { createActorSystem } from '@actor-web/runtime/browser';
import { expect, test } from 'vitest';
import { type ExecuteCheck, type LookupReceipt, pinCandidate } from './check-protocol.js';
import { expectOk } from './definitions.js';
import { startMemoryExecutor } from './memory-executor.js';
import { startHeldReceiptFixture } from './receipt-fixture.js';

test.each([false, true])(
  'late dashboard: Profile documents while Checkout receipt is held (wrong label: %s)',
  async (wrongLabel) => {
    const fixture = await startHeldReceiptFixture(wrongLabel);
    try {
      const view = fixture.openDashboard();
      expect(Object.keys(view)).toEqual(['snapshot']);
      const held = view.snapshot();
      expect(held).toMatchObject({
        checkout: {
          binding: { taskId: 'checkout', taskRevision: 3, executorId: 'local' },
          ownerPhase: 'unknown',
          executions: 1,
          reviewSessions: 0,
          documented: false,
        },
        profile: {
          binding: { taskId: 'profile', taskRevision: 1, executorId: 'cloud' },
          ownerPhase: 'reviewReady',
          executions: 1,
          reviewSessions: 1,
          documented: true,
        },
      });
      expect(held.checkout.binding.attemptId).not.toBe(held.profile.binding.attemptId);
      expect(fixture.openDashboard().snapshot()).toEqual(held);

      const foreign = await fixture.lookupProfile();
      if (foreign.type !== 'HOST_RECEIPT') throw new Error('Profile receipt missing');
      expect(foreign.receipt).toEqual({ ...held.profile.binding, passed: true });
      const stale = {
        ...held.checkout.binding,
        executorGeneration: held.checkout.binding.executorGeneration - 1,
        passed: true,
      };
      for (const event of [foreign, { type: 'HOST_RECEIPT', receipt: stale }] as const) {
        expect(await fixture.deliverCheckout(event)).toEqual({
          ok: false,
          reason: 'INVALID_TRANSITION',
        });
        expect(view.snapshot()).toEqual(held);
      }
      const original = await fixture.lookupCheckout();
      if (original.type !== 'HOST_RECEIPT') throw new Error('Checkout receipt missing');
      expect(original.receipt).toEqual({ ...held.checkout.binding, passed: !wrongLabel });
      expect(view.snapshot()).toEqual(held);
      const delivered = await fixture.deliverCheckout(original);
      if (wrongLabel) expect(delivered).toEqual({ ok: false, reason: 'CHECK_FAILED' });
      else expect(expectOk(delivered)).toMatchObject({ phase: 'documented' });
      const final = view.snapshot();
      expect(final.checkout).toEqual({
        ...held.checkout,
        ownerPhase: wrongLabel ? 'checkFailed' : 'reviewReady',
        reviewSessions: wrongLabel ? 0 : 1,
        documented: !wrongLabel,
      });
      expect(final.profile).toEqual(held.profile);
      expect(await fixture.deliverCheckout(original)).toEqual({
        ok: false,
        reason: 'NO_PENDING_CHECK',
      });
      expect(fixture.openDashboard().snapshot()).toEqual(final);
    } finally {
      await fixture.stop();
    }
  }
);

test('executor lookup is read-only; only the exact admitted bytes and target execute, once', async () => {
  const system = createActorSystem({ nodeAddress: 'memory-executor-test' });
  await system.start();
  try {
    const bytes = new TextEncoder().encode('Pay now');
    const binding = {
      ...(await pinCandidate('workspace', bytes)),
      taskId: 'checkout',
      taskRevision: 3,
      attemptId: 'attempt',
      checkId: 'expected-label',
      executorId: 'local',
      executorGeneration: 2,
    };
    const trace = { teamId: 'team', testSessionId: 'test' };
    const execute: ExecuteCheck = {
      type: 'EXECUTE_CHECK',
      binding,
      trace,
      expectedLabel: 'Pay now',
    };
    const lookup: LookupReceipt = { type: 'LOOKUP_RECEIPT', binding, trace };
    const host = await startMemoryExecutor(system, binding, execute.expectedLabel, bytes);
    bytes[0] = 0; // cannot mutate the executor's admitted copy
    expect(await host.lookup(lookup)).toEqual({ type: 'RECEIPT_UNAVAILABLE', binding });
    expect(await host.execute({ ...execute, expectedLabel: 'forged' })).toMatchObject({
      ok: false,
    });
    for (const change of [
      { attemptId: 'other' },
      { workspaceId: 'foreign' },
      { executorGeneration: 1 },
      { candidateDigest: 'different' },
    ]) {
      expect(await host.execute({ ...execute, binding: { ...binding, ...change } })).toMatchObject({
        ok: false,
      });
    }
    expect(host.executions()).toBe(0);
    const [first, repeat] = await Promise.all([
      host.execute(execute),
      host.execute({ ...execute, trace: { ...trace, testSessionId: 'redelivery' } }),
    ]);
    expect(expectOk(first).receipt).toEqual({ ...binding, passed: true });
    expect(repeat).toEqual(first);
    expectOk(first).receipt.passed = false;
    expect(await host.lookup(lookup)).toEqual({
      type: 'HOST_RECEIPT',
      receipt: { ...binding, passed: true },
    });
    const foreign = { ...binding, taskRevision: 9 };
    expect(await host.lookup({ ...lookup, binding: foreign })).toEqual({
      type: 'RECEIPT_UNAVAILABLE',
      binding: foreign,
    });
    expect(host.executions()).toBe(1);

    const next = { ...binding, attemptId: 'mismatched-bytes' };
    const broken = await startMemoryExecutor(system, next, execute.expectedLabel, bytes);
    expect(await broken.execute({ ...execute, binding: next })).toEqual({
      ok: false,
      reason: 'CANDIDATE_DIGEST_MISMATCH',
    });
    expect(await broken.lookup({ ...lookup, binding: next })).toEqual({
      type: 'RECEIPT_UNAVAILABLE',
      binding: next,
    });
    expect(broken.executions()).toBe(0);
  } finally {
    await system.stop();
  }
});
