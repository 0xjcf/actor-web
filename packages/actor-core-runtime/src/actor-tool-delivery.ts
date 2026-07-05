import type { JsonValue } from './types.js';

declare const ACTOR_TOOL_DELIVERY_ACTIVATION_ID_BRAND: unique symbol;
declare const ACTOR_TOOL_DELIVERY_IDEMPOTENCY_KEY_BRAND: unique symbol;

export type ActorToolDeliveryActivationId = string & {
  readonly [ACTOR_TOOL_DELIVERY_ACTIVATION_ID_BRAND]: 'ActorToolDeliveryActivationId';
};

export type ActorToolDeliveryIdempotencyKey = string & {
  readonly [ACTOR_TOOL_DELIVERY_IDEMPOTENCY_KEY_BRAND]: 'ActorToolDeliveryIdempotencyKey';
};

export type ActorToolDeliveryParseResult<TValue extends string> =
  | {
      readonly outcome: 'valid';
      readonly value: TValue;
    }
  | {
      readonly outcome: 'invalid';
      readonly reason: 'expected_non_empty_string';
      readonly field: string;
      readonly value: unknown;
    };

export type ActorToolDeliveryFailureCode =
  | 'invalid_request'
  | 'ack_timeout'
  | 'duplicate_activation'
  | 'acknowledge_failed';

export interface ActorToolDeliveryFailure {
  readonly code: ActorToolDeliveryFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonValue;
}

export interface ActorToolDeliveryIdentityInput {
  readonly actorId: string;
  readonly nodeAddress: string;
  readonly toolName: string;
}

export interface ActorToolDeliveryIdempotencyKeyInput extends ActorToolDeliveryIdentityInput {
  readonly requestId: string;
}

export interface ActorToolDeliveryActivationIdInput extends ActorToolDeliveryIdentityInput {
  readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
}

export interface ActorToolDeliveryAttempt {
  readonly activationId: ActorToolDeliveryActivationId;
  readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
  readonly toolName: string;
  readonly attempt: number;
  readonly ackTimeoutMs: number;
}

export type ActorToolDeliveryAttemptResult =
  | {
      readonly outcome: 'valid';
      readonly value: ActorToolDeliveryAttempt;
    }
  | {
      readonly outcome: 'invalid';
      readonly failure: ActorToolDeliveryFailure;
    };

export interface ActorToolDeliveryAck {
  readonly activationId: ActorToolDeliveryActivationId;
  readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
  readonly toolName: string;
  readonly output?: JsonValue;
}

export interface ActorToolDeliveryReemitCommand {
  readonly activationId: ActorToolDeliveryActivationId;
  readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
  readonly toolName: string;
  readonly attempt: number;
  readonly reason: 'ack_timeout';
}

export type ActorToolDeliveryAckTimeoutDecision =
  | {
      readonly outcome: 'wait';
      readonly activationId: ActorToolDeliveryActivationId;
      readonly remainingMs: number;
    }
  | {
      readonly outcome: 'acked';
      readonly activationId: ActorToolDeliveryActivationId;
    }
  | {
      readonly outcome: 'reemit';
      readonly command: ActorToolDeliveryReemitCommand;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: ActorToolDeliveryFailure;
    };

export interface ActorToolDeliveryIdempotencyClaimInput {
  readonly activationId: ActorToolDeliveryActivationId;
  readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
  readonly toolName: string;
}

export type ActorToolDeliveryStatus = 'pending' | 'acked';

export type ActorToolDeliveryIdempotencyClaimResult =
  | {
      readonly outcome: 'claimed';
      readonly activationId: ActorToolDeliveryActivationId;
      readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
      readonly toolName: string;
    }
  | {
      readonly outcome: 'duplicate';
      readonly activationId: ActorToolDeliveryActivationId;
      readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
      readonly toolName: string;
      readonly status: ActorToolDeliveryStatus;
      readonly ack?: ActorToolDeliveryAck;
    }
  | {
      readonly outcome: 'error';
      readonly failure: ActorToolDeliveryFailure;
    };

export type ActorToolDeliveryAcknowledgeResult =
  | {
      readonly outcome: 'acked';
      readonly ack: ActorToolDeliveryAck;
    }
  | {
      readonly outcome: 'missing';
      readonly activationId: ActorToolDeliveryActivationId;
    }
  | {
      readonly outcome: 'error';
      readonly failure: ActorToolDeliveryFailure;
    };

