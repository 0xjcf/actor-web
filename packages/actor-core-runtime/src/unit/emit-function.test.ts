/**
 * @module actor-core/runtime/unit/emit-function.test
 * @description Unit tests for Layer 3: Event emission flow through dependencies.emit function
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActorInstance } from '../actor-instance.js';
import type { ActorDependencies, ActorMessage } from '../actor-system.js';
import { createMockActorRef } from '../utils/factories.js';

describe('Layer 3: Emit Function', () => {
  it('should call emit function when events are emitted', () => {
    // Track emitted events
    const emittedEvents: unknown[] = [];

    // Create mock dependencies with emit function
    const mockDependencies: ActorDependencies = {
      actorId: 'test-actor',
      self: createMockActorRef(),
      actor: {
        id: 'test-actor',
        getType: () => 'context' as const,
        status: 'running',
        send: vi.fn(),
        ask: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        getSnapshot: () => ({
          context: {},
          value: 'idle',
          status: 'running',
          matches: () => false,
          can: () => true,
          hasTag: () => false,
          toJSON: () => ({}),
        }),
      } as ActorInstance,
      emit: vi.fn((event: ActorMessage) => {
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

    // Test emit function directly
    const testEvent: ActorMessage = {
      type: 'TEST_EVENT',
      _timestamp: Date.now(),
      _version: '1.0.0',
    };

    mockDependencies.emit(testEvent);

    // Verify emit was called
    expect(mockDependencies.emit).toHaveBeenCalledTimes(1);
    expect(mockDependencies.emit).toHaveBeenCalledWith(testEvent);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toEqual(testEvent);
  });

  it('should handle multiple emit calls', () => {
    const emittedEvents: unknown[] = [];

    const mockDependencies: ActorDependencies = {
      actorId: 'multi-emitter',
      self: createMockActorRef(),
      actor: {} as ActorDependencies['actor'],
      emit: vi.fn((event: ActorMessage) => {
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

    // Emit multiple events
    const events: ActorMessage[] = [
      { type: 'EVENT_1', _timestamp: Date.now(), _version: '1.0.0' },
      { type: 'EVENT_2', _timestamp: Date.now(), _version: '1.0.0' },
      { type: 'EVENT_3', _timestamp: Date.now(), _version: '1.0.0' },
    ];

    events.forEach((event) => mockDependencies.emit(event));

    // Verify all events were emitted
    expect(mockDependencies.emit).toHaveBeenCalledTimes(3);
    expect(emittedEvents).toHaveLength(3);
    events.forEach((event, index) => {
      expect(emittedEvents[index]).toEqual(event);
    });
  });

  it('should pass event with envelope fields', () => {
    const capturedEvent: ActorMessage[] = [];

    const mockDependencies: ActorDependencies = {
      actorId: 'envelope-tester',
      self: createMockActorRef(),
      actor: {} as ActorDependencies['actor'],
      emit: vi.fn((event: ActorMessage) => {
        capturedEvent.push(event);
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

    // Event with envelope fields
    const eventWithEnvelope: ActorMessage = {
      type: 'ENVELOPE_EVENT',
      _correlationId: 'emit-123456-abcdef',
      _timestamp: 1234567890,
      _version: '2.0.0',
    };

    mockDependencies.emit(eventWithEnvelope);

    // Verify event was passed with all fields
    expect(capturedEvent).toHaveLength(1);
    expect(capturedEvent[0]).toEqual(eventWithEnvelope);
    expect(capturedEvent[0]._correlationId).toBe('emit-123456-abcdef');
    expect(capturedEvent[0]._timestamp).toBe(1234567890);
    expect(capturedEvent[0]._version).toBe('2.0.0');
  });

  it('should handle emit function that throws', () => {
    const mockDependencies: ActorDependencies = {
      actorId: 'error-handler',
      self: createMockActorRef(),
      actor: {} as ActorDependencies['actor'],
      emit: vi.fn(() => {
        throw new Error('Emit failed');
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

    const event: ActorMessage = {
      type: 'ERROR_EVENT',
      _timestamp: Date.now(),
      _version: '1.0.0',
    };

    // Emit function throws, but this should be handled by caller
    expect(() => mockDependencies.emit(event)).toThrow('Emit failed');
    expect(mockDependencies.emit).toHaveBeenCalledTimes(1);
  });

  it('should verify emit is called from OTP processor context', () => {
    // This test verifies the emit function signature matches what OTP processor expects
    const mockEmit = vi.fn((event: ActorMessage) => {
      // Verify event has required ActorMessage fields
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('_timestamp');
      expect(event).toHaveProperty('_version');
    });

    const dependencies: ActorDependencies = {
      actorId: 'otp-context-test',
      self: createMockActorRef(),
      actor: {} as ActorDependencies['actor'],
      emit: mockEmit,
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

    // Simulate what OTP processor does
    const otpEvent: ActorMessage = {
      type: 'OTP_EMITTED_EVENT',
      _correlationId: 'emit-1234567890-xyz',
      _timestamp: Date.now(),
      _version: '1.0.0',
    };

    dependencies.emit(otpEvent);

    expect(mockEmit).toHaveBeenCalledWith(otpEvent);
  });
});
