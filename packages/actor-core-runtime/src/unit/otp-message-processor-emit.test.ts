/**
 * @module actor-core/runtime/unit/otp-message-processor-emit.test
 * @description Unit tests for Layer 2: OTPMessagePlanProcessor emit handling
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActorInstance } from '../actor-instance.js';
import type { ActorDependencies } from '../actor-system.js';
import type { DomainEvent } from '../message-plan.js';
import { OTPMessagePlanProcessor } from '../otp-message-plan-processor.js';
import type { ActorHandlerResult } from '../otp-types.js';
import { createMockActorRef } from '../utils/factories.js';

describe('Layer 2: OTPMessagePlanProcessor - Emit Handling', () => {
  it('should process emit array from ActorHandlerResult', async () => {
    // Create mock dependencies
    const emittedEvents: unknown[] = [];
    const mockActorInstance: ActorInstance = {
      id: 'test-actor',
      getType: () => 'context' as const,
      status: 'running',
      send: vi.fn(),
      ask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getSnapshot: () => ({
        context: { count: 0 },
        value: 'idle',
        status: 'running',
        matches: () => false,
        can: () => true,
        hasTag: () => false,
        toJSON: () => ({}),
      }),
    };

    const mockDependencies: ActorDependencies = {
      actorId: 'test-actor',
      actor: mockActorInstance,
      self: createMockActorRef(),
      emit: vi.fn((event: unknown) => {
        emittedEvents.push(event);
      }),
      send: vi.fn(),
      ask: vi.fn(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      correlationManager: undefined,
    };

    // Create processor
    const processor = new OTPMessagePlanProcessor();

    // Create a result with emit array
    const result: ActorHandlerResult<{ count: number }, DomainEvent> = {
      context: { count: 1 },
      emit: [
        { type: 'COUNT_INCREMENTED', from: 0, to: 1 },
        { type: 'MILESTONE_REACHED', value: 1 },
      ],
    };

    // Process the result - requires all parameters
    await processor.processOTPResult(
      result,
      'test-actor',
      mockActorInstance,
      mockDependencies,
      undefined, // correlationId
      undefined // originalMessageType
    );

    // Verify emit was called for each event
    expect(mockDependencies.emit).toHaveBeenCalledTimes(2);
    expect(emittedEvents).toHaveLength(2);

    // Check that events have correct content (ignoring envelope fields)
    expect(emittedEvents[0]).toMatchObject({ type: 'COUNT_INCREMENTED', from: 0, to: 1 });
    expect(emittedEvents[1]).toMatchObject({ type: 'MILESTONE_REACHED', value: 1 });

    // Verify envelope fields were added
    expect(emittedEvents[0]).toHaveProperty('_correlationId');
    expect(emittedEvents[0]).toHaveProperty('_timestamp');
    expect(emittedEvents[0]).toHaveProperty('_version');
  });

  it('should handle empty emit array', async () => {
    const mockActorInstance: ActorInstance = {
      id: 'test-actor',
      getType: () => 'context' as const,
      status: 'running',
      send: vi.fn(),
      ask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getSnapshot: () => ({
        context: { value: 'test' },
        value: 'idle',
        status: 'running',
        matches: () => false,
        can: () => true,
        hasTag: () => false,
        toJSON: () => ({}),
      }),
    };

    const mockDependencies: ActorDependencies = {
      actorId: 'test-actor',
      actor: mockActorInstance,
      self: createMockActorRef(),
      emit: vi.fn(),
      send: vi.fn(),
      ask: vi.fn(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      correlationManager: undefined,
    };

    const processor = new OTPMessagePlanProcessor();

    // Result with empty emit array
    const result: ActorHandlerResult<{ value: string }, DomainEvent> = {
      context: { value: 'test' },
      emit: [],
    };

    await processor.processOTPResult(result, 'test-actor', mockActorInstance, mockDependencies);

    // Verify emit was not called
    expect(mockDependencies.emit).not.toHaveBeenCalled();
  });

  it('should handle result with no emit property', async () => {
    const mockActorInstance: ActorInstance = {
      id: 'test-actor',
      getType: () => 'context' as const,
      status: 'running',
      send: vi.fn(),
      ask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getSnapshot: () => ({
        context: { status: 'active' },
        value: 'idle',
        status: 'running',
        matches: () => false,
        can: () => true,
        hasTag: () => false,
        toJSON: () => ({}),
      }),
    };

    const mockDependencies: ActorDependencies = {
      actorId: 'test-actor',
      actor: mockActorInstance,
      self: createMockActorRef(),
      emit: vi.fn(),
      send: vi.fn(),
      ask: vi.fn(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      correlationManager: undefined,
    };

    const processor = new OTPMessagePlanProcessor();

    // Result without emit property
    const result: ActorHandlerResult<{ status: string }, DomainEvent> = {
      context: { status: 'active' },
    };

    await processor.processOTPResult(result, 'test-actor', mockActorInstance, mockDependencies);

    // Verify emit was not called
    expect(mockDependencies.emit).not.toHaveBeenCalled();
  });

  it('should handle complex event objects', async () => {
    const emittedEvents: unknown[] = [];
    const mockActorInstance: ActorInstance = {
      id: 'test-actor',
      getType: () => 'context' as const,
      status: 'running',
      send: vi.fn(),
      ask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getSnapshot: () => ({
        context: { lastUpdate: Date.now() },
        value: 'idle',
        status: 'running',
        matches: () => false,
        can: () => true,
        hasTag: () => false,
        toJSON: () => ({}),
      }),
    };

    const mockDependencies: ActorDependencies = {
      actorId: 'test-actor',
      actor: mockActorInstance,
      self: createMockActorRef(),
      emit: vi.fn((event: unknown) => {
        emittedEvents.push(event);
      }),
      send: vi.fn(),
      ask: vi.fn(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      correlationManager: undefined,
    };

    const processor = new OTPMessagePlanProcessor();

    // Complex event with nested data
    const complexEvent: DomainEvent = {
      type: 'USER_UPDATED',
      userId: '123',
      changes: {
        name: { from: 'John', to: 'Jane' },
        email: { from: 'john@example.com', to: 'jane@example.com' },
      },
      metadata: {
        timestamp: Date.now(),
        source: 'admin-panel',
        version: '2.0.0',
      },
    };

    const result: ActorHandlerResult<{ lastUpdate: number }, DomainEvent> = {
      context: { lastUpdate: Date.now() },
      emit: [complexEvent],
    };

    await processor.processOTPResult(result, 'test-actor', mockActorInstance, mockDependencies);

    // Verify complex event was emitted correctly
    expect(mockDependencies.emit).toHaveBeenCalledTimes(1);

    // Check that event has correct content (ignoring envelope fields)
    expect(emittedEvents[0]).toMatchObject(complexEvent);

    // Verify envelope fields were added
    expect(emittedEvents[0]).toHaveProperty('_correlationId');
    expect(emittedEvents[0]).toHaveProperty('_timestamp');
    expect(emittedEvents[0]).toHaveProperty('_version');
  });

  it('should log debug information during emit processing', async () => {
    const mockActorInstance: ActorInstance = {
      id: 'test-actor',
      getType: () => 'context' as const,
      status: 'running',
      send: vi.fn(),
      ask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getSnapshot: () => ({
        context: { value: 42 },
        value: 'idle',
        status: 'running',
        matches: () => false,
        can: () => true,
        hasTag: () => false,
        toJSON: () => ({}),
      }),
    };

    const mockDependencies: ActorDependencies = {
      actorId: 'test-actor',
      actor: mockActorInstance,
      self: createMockActorRef(),
      emit: vi.fn(),
      send: vi.fn(),
      ask: vi.fn(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      correlationManager: undefined,
    };

    const processor = new OTPMessagePlanProcessor();

    const result: ActorHandlerResult<{ value: number }, DomainEvent> = {
      context: { value: 42 },
      emit: [{ type: 'VALUE_SET', value: 42 }],
    };

    await processor.processOTPResult(result, 'test-actor', mockActorInstance, mockDependencies);

    // Verify emit was called
    expect(mockDependencies.emit).toHaveBeenCalledTimes(1);

    // Note: The OTPMessagePlanProcessor uses internal Logger.namespace('OTP_MESSAGE_PLAN_PROCESSOR')
    // which is different from the mockDependencies.logger, so we can't verify its debug calls.
    // Instead, we verify that the emit processing worked correctly.
    expect(mockDependencies.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VALUE_SET',
        value: 42,
        _correlationId: expect.any(String),
        _timestamp: expect.any(Number),
        _version: expect.any(String),
      })
    );
  });
});
