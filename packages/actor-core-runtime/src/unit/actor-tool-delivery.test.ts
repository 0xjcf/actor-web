import { describe, expect, it } from 'vitest';
import {
  type ActorToolDeliveryActivationId,
  type ActorToolDeliveryIdempotencyKey,
  type ActorToolDeliveryParseResult,
  createActorToolDeliveryAck,
  createActorToolDeliveryActivationId,
  createActorToolDeliveryAttempt,
  createActorToolDeliveryIdempotencyKey,
  createInMemoryActorToolDeliveryIdempotencyProvider,
  evaluateActorToolDeliveryAckTimeout,
} from '../actor-tool-delivery.js';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';

function expectValid<TValue extends string>(result: ActorToolDeliveryParseResult<TValue>): TValue {
  expect(result.outcome).toBe('valid');
  if (result.outcome !== 'valid') {
    throw new Error(`Expected valid actor tool delivery value, received ${result.reason}`);
  }
  return result.value;
}

function createKey(requestId = 'task-1001'): ActorToolDeliveryIdempotencyKey {
  return expectValid(
    createActorToolDeliveryIdempotencyKey({
      actorId: 'actor://worker/implementer',
      nodeAddress: 'worker',
      toolName: 'git.write-file',
      requestId,
    })
  );
}

function createActivation(idempotencyKey = createKey()): ActorToolDeliveryActivationId {
  return expectValid(
    createActorToolDeliveryActivationId({
      actorId: 'actor://worker/implementer',
      nodeAddress: 'worker',
      toolName: 'git.write-file',
      idempotencyKey,
    })
  );
}