export interface ActorToolDeliveryIdempotencyProvider {
  claim(
    input: ActorToolDeliveryIdempotencyClaimInput
  ): ActorToolDeliveryIdempotencyClaimResult | Promise<ActorToolDeliveryIdempotencyClaimResult>;
  acknowledge(
    ack: ActorToolDeliveryAck
  ): ActorToolDeliveryAcknowledgeResult | Promise<ActorToolDeliveryAcknowledgeResult>;
}

export interface InMemoryActorToolDeliveryIdempotencyProvider
  extends ActorToolDeliveryIdempotencyProvider {
  getSnapshot(): Readonly<Record<string, ActorToolDeliveryStatus>>;
  clear(): void;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidStringResult<TValue extends string>(
  field: string,
  value: unknown
): ActorToolDeliveryParseResult<TValue> {
  return {
    outcome: 'invalid',
    reason: 'expected_non_empty_string',
    field,
    value,
  };
}

function validateIdentityInput<TValue extends string>(
  input: ActorToolDeliveryIdentityInput,
  createValue: () => TValue
): ActorToolDeliveryParseResult<TValue> {
  if (!hasNonEmptyString(input.actorId)) {
    return invalidStringResult('actorId', input.actorId);
  }
  if (!hasNonEmptyString(input.nodeAddress)) {
    return invalidStringResult('nodeAddress', input.nodeAddress);
  }
  if (!hasNonEmptyString(input.toolName)) {
    return invalidStringResult('toolName', input.toolName);
  }

  return {
    outcome: 'valid',
    value: createValue(),
  };
}

function encodeDeliveryComponent(value: string): string {
  return encodeURIComponent(value);
}

function createFailure(input: ActorToolDeliveryFailure): ActorToolDeliveryFailure {
  return {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

export function createActorToolDeliveryIdempotencyKey(
  input: ActorToolDeliveryIdempotencyKeyInput
): ActorToolDeliveryParseResult<ActorToolDeliveryIdempotencyKey> {
  if (!hasNonEmptyString(input.requestId)) {
    return invalidStringResult('requestId', input.requestId);
  }

  return validateIdentityInput(
    input,
    () =>
      [
        'actor-tool-delivery',
        'key',
        `node=${encodeDeliveryComponent(input.nodeAddress)}`,
        `actor=${encodeDeliveryComponent(input.actorId)}`,
        `tool=${encodeDeliveryComponent(input.toolName)}`,
        `request=${encodeDeliveryComponent(input.requestId)}`,
      ].join(':') as ActorToolDeliveryIdempotencyKey
  );
}

export function createActorToolDeliveryActivationId(
  input: ActorToolDeliveryActivationIdInput
): ActorToolDeliveryParseResult<ActorToolDeliveryActivationId> {
  if (!hasNonEmptyString(input.idempotencyKey)) {
    return invalidStringResult('idempotencyKey', input.idempotencyKey);
  }

  return validateIdentityInput(
    input,
    () =>
      [
        'actor-tool-delivery',
        'activation',
        `node=${encodeDeliveryComponent(input.nodeAddress)}`,
        `actor=${encodeDeliveryComponent(input.actorId)}`,
        `tool=${encodeDeliveryComponent(input.toolName)}`,
        `key=${input.idempotencyKey}`,
      ].join(':') as ActorToolDeliveryActivationId
  );
}

export function createActorToolDeliveryAttempt(input: {
  readonly activationId: ActorToolDeliveryActivationId;
  readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
  readonly toolName: string;
  readonly attempt: number;
  readonly ackTimeoutMs: number;
}): ActorToolDeliveryAttemptResult {
  if (
    !Number.isFinite(input.attempt) ||
    input.attempt <= 0 ||
    !Number.isFinite(input.ackTimeoutMs) ||
    input.ackTimeoutMs <= 0
  ) {
    return {
      outcome: 'invalid',
      failure: createFailure({
        code: 'invalid_request',
        message: 'Actor tool delivery attempt and ackTimeoutMs must be positive finite numbers.',
        retryable: false,
        details: {
          attempt: input.attempt,
          ackTimeoutMs: input.ackTimeoutMs,
        },
      }),
    };
  }

  if (!hasNonEmptyString(input.toolName)) {
    return {
      outcome: 'invalid',
      failure: createFailure({
        code: 'invalid_request',
        message: 'Actor tool delivery toolName must be a non-empty string.',
        retryable: false,
        details: { toolName: input.toolName },
      }),
    };
  }

  return {
    outcome: 'valid',
    value: {
      activationId: input.activationId,
      idempotencyKey: input.idempotencyKey,
      toolName: input.toolName,
      attempt: Math.trunc(input.attempt),
      ackTimeoutMs: Math.trunc(input.ackTimeoutMs),
    },
  };
}

export function createActorToolDeliveryAck(input: {
  readonly activationId: ActorToolDeliveryActivationId;
  readonly idempotencyKey: ActorToolDeliveryIdempotencyKey;
  readonly toolName: string;
  readonly output?: JsonValue;
}): ActorToolDeliveryAck {
  return {
    activationId: input.activationId,
    idempotencyKey: input.idempotencyKey,
    toolName: input.toolName,
    ...(input.output === undefined ? {} : { output: input.output }),
  };
}

export function evaluateActorToolDeliveryAckTimeout(input: {
  readonly attempt: ActorToolDeliveryAttempt;
  readonly elapsedMs: number;
  readonly acknowledged: boolean;
  readonly maxAttempts: number;
}): ActorToolDeliveryAckTimeoutDecision {
  if (input.acknowledged) {
    return {
      outcome: 'acked',
      activationId: input.attempt.activationId,
    };
  }

  const elapsedMs = Number.isFinite(input.elapsedMs) ? Math.max(0, Math.trunc(input.elapsedMs)) : 0;
  const remainingMs = Math.max(0, input.attempt.ackTimeoutMs - elapsedMs);
  if (remainingMs > 0) {
    return {
      outcome: 'wait',
      activationId: input.attempt.activationId,
      remainingMs,
    };
  }

  const maxAttempts =
    Number.isFinite(input.maxAttempts) && input.maxAttempts > 0 ? Math.trunc(input.maxAttempts) : 1;
  if (input.attempt.attempt >= maxAttempts) {
    return {
      outcome: 'failed',
      failure: createFailure({
        code: 'ack_timeout',
        message: 'Actor tool delivery activation was not acknowledged before max attempts.',
        retryable: false,
        details: {
          activationId: input.attempt.activationId,
          attempt: input.attempt.attempt,
          maxAttempts,
          toolName: input.attempt.toolName,
        },
      }),
    };
  }

  return {
    outcome: 'reemit',
    command: {
      activationId: input.attempt.activationId,
      idempotencyKey: input.attempt.idempotencyKey,
      toolName: input.attempt.toolName,
      attempt: input.attempt.attempt + 1,
      reason: 'ack_timeout',
    },
  };
}

export function createInMemoryActorToolDeliveryIdempotencyProvider(): InMemoryActorToolDeliveryIdempotencyProvider {
  const activations = new Map<
    ActorToolDeliveryActivationId,
    {
      readonly input: ActorToolDeliveryIdempotencyClaimInput;
      ack?: ActorToolDeliveryAck;
    }
  >();

  return {
    async claim(input): Promise<ActorToolDeliveryIdempotencyClaimResult> {
      const existing = activations.get(input.activationId);
      if (existing) {
        return {
          outcome: 'duplicate',
          activationId: existing.input.activationId,
          idempotencyKey: existing.input.idempotencyKey,
          toolName: existing.input.toolName,
          status: existing.ack ? 'acked' : 'pending',
          ack: existing.ack,
        };
      }

      activations.set(input.activationId, { input });
      return {
        outcome: 'claimed',
        activationId: input.activationId,
        idempotencyKey: input.idempotencyKey,
        toolName: input.toolName,
      };
    },
    async acknowledge(ack): Promise<ActorToolDeliveryAcknowledgeResult> {
      const existing = activations.get(ack.activationId);
      if (!existing) {
        return {
          outcome: 'missing',
          activationId: ack.activationId,
        };
      }

      if (
        existing.input.idempotencyKey !== ack.idempotencyKey ||
        existing.input.toolName !== ack.toolName
      ) {
        return {
          outcome: 'error',
          failure: createFailure({
            code: 'acknowledge_failed',
            message: 'Actor tool delivery ack did not match the claimed activation facts.',
            retryable: false,
            details: {
              activationId: existing.input.activationId,
              expectedIdempotencyKey: existing.input.idempotencyKey,
              receivedIdempotencyKey: ack.idempotencyKey,
              expectedToolName: existing.input.toolName,
              receivedToolName: ack.toolName,
            },
          }),
        };
      }

      if (existing.ack) {
        return {
          outcome: 'acked',
          ack: existing.ack,
        };
      }

      existing.ack = ack;
      return {
        outcome: 'acked',
        ack,
      };
    },
    getSnapshot(): Readonly<Record<string, ActorToolDeliveryStatus>> {
      return Object.fromEntries(
        Array.from(activations.entries()).map(([activationId, entry]) => [
          activationId,
          entry.ack ? 'acked' : 'pending',
        ])
      );
    },
    clear(): void {
      activations.clear();
    },
  };
}
