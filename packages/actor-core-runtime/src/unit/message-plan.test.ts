/**
 * @module actor-core/runtime/__tests__/message-plan.test
 * @description Comprehensive test suite for Message Plan DSL Foundation
 *
 * This test suite ensures 100% coverage of all type guards and functions
 * in the message plan DSL, validating both type safety and runtime behavior.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type ActorMessage,
  type ActorRef,
  type AskInstruction,
  createAskInstruction,
  createDomainEvent,
  // Factory functions
  createSendInstruction,
  // Types and interfaces
  type DomainEvent,
  isActorMessage,
  isAskInstruction,
  // Type guards
  isDomainEvent,
  isJsonSerializable,
  isMessagePlan,
  isSendInstruction,
  type SendInstruction,
} from '../message-plan.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const mockActorRef: ActorRef<ActorMessage> = {
  id: 'test-actor',
  send: vi.fn().mockResolvedValue(undefined),
  ask: vi.fn().mockResolvedValue({ success: true }),
};

const validActorMessage: ActorMessage = {
  type: 'TEST_MESSAGE',
  payload: { data: 'test' },
  timestamp: Date.now(),
  version: '1.0.0',
};

const validDomainEvent: DomainEvent = {
  type: 'USER_REGISTERED',
  userId: '12345',
  email: 'user@example.com',
  timestamp: Date.now(),
};

// ============================================================================
// JSON SERIALIZATION TESTS
// ============================================================================

describe('isJsonSerializable', () => {
  it('should return true for JSON-serializable primitives', () => {
    expect(isJsonSerializable(null)).toBe(true);
    expect(isJsonSerializable(undefined)).toBe(true);
    expect(isJsonSerializable('string')).toBe(true);
    expect(isJsonSerializable(123)).toBe(true);
    expect(isJsonSerializable(true)).toBe(true);
    expect(isJsonSerializable(false)).toBe(true);
  });

  it('should return true for JSON-serializable arrays', () => {
    expect(isJsonSerializable([])).toBe(true);
    expect(isJsonSerializable([1, 2, 3])).toBe(true);
    expect(isJsonSerializable(['a', 'b', 'c'])).toBe(true);
    expect(isJsonSerializable([{ nested: 'object' }])).toBe(true);
  });

  it('should return true for JSON-serializable objects', () => {
    expect(isJsonSerializable({})).toBe(true);
    expect(isJsonSerializable({ key: 'value' })).toBe(true);
    expect(isJsonSerializable({ nested: { deeply: { object: true } } })).toBe(true);
  });

  it('should return false for non-serializable types', () => {
    expect(isJsonSerializable(new Date())).toBe(false);
    expect(isJsonSerializable(/test/)).toBe(false);
    expect(isJsonSerializable(new Error('test'))).toBe(false);
    expect(isJsonSerializable(new Map())).toBe(false);
    expect(isJsonSerializable(new Set())).toBe(false);
    expect(isJsonSerializable(new WeakMap())).toBe(false);
    expect(isJsonSerializable(new WeakSet())).toBe(false);
  });

  it('should return false for functions', () => {
    expect(isJsonSerializable(() => {})).toBe(false);
    expect(isJsonSerializable({ func: () => {} })).toBe(false);
  });

  it('should return false for promises', () => {
    expect(isJsonSerializable(Promise.resolve())).toBe(false);
  });

  it('should return false for arrays with non-serializable elements', () => {
    expect(isJsonSerializable([1, 2, new Date()])).toBe(false);
    expect(isJsonSerializable([{ valid: true }, { func: () => {} }])).toBe(false);
  });

  it('should return false for objects with non-serializable properties', () => {
    expect(isJsonSerializable({ date: new Date() })).toBe(false);
    expect(isJsonSerializable({ nested: { func: () => {} } })).toBe(false);
  });
});

// ============================================================================
// DOMAIN EVENT TESTS
// ============================================================================

describe('isDomainEvent', () => {
  it('should return true for valid domain events', () => {
    expect(isDomainEvent(validDomainEvent)).toBe(true);
    expect(isDomainEvent({ type: 'SIMPLE_EVENT' })).toBe(true);
    expect(isDomainEvent({ type: 'EVENT_WITH_DATA', data: { count: 42 } })).toBe(true);
  });

  it('should return false for invalid domain events', () => {
    expect(isDomainEvent(null)).toBe(false);
    expect(isDomainEvent(undefined)).toBe(false);
    expect(isDomainEvent('string')).toBe(false);
    expect(isDomainEvent(123)).toBe(false);
    expect(isDomainEvent({})).toBe(false);
    expect(isDomainEvent({ data: 'no type' })).toBe(false);
    expect(isDomainEvent({ type: 123 })).toBe(false);
  });

  it('should return false for domain events with non-serializable data', () => {
    expect(isDomainEvent({ type: 'EVENT', date: new Date() })).toBe(false);
    expect(isDomainEvent({ type: 'EVENT', func: () => {} })).toBe(false);
    expect(isDomainEvent({ type: 'EVENT', promise: Promise.resolve() })).toBe(false);
  });
});

// ============================================================================
// ACTOR MESSAGE TESTS
// ============================================================================

describe('isActorMessage', () => {
  it('should return true for valid actor messages', () => {
    expect(isActorMessage(validActorMessage)).toBe(true);
    expect(isActorMessage({ type: 'SIMPLE_MESSAGE' })).toBe(true);
  });

  it('should return false for invalid actor messages', () => {
    expect(isActorMessage(null)).toBe(false);
    expect(isActorMessage(undefined)).toBe(false);
    expect(isActorMessage('string')).toBe(false);
    expect(isActorMessage({})).toBe(false);
    expect(isActorMessage({ data: 'no type' })).toBe(false);
    expect(isActorMessage({ type: 123 })).toBe(false);
  });
});

// ============================================================================
// SEND INSTRUCTION TESTS
// ============================================================================

describe('isSendInstruction', () => {
  const validSendInstruction: SendInstruction = {
    to: mockActorRef,
    tell: validActorMessage,
    mode: 'fireAndForget',
  };

  it('should return true for valid send instructions', () => {
    expect(isSendInstruction(validSendInstruction)).toBe(true);
    expect(
      isSendInstruction({
        to: mockActorRef,
        tell: validActorMessage,
      })
    ).toBe(true);
  });

  it('should return false for invalid send instructions', () => {
    expect(isSendInstruction(null)).toBe(false);
    expect(isSendInstruction(undefined)).toBe(false);
    expect(isSendInstruction({})).toBe(false);
    expect(isSendInstruction({ to: mockActorRef })).toBe(false);
    expect(isSendInstruction({ tell: validActorMessage })).toBe(false);
    expect(isSendInstruction({ to: 'not an actor', tell: validActorMessage })).toBe(false);
    expect(isSendInstruction({ to: mockActorRef, tell: 'not a message' })).toBe(false);
    expect(isSendInstruction({ to: mockActorRef, tell: { data: 'no type' } })).toBe(false);
  });
});

// ============================================================================
// ASK INSTRUCTION TESTS
// ============================================================================

describe('isAskInstruction', () => {
  const validAskInstruction: AskInstruction = {
    to: mockActorRef,
    ask: validActorMessage,
    onOk: validDomainEvent,
  };

  const validAskInstructionWithFunction: AskInstruction = {
    to: mockActorRef,
    ask: validActorMessage,
    onOk: () => validDomainEvent,
  };

  it('should return true for valid ask instructions', () => {
    expect(isAskInstruction(validAskInstruction)).toBe(true);
    expect(isAskInstruction(validAskInstructionWithFunction)).toBe(true);
    expect(
      isAskInstruction({
        to: mockActorRef,
        ask: validActorMessage,
        onOk: validDomainEvent,
        onError: validDomainEvent,
        timeout: 5000,
      })
    ).toBe(true);
  });

  it('should return false for invalid ask instructions', () => {
    expect(isAskInstruction(null)).toBe(false);
    expect(isAskInstruction(undefined)).toBe(false);
    expect(isAskInstruction({})).toBe(false);
    expect(isAskInstruction({ to: mockActorRef })).toBe(false);
    expect(isAskInstruction({ to: mockActorRef, ask: validActorMessage })).toBe(false);
    expect(isAskInstruction({ ask: validActorMessage, onOk: validDomainEvent })).toBe(false);
    expect(
      isAskInstruction({ to: 'not an actor', ask: validActorMessage, onOk: validDomainEvent })
    ).toBe(false);
    expect(
      isAskInstruction({ to: mockActorRef, ask: 'not a message', onOk: validDomainEvent })
    ).toBe(false);
    expect(isAskInstruction({ to: mockActorRef, ask: validActorMessage, onOk: 'not valid' })).toBe(
      false
    );
  });
});

// ============================================================================
// MESSAGE PLAN TESTS
// ============================================================================

describe('isMessagePlan', () => {
  const validSendInstruction: SendInstruction = {
    to: mockActorRef,
    tell: validActorMessage,
    mode: 'fireAndForget',
  };

  const validAskInstruction: AskInstruction = {
    to: mockActorRef,
    ask: validActorMessage,
    onOk: validDomainEvent,
  };

  it('should return true for void (null/undefined)', () => {
    expect(isMessagePlan(null)).toBe(true);
    expect(isMessagePlan(undefined)).toBe(true);
  });

  it('should return true for valid domain events', () => {
    expect(isMessagePlan(validDomainEvent)).toBe(true);
  });

  it('should return true for valid send instructions', () => {
    expect(isMessagePlan(validSendInstruction)).toBe(true);
  });

  it('should return true for valid ask instructions', () => {
    expect(isMessagePlan(validAskInstruction)).toBe(true);
  });

  it('should return true for valid arrays of message plans', () => {
    expect(isMessagePlan([validDomainEvent])).toBe(true);
    expect(isMessagePlan([validSendInstruction])).toBe(true);
    expect(isMessagePlan([validAskInstruction])).toBe(true);
    expect(isMessagePlan([validDomainEvent, validSendInstruction, validAskInstruction])).toBe(true);
  });

  it('should return false for invalid message plans', () => {
    expect(isMessagePlan('string')).toBe(false);
    expect(isMessagePlan(123)).toBe(false);
    expect(isMessagePlan({})).toBe(false);
    expect(isMessagePlan({ invalid: 'object' })).toBe(false);
  });

  it('should return false for arrays with invalid elements', () => {
    expect(isMessagePlan([validDomainEvent, 'invalid'])).toBe(false);
    expect(isMessagePlan([validSendInstruction, {}])).toBe(false);
    expect(isMessagePlan(['invalid', 'elements'])).toBe(false);
  });
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createSendInstruction', () => {
  it('should create valid send instructions', () => {
    const instruction = createSendInstruction(mockActorRef, validActorMessage);
    expect(instruction).toEqual({
      to: mockActorRef,
      tell: validActorMessage,
      mode: 'fireAndForget',
    });
    expect(isSendInstruction(instruction)).toBe(true);
  });

  it('should create send instructions with custom mode', () => {
    const instruction = createSendInstruction(mockActorRef, validActorMessage, 'retry(3)');
    expect(instruction.mode).toBe('retry(3)');
  });
});

describe('createAskInstruction', () => {
  it('should create valid ask instructions with domain event callback', () => {
    const instruction = createAskInstruction(mockActorRef, validActorMessage, validDomainEvent);
    expect(instruction).toEqual({
      to: mockActorRef,
      ask: validActorMessage,
      onOk: validDomainEvent,
      onError: undefined,
      timeout: 5000,
    });
    expect(isAskInstruction(instruction)).toBe(true);
  });

  it('should create valid ask instructions with function callback', () => {
    const onOkCallback = () => validDomainEvent;
    const onErrCallback = () => validDomainEvent;

    const instruction = createAskInstruction(
      mockActorRef,
      validActorMessage,
      onOkCallback,
      onErrCallback,
      5000
    );

    expect(instruction.to).toBe(mockActorRef);
    expect(instruction.ask).toBe(validActorMessage);
    expect(instruction.onOk).toBe(onOkCallback);
    expect(instruction.onError).toBe(onErrCallback);
    expect(instruction.timeout).toBe(5000);
    expect(isAskInstruction(instruction)).toBe(true);
  });
});

describe('createDomainEvent', () => {
  it('should create valid domain events', () => {
    const event = createDomainEvent(validDomainEvent);
    expect(event).toBe(validDomainEvent);
    expect(isDomainEvent(event)).toBe(true);
  });

  it('should throw error for invalid domain events', () => {
    expect(() => createDomainEvent({ invalid: 'event' } as unknown as DomainEvent)).toThrow();
    expect(() =>
      createDomainEvent({ type: 'INVALID', func: () => {} } as unknown as DomainEvent)
    ).toThrow();
  });
});

// ============================================================================
// TYPE SAFETY INTEGRATION TESTS
// ============================================================================

describe('Type Safety Integration', () => {
  it('should work with valid message plan combinations', () => {
    const domainEvent: DomainEvent = { type: 'TEST_EVENT', data: 'test' };
    const sendInstruction = createSendInstruction(mockActorRef, validActorMessage);
    const askInstruction = createAskInstruction(mockActorRef, validActorMessage, domainEvent);

    // Test single message plans
    expect(isMessagePlan(domainEvent)).toBe(true);
    expect(isMessagePlan(sendInstruction)).toBe(true);
    expect(isMessagePlan(askInstruction)).toBe(true);

    // Test array message plans
    const arrayPlan = [domainEvent, sendInstruction, askInstruction];
    expect(isMessagePlan(arrayPlan)).toBe(true);

    // Test void
    expect(isMessagePlan(undefined)).toBe(true);
  });

  it('should maintain type constraints for ValidDomainEvent', () => {
    // This test ensures compile-time type safety
    const validEvent: DomainEvent = {
      type: 'VALID_EVENT',
      data: 'serializable string',
      number: 42,
      boolean: true,
      nested: { object: { with: 'serializable data' } },
    };

    expect(isDomainEvent(validEvent)).toBe(true);

    // These should fail at compile time (and runtime)
    const invalidEvent = {
      type: 'INVALID_EVENT',
      func: () => {}, // Functions are not serializable
    };

    expect(isDomainEvent(invalidEvent)).toBe(false);
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty arrays', () => {
    expect(isMessagePlan([])).toBe(true);
  });

  it('should handle deeply nested serializable objects', () => {
    const deeplyNested = {
      type: 'DEEP_EVENT',
      level1: {
        level2: {
          level3: {
            level4: {
              data: 'deep value',
            },
          },
        },
      },
    };

    expect(isDomainEvent(deeplyNested)).toBe(true);
  });

  it('should handle special numeric values', () => {
    expect(isJsonSerializable(Number.NaN)).toBe(true); // JSON.stringify converts NaN to null
    expect(isJsonSerializable(Number.POSITIVE_INFINITY)).toBe(true); // JSON.stringify converts Infinity to null
    expect(isJsonSerializable(Number.NEGATIVE_INFINITY)).toBe(true);
  });
});
