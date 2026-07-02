import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';
import {
  type BrandedStringParseResult,
  type ChildProcessHandle,
  createChildProcessHandle,
  createNodeProviderLifecycleFailure,
  createProviderLifecycleAcquisitionKey,
  createProviderLifecycleActivationKey,
  createProviderLifecycleDuplicateFact,
  createProviderLifecycleReadinessFact,
  type ProviderLifecycleAcquisitionKey,
  type ProviderLifecycleActivationKey,
} from '../node-provider-lifecycle-contract.js';
import {
  createEmbeddedRuntimeHostCompatibilityFixture,
  embeddedRuntimeHostCompatibilityDisclaimer,
} from '../testing/embedded-runtime-host-compatibility-fixture.js';

function expectValid<TValue extends string>(result: BrandedStringParseResult<TValue>): TValue {
  expect(result.outcome).toBe('valid');
  if (result.outcome !== 'valid') {
    throw new Error(`Expected valid branded value, received ${result.reason}`);
  }
  return result.value;
}

function makeHandle(value: string): ChildProcessHandle {
  return expectValid(createChildProcessHandle(value));
}

function makeActivationKey(value: string): ProviderLifecycleActivationKey {
  return expectValid(createProviderLifecycleActivationKey(value));
}

function makeAcquisitionKey(value: string): ProviderLifecycleAcquisitionKey {
  return expectValid(createProviderLifecycleAcquisitionKey(value));
}

