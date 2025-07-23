/**
 * @module actor-core/runtime/__tests__/plan-interpreter.test
 * @description Integration tests for the Plan Interpreter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorMessage, ActorRef, DomainEvent, MessagePlan } from '../message-plan.js';

import { createAskInstruction, createDomainEvent, createSendInstruction } from '../message-plan.js';

import type { PlanExecutionResult, RuntimeContext } from '../plan-interpreter.js';
// Import functions and types separately to avoid linter issues
import {
  createExecutionMetrics,
  createMockRuntimeContext,
  processMessagePlan,
  validateRuntimeContext,
} from '../plan-interpreter.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const mockActorMessage: ActorMessage = {
  type: 'TEST_MESSAGE',
  payload: { data: 'test payload' },
  timestamp: Date.now(),
  version: '1.0.0',
};

const mockDomainEvent: DomainEvent = {
  type: 'TEST_DOMAIN_EVENT',
  userId: '123',
  action: 'test_action',
  timestamp: Date.now(),
};

const createMockActorRef = (): ActorRef => ({
  id: 'mock-actor',
  send: vi.fn().mockResolvedValue(undefined),
  ask: vi.fn().mockResolvedValue({ success: true }),
});

// ============================================================================
// DOMAIN EVENT TESTS
// ============================================================================

describe('processMessagePlan - Domain Events', () => {
  let runtimeContext: RuntimeContext;
  let mockSend: ReturnType<typeof vi.fn>;
  let mockEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSend = vi.fn();
    mockEmit = vi.fn();

    // Focus on behavior: what the function needs, not interface compliance
    runtimeContext = {
      machine: { send: mockSend },
      emit: mockEmit,
      actorId: 'test-actor',
    } as unknown as RuntimeContext;
  });

  it('should fan out domain events to machine and emit', async () => {
    const mockDomainEvent = createDomainEvent({
      type: 'USER_LOGGED_IN',
      payload: { userId: 'test' },
      timestamp: Date.now(),
      version: '1.0.0',
    });
    const result = await processMessagePlan(mockDomainEvent, runtimeContext);

    expect(result.success).toBe(true);
    expect(result.instructionsExecuted).toBe(1);

    // Verify fan-out behavior
    expect(mockSend).toHaveBeenCalledWith(mockDomainEvent);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(mockDomainEvent);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it('should process multiple domain events', async () => {
    const event1: DomainEvent = { type: 'EVENT_1', data: 'first' };
    const event2: DomainEvent = { type: 'EVENT_2', data: 'second' };
    const messagePlan = [event1, event2];

    const result = await processMessagePlan(messagePlan, runtimeContext);

    expect(result.success).toBe(true);
    expect(result.domainEventsEmitted).toBe(2);
    expect(result.instructionsExecuted).toBe(2);

    expect(runtimeContext.machine.send).toHaveBeenCalledWith(event1);
    expect(runtimeContext.machine.send).toHaveBeenCalledWith(event2);
    expect(runtimeContext.emit).toHaveBeenCalledWith(event1);
    expect(runtimeContext.emit).toHaveBeenCalledWith(event2);
  });

  it('should handle domain event fan-out errors', async () => {
    const errorEmit = vi.fn().mockRejectedValue(new Error('Emit failed'));
    const errorContext = {
      ...runtimeContext,
      emit: errorEmit,
    };

    const result = await processMessagePlan(mockDomainEvent, errorContext);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Domain event fan-out failed');
  });
});

// ============================================================================
// SEND INSTRUCTION TESTS
// ============================================================================

describe('processMessagePlan - Send Instructions', () => {
  let runtimeContext: RuntimeContext;
  let mockActor: ActorRef;

  beforeEach(() => {
    mockActor = createMockActorRef();
    runtimeContext = createMockRuntimeContext();
  });

  it('should process send instruction successfully', async () => {
    const sendInstruction = createSendInstruction(mockActor, mockActorMessage);

    const result = await processMessagePlan(sendInstruction, runtimeContext);

    expect(result.success).toBe(true);
    expect(result.sendInstructionsProcessed).toBe(1);
    expect(result.instructionsExecuted).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(mockActor.send).toHaveBeenCalledWith(mockActorMessage);
  });

  it('should handle send instruction errors', async () => {
    const errorActor = {
      ...mockActor,
      send: vi.fn().mockRejectedValue(new Error('Send failed')),
    };

    const sendInstruction = createSendInstruction(errorActor, mockActorMessage);
    const result = await processMessagePlan(sendInstruction, runtimeContext);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Send instruction failed');
  });
});

// ============================================================================
// ASK INSTRUCTION TESTS
// ============================================================================

describe('processMessagePlan - Ask Instructions', () => {
  let runtimeContext: RuntimeContext;
  let mockActor: ActorRef;

  beforeEach(() => {
    mockActor = createMockActorRef();
    runtimeContext = createMockRuntimeContext();
  });

  it('should handle ask instruction with domain event callback', async () => {
    const successEvent: DomainEvent = { type: 'SUCCESS', result: 'ok' };
    const askInstruction = createAskInstruction(mockActor, mockActorMessage, successEvent);

    const result = await processMessagePlan(askInstruction, runtimeContext);

    expect(result.success).toBe(true);
    expect(result.askInstructionsProcessed).toBe(1);
    expect(result.domainEventsEmitted).toBe(1); // From callback
    expect(result.instructionsExecuted).toBe(1);

    expect(mockActor.ask).toHaveBeenCalledWith(mockActorMessage, 5000);
  });

  it('should handle ask instruction with function callback', async () => {
    const mockResponse = { data: 'response' };
    mockActor.ask = vi.fn().mockResolvedValue(mockResponse);

    const onOkCallback = vi.fn().mockReturnValue({ type: 'CALLBACK_SUCCESS', data: 'ok' });
    const askInstruction = createAskInstruction(mockActor, mockActorMessage, onOkCallback);

    const result = await processMessagePlan(askInstruction, runtimeContext);

    expect(result.success).toBe(true);
    expect(onOkCallback).toHaveBeenCalledWith(mockResponse);
    expect(result.askInstructionsProcessed).toBe(1);
    expect(result.domainEventsEmitted).toBe(1);
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('processMessagePlan - Error Handling', () => {
  let runtimeContext: RuntimeContext;

  beforeEach(() => {
    runtimeContext = createMockRuntimeContext();
  });

  it('should handle void message plans', async () => {
    const undefinedResult = await processMessagePlan(undefined, runtimeContext);
    const voidResult = await processMessagePlan(void 0, runtimeContext);

    expect(undefinedResult.success).toBe(true);
    expect(undefinedResult.instructionsExecuted).toBe(0);
    expect(voidResult.success).toBe(true);
    expect(voidResult.instructionsExecuted).toBe(0);
  });

  it('should handle invalid message plans', async () => {
    const invalidPlan = { invalid: 'structure' } as unknown as MessagePlan;
    const result = await processMessagePlan(invalidPlan, runtimeContext);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Invalid message plan structure');
  });

  it('should measure execution time', async () => {
    const domainEvent: DomainEvent = { type: 'TIMED_EVENT', data: 'test' };
    const result = await processMessagePlan(domainEvent, runtimeContext);

    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.executionTimeMs).toBe('number');
  });
});

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('Helper Functions', () => {
  it('should create mock runtime context', () => {
    const mockContext = createMockRuntimeContext();

    expect(mockContext.machine).toBeDefined();
    expect(mockContext.emit).toBeDefined();
    expect(mockContext.actorId).toBe('test-actor');
    expect(typeof mockContext.machine.send).toBe('function');
    expect(typeof mockContext.emit).toBe('function');
  });

  it('should validate runtime context', () => {
    const validContext = createMockRuntimeContext();
    const validErrors = validateRuntimeContext(validContext);
    expect(validErrors).toHaveLength(0);

    const invalidContext = {
      machine: null,
      emit: 'not a function',
    } as unknown as RuntimeContext;
    const invalidErrors = validateRuntimeContext(invalidContext);
    expect(invalidErrors.length).toBeGreaterThan(0);
    expect(invalidErrors).toContain('Runtime context missing machine');
  });

  it('should create execution metrics', () => {
    const result: PlanExecutionResult = {
      success: true,
      instructionsExecuted: 5,
      domainEventsEmitted: 2,
      sendInstructionsProcessed: 1,
      askInstructionsProcessed: 2,
      errors: [],
      executionTimeMs: 100,
    };

    const metrics = createExecutionMetrics(result);

    expect(metrics.success).toBe(1);
    expect(metrics.instructionsExecuted).toBe(5);
    expect(metrics.domainEventsEmitted).toBe(2);
    expect(metrics.executionTimeMs).toBe(100);
  });
});