describe('actor tool delivery semantics', () => {
  it('creates stable idempotency keys and activation ids from explicit caller facts', () => {
    const idempotencyKey = createKey();
    const activationId = createActivation(idempotencyKey);

    expect(
      createActorToolDeliveryIdempotencyKey({
        actorId: 'actor://worker/implementer',
        nodeAddress: 'worker',
        toolName: 'git.write-file',
        requestId: 'task-1001',
      })
    ).toEqual({
      outcome: 'valid',
      value: idempotencyKey,
    });
    expect(
      createActorToolDeliveryActivationId({
        actorId: 'actor://worker/implementer',
        nodeAddress: 'worker',
        toolName: 'git.write-file',
        idempotencyKey,
      })
    ).toEqual({
      outcome: 'valid',
      value: activationId,
    });
    expect(String(activationId)).toContain(String(idempotencyKey));
    expect(
      createActorToolDeliveryIdempotencyKey({
        actorId: '',
        nodeAddress: 'worker',
        toolName: 'git.write-file',
        requestId: 'task-1001',
      })
    ).toEqual({
      outcome: 'invalid',
      reason: 'expected_non_empty_string',
      field: 'actorId',
      value: '',
    });
    expect(
      createActorToolDeliveryActivationId({
        actorId: 'actor://worker/implementer',
        nodeAddress: 'worker',
        toolName: 'git.write-file',
        idempotencyKey: '' as ActorToolDeliveryIdempotencyKey,
      })
    ).toEqual({
      outcome: 'invalid',
      reason: 'expected_non_empty_string',
      field: 'idempotencyKey',
      value: '',
    });
  });

  it('plans ack timeout re-emits without changing activation identity', () => {
    const idempotencyKey = createKey();
    const activationId = createActivation(idempotencyKey);
    const attempt = createActorToolDeliveryAttempt({
      activationId,
      idempotencyKey,
      toolName: 'git.write-file',
      attempt: 1,
      ackTimeoutMs: 1_000,
    });

    expect(attempt).toMatchObject({
      outcome: 'valid',
      value: {
        activationId,
        idempotencyKey,
        toolName: 'git.write-file',
        attempt: 1,
        ackTimeoutMs: 1_000,
      },
    });

    if (attempt.outcome !== 'valid') {
      throw new Error('Expected valid attempt');
    }

    expect(
      evaluateActorToolDeliveryAckTimeout({
        attempt: attempt.value,
        elapsedMs: 999,
        acknowledged: false,
        maxAttempts: 3,
      })
    ).toEqual({
      outcome: 'wait',
      activationId,
      remainingMs: 1,
    });
    expect(
      evaluateActorToolDeliveryAckTimeout({
        attempt: attempt.value,
        elapsedMs: 1_000,
        acknowledged: false,
        maxAttempts: 3,
      })
    ).toEqual({
      outcome: 'reemit',
      command: {
        activationId,
        idempotencyKey,
        toolName: 'git.write-file',
        attempt: 2,
        reason: 'ack_timeout',
      },
    });
    expect(
      evaluateActorToolDeliveryAckTimeout({
        attempt: attempt.value,
        elapsedMs: 1_000,
        acknowledged: true,
        maxAttempts: 3,
      })
    ).toEqual({
      outcome: 'acked',
      activationId,
    });
  });

  it('returns failure facts instead of re-emitting beyond max attempts or invalid timing', () => {
    const idempotencyKey = createKey();
    const activationId = createActivation(idempotencyKey);
    const attempt = createActorToolDeliveryAttempt({
      activationId,
      idempotencyKey,
      toolName: 'git.write-file',
      attempt: 3,
      ackTimeoutMs: 1_000,
    });

    if (attempt.outcome !== 'valid') {
      throw new Error('Expected valid attempt');
    }

    expect(
      evaluateActorToolDeliveryAckTimeout({
        attempt: attempt.value,
        elapsedMs: 1_000,
        acknowledged: false,
        maxAttempts: 3,
      })
    ).toEqual({
      outcome: 'failed',
      failure: {
        code: 'ack_timeout',
        message: 'Actor tool delivery activation was not acknowledged before max attempts.',
        retryable: false,
        details: {
          activationId,
          attempt: 3,
          maxAttempts: 3,
          toolName: 'git.write-file',
        },
      },
    });
    expect(
      createActorToolDeliveryAttempt({
        activationId,
        idempotencyKey,
        toolName: 'git.write-file',
        attempt: 0,
        ackTimeoutMs: Number.POSITIVE_INFINITY,
      })
    ).toEqual({
      outcome: 'invalid',
      failure: {
        code: 'invalid_request',
        message: 'Actor tool delivery attempt and ackTimeoutMs must be positive finite numbers.',
        retryable: false,
        details: {
          attempt: 0,
          ackTimeoutMs: Number.POSITIVE_INFINITY,
        },
      },
    });
  });

  it('claims and acknowledges activations idempotently without rerunning side effects', async () => {
    const idempotencyKey = createKey();
    const activationId = createActivation(idempotencyKey);
    const provider = createInMemoryActorToolDeliveryIdempotencyProvider();

    await expect(
      provider.claim({
        activationId,
        idempotencyKey,
        toolName: 'git.write-file',
      })
    ).resolves.toEqual({
      outcome: 'claimed',
      activationId,
      idempotencyKey,
      toolName: 'git.write-file',
    });
    await expect(
      provider.claim({
        activationId,
        idempotencyKey: createKey('task-2002'),
        toolName: 'git.commit',
      })
    ).resolves.toEqual({
      outcome: 'duplicate',
      activationId,
      idempotencyKey,
      toolName: 'git.write-file',
      status: 'pending',
      ack: undefined,
    });

    await expect(
      provider.acknowledge(
        createActorToolDeliveryAck({
          activationId,
          idempotencyKey: createKey('task-2002'),
          toolName: 'git.write-file',
        })
      )
    ).resolves.toMatchObject({
      outcome: 'error',
      failure: {
        code: 'acknowledge_failed',
        retryable: false,
      },
    });

    const ack = createActorToolDeliveryAck({
      activationId,
      idempotencyKey,
      toolName: 'git.write-file',
      output: { path: 'README.md' },
    });
    await expect(provider.acknowledge(ack)).resolves.toEqual({
      outcome: 'acked',
      ack,
    });
    await expect(
      provider.acknowledge(
        createActorToolDeliveryAck({
          activationId,
          idempotencyKey,
          toolName: 'git.write-file',
          output: { path: 'OTHER.md' },
        })
      )
    ).resolves.toEqual({
      outcome: 'acked',
      ack,
    });
    await expect(
      provider.claim({
        activationId,
        idempotencyKey,
        toolName: 'git.write-file',
      })
    ).resolves.toEqual({
      outcome: 'duplicate',
      activationId,
      idempotencyKey,
      toolName: 'git.write-file',
      status: 'acked',
      ack,
    });
  });

  it('exports delivery helpers from universal runtime entrypoints', () => {
    expect(rootEntry.createActorToolDeliveryActivationId).toBeTypeOf('function');
    expect(browserEntry.createActorToolDeliveryActivationId).toBeTypeOf('function');
    expect(nodeEntry.createActorToolDeliveryActivationId).toBeTypeOf('function');
  });
});