describe('embedded runtime host compatibility fixture', () => {
  it('keeps the fixture node-only with an explicit compatibility disclaimer', async () => {
    const fixturePath = fileURLToPath(
      new URL('../testing/embedded-runtime-host-compatibility-fixture.ts', import.meta.url)
    );
    const fixtureSource = await readFile(fixturePath, 'utf8');
    const runtime = createEmbeddedRuntimeHostCompatibilityFixture();
    const expectedDisclaimer = {
      purpose: 'compatibility proving slice',
      integrationBoundary: 'not a fas-local integration',
      apiBoundary: 'not a public API replacement',
    };

    expect(nodeEntry.createEmbeddedRuntimeHostCompatibilityFixture).toBeTypeOf('function');
    expect(nodeEntry.embeddedRuntimeHostCompatibilityDisclaimer).toEqual(expectedDisclaimer);
    expect('createEmbeddedRuntimeHostCompatibilityFixture' in rootEntry).toBe(false);
    expect('createEmbeddedRuntimeHostCompatibilityFixture' in browserEntry).toBe(false);
    expect('embeddedRuntimeHostCompatibilityDisclaimer' in rootEntry).toBe(false);
    expect('embeddedRuntimeHostCompatibilityDisclaimer' in browserEntry).toBe(false);
    expect(embeddedRuntimeHostCompatibilityDisclaimer).toEqual(expectedDisclaimer);
    expect(runtime.compatibility).toEqual(expectedDisclaimer);
    expect(fixtureSource).not.toMatch(/from\s+['"][^'"]*fas-local/);
    expect(fixtureSource).not.toMatch(/import\s+['"][^'"]*fas-local/);
    expect(path.basename(fixturePath)).toBe('embedded-runtime-host-compatibility-fixture.ts');
  });

  it('drives a fake runtime/session/provider happy path with deterministic fact order', async () => {
    const runtime = createEmbeddedRuntimeHostCompatibilityFixture();
    const created = await runtime.createSession({
      sessionId: 'session:happy',
      openedAt: '2026-07-02T16:40:00.000Z',
    });

    expect(created.outcome).toBe('session_created');

    const acquired = await runtime.providerManager.acquire({
      activationKey: 'activation:happy',
      acquisitionKey: 'acquisition:happy',
    });
    expect(acquired.outcome).toBe('provider_ready');
    expect(acquired.projection.ready).toBe(true);
    expect(acquired.projection.calls).toEqual({
      claimDuplicate: 1,
      spawn: 1,
      signal: 0,
      observeExit: 0,
      tailOutput: 0,
      readiness: 1,
      filesystemProbe: 1,
      modelCacheInspect: 1,
    });

    const events: Array<{ type: string; factType?: string; sequence?: number }> = [];
    const unsubscribe = acquired.provider.subscribe((event) => {
      events.push({
        type: event.type,
        factType: event.type === 'provider_fact' ? event.fact.type : undefined,
        sequence: event.type === 'provider_fact' ? event.fact.sequence : undefined,
      });
    });

    const chat = await created.session.chat({
      provider: acquired.provider,
      turnId: 'turn:happy',
      submittedAt: '2026-07-02T16:40:02.000Z',
      prompt: 'Hello from the embedded runtime host fixture.',
    });
    unsubscribe();

    expect(chat.outcome).toBe('turn_completed');
    expect(chat.provider.ready).toBe(true);
    expect(chat.session.turn).toMatchObject({
      id: 'turn:happy',
      status: 'completed',
      output: 'Hello from the embedded runtime host fixture.',
      sequence: 2,
      checkpoint: 'checkpoint:terminal:completed',
    });
    expect(chat.observedFacts.map((fact) => fact.type)).toEqual([
      'PROVIDER_DELTA',
      'TURN_COMPLETED',
    ]);
    expect(events).toEqual([
      {
        type: 'provider_fact',
        factType: 'PROVIDER_DELTA',
        sequence: 1,
      },
      {
        type: 'provider_fact',
        factType: 'TURN_COMPLETED',
        sequence: 2,
      },
    ]);
    expect(chat.session.lastFact).toMatchObject({
      type: 'TURN_COMPLETED',
      sessionId: 'session:happy',
      providerId: acquired.provider.id,
      turnId: 'turn:happy',
      sequence: 2,
    });
  });

  it('reuses the provider projection for repeated acquire and stop calls without replaying fake effects', async () => {
    const runtime = createEmbeddedRuntimeHostCompatibilityFixture();

    const firstAcquire = await runtime.providerManager.acquire({
      activationKey: 'activation:replay',
      acquisitionKey: 'acquisition:replay',
    });
    const secondAcquire = await runtime.providerManager.acquire({
      activationKey: 'activation:replay',
      acquisitionKey: 'acquisition:replay',
    });
    const inspected = runtime.providerManager.inspect();

    expect(firstAcquire.outcome).toBe('provider_ready');
    expect(secondAcquire.outcome).toBe('provider_ready');
    expect(secondAcquire.projection.calls).toEqual(firstAcquire.projection.calls);
    expect(secondAcquire.projection.journal.size).toBe(5);
    expect(secondAcquire.projection.journal.kinds).toEqual([
      'duplicate_prevention',
      'filesystem_probe',
      'model_cache_inspect',
      'readiness',
      'spawn',
    ]);
    expect(inspected.projection.calls.spawn).toBe(1);
    expect(inspected.projection.calls.readiness).toBe(1);

    const stopped = await runtime.providerManager.stop();
    const stoppedAgain = await runtime.providerManager.stop();

    expect(stopped.outcome).toBe('provider_stopped');
    expect(stopped.projection.calls.signal).toBe(1);
    expect(stopped.projection.calls.observeExit).toBe(1);
    expect(stopped.projection.calls.tailOutput).toBe(1);
    expect(stoppedAgain.outcome).toBe('provider_stopped');
    expect(stoppedAgain.projection.calls).toEqual(stopped.projection.calls);
  });

  it('returns probe, cache, readiness, duplicate, and turn mismatch failures as data', async () => {
    const probeRuntime = createEmbeddedRuntimeHostCompatibilityFixture({
      filesystemProbe: {
        outcome: 'failed',
        failure: createNodeProviderLifecycleFailure({
          code: 'missing_executable',
          message: 'Missing fake executable',
          retryable: false,
        }),
      },
    });
    const probeAcquire = await probeRuntime.providerManager.acquire({
      activationKey: 'activation:probe',
      acquisitionKey: 'acquisition:probe',
    });
    expect(probeAcquire.outcome).toBe('provider_failed');
    expect(probeAcquire.projection.failure?.code).toBe('missing_executable');

    const cacheRuntime = createEmbeddedRuntimeHostCompatibilityFixture({
      modelCacheInspect: {
        outcome: 'failed',
        failure: createNodeProviderLifecycleFailure({
          code: 'invalid_request',
          message: 'Cache metadata unavailable',
          retryable: false,
        }),
      },
    });
    const cacheAcquire = await cacheRuntime.providerManager.acquire({
      activationKey: 'activation:cache',
      acquisitionKey: 'acquisition:cache',
    });
    expect(cacheAcquire.outcome).toBe('provider_failed');
    expect(cacheAcquire.projection.failure?.message).toContain('Cache metadata unavailable');

    const readinessRuntime = createEmbeddedRuntimeHostCompatibilityFixture({
      readiness: ({ attempt, handle, target }) => ({
        outcome: 'failed',
        failure: createNodeProviderLifecycleFailure({
          code: 'readiness_failed',
          message: 'Fake readiness never converged',
          retryable: false,
        }),
        fact: createProviderLifecycleReadinessFact({
          handle,
          attempt,
          strategy: 'http',
          target,
          observedAt: '2026-07-02T16:41:02.000Z',
          detail: 'still starting',
        }),
      }),
    });
    const readinessAcquire = await readinessRuntime.providerManager.acquire({
      activationKey: 'activation:readiness',
      acquisitionKey: 'acquisition:readiness',
    });
    expect(readinessAcquire.outcome).toBe('provider_failed');
    expect(readinessAcquire.projection.failure?.code).toBe('readiness_failed');

    const duplicateHandle = makeHandle('child:duplicate:001');
    const duplicateActivationKey = makeActivationKey('activation:duplicate');
    const duplicateAcquisitionKey = makeAcquisitionKey('acquisition:duplicate');
    const duplicateRuntime = createEmbeddedRuntimeHostCompatibilityFixture({
      duplicateClaim: {
        outcome: 'duplicate',
        duplicate: createProviderLifecycleDuplicateFact({
          activationKey: duplicateActivationKey,
          acquisitionKey: duplicateAcquisitionKey,
          provider: 'mlx_lm.server',
          handle: duplicateHandle,
          detectedAt: '2026-07-02T16:41:03.000Z',
          disposition: 'duplicate',
        }),
      },
    });
    const duplicateAcquire = await duplicateRuntime.providerManager.acquire({
      activationKey: duplicateActivationKey,
      acquisitionKey: duplicateAcquisitionKey,
    });
    expect(duplicateAcquire.outcome).toBe('provider_duplicate');
    expect(duplicateAcquire.projection.failure?.code).toBe('duplicate');

    const mismatchRuntime = createEmbeddedRuntimeHostCompatibilityFixture({
      observedFacts: [
        {
          type: 'PROVIDER_DELTA',
          turnId: 'turn:other',
          sequence: 1,
          delta: 'unexpected',
          checkpoint: 'checkpoint:mismatch:1',
          observedAt: '2026-07-02T16:41:04.000Z',
        },
      ],
    });
    const mismatchSession = await mismatchRuntime.createSession({
      sessionId: 'session:mismatch',
      openedAt: '2026-07-02T16:41:05.000Z',
    });
    const mismatchProvider = await mismatchRuntime.providerManager.acquire({
      activationKey: 'activation:mismatch',
      acquisitionKey: 'acquisition:mismatch',
    });
    const mismatchChat = await mismatchSession.session.chat({
      provider: mismatchProvider.provider,
      turnId: 'turn:expected',
      submittedAt: '2026-07-02T16:41:06.000Z',
      prompt: 'Mismatch fixture prompt.',
    });

    expect(mismatchChat.outcome).toBe('turn_rejected');
    expect(mismatchChat.session.failure?.code).toBe('invalid_transition');
  });

  it('emits immutable provider stream events in deterministic order', async () => {
    const runtime = createEmbeddedRuntimeHostCompatibilityFixture();
    const created = await runtime.createSession({
      sessionId: 'session:stream',
      openedAt: '2026-07-02T16:42:00.000Z',
    });
    const acquired = await runtime.providerManager.acquire({
      activationKey: 'activation:stream',
      acquisitionKey: 'acquisition:stream',
    });

    const seen: Array<{ factType: string; sequence: number; output?: string }> = [];
    acquired.provider.subscribe((event) => {
      if (event.type !== 'provider_fact') {
        return;
      }
      seen.push({
        factType: event.fact.type,
        sequence: event.fact.sequence,
        output: event.session.turn?.output,
      });

      if (event.fact.type === 'PROVIDER_DELTA' && event.session.turn) {
        (event as { session: { turn: { output: string } } }).session.turn.output = 'mutated';
      }
    });

    const chat = await created.session.chat({
      provider: acquired.provider,
      turnId: 'turn:stream',
      submittedAt: '2026-07-02T16:42:02.000Z',
      prompt: 'stream prompt',
    });

    expect(seen).toEqual([
      {
        factType: 'PROVIDER_DELTA',
        sequence: 1,
        output: 'Hello',
      },
      {
        factType: 'TURN_COMPLETED',
        sequence: 2,
        output: 'Hello from the embedded runtime host fixture.',
      },
    ]);
    expect(acquired.provider.snapshot().ready).toBe(true);
    expect(chat.session.turn?.output).toBe('Hello from the embedded runtime host fixture.');
  });

  it('allows provider subscriptions after close and restart', async () => {
    const runtime = createEmbeddedRuntimeHostCompatibilityFixture();
    const initial = await runtime.providerManager.acquire({
      activationKey: 'activation:close-before-restart',
      acquisitionKey: 'acquisition:close-before-restart',
    });
    let staleEvents = 0;
    initial.provider.subscribe(() => {
      staleEvents += 1;
    });
    initial.provider.close();

    const restarted = await runtime.providerManager.restart({
      activationKey: 'activation:after-close',
      acquisitionKey: 'acquisition:after-close',
    });
    expect(restarted.outcome).toBe('provider_ready');

    const emitted: Array<{ factType: string; sequence: number }> = [];
    restarted.provider.subscribe((event) => {
      if (event.type === 'provider_fact') {
        emitted.push({
          factType: event.fact.type,
          sequence: event.fact.sequence,
        });
      }
    });

    const created = await runtime.createSession({
      sessionId: 'session:after-close',
      openedAt: '2026-07-02T16:43:00.000Z',
    });
    const chat = await created.session.chat({
      provider: restarted.provider,
      turnId: 'turn:after-close',
      submittedAt: '2026-07-02T16:43:02.000Z',
      prompt: 'chat after provider wrapper close and restart',
    });

    expect(staleEvents).toBe(0);
    expect(chat.outcome).toBe('turn_completed');
    expect(emitted).toEqual([
      {
        factType: 'PROVIDER_DELTA',
        sequence: 1,
      },
      {
        factType: 'TURN_COMPLETED',
        sequence: 2,
      },
    ]);
  });
});
