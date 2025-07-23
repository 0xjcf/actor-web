/**
 * Guardian Actor Ask Pattern Tests
 *
 * Tests for the comprehensive ask pattern implementation that was fixed.
 * Previously, Guardian threw "Ask not implemented" errors for most message types.
 * Now it should handle all GuardianMessage types correctly.
 *
 * ✅ FRAMEWORK-STANDARD COMPLIANT: Zero `any` types, uses proper type guards
 */

import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorPID } from '../actor-system.js';
import {
  createGuardianActor,
  type GuardianContext,
  guardianBehavior,
} from '../actor-system-guardian';

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createTestContext(): GuardianContext {
  return {
    systemId: uuidv4(),
    startTime: Date.now(),
    actors: new Map(),
    children: new Set(),
    isShuttingDown: false,
    messageCount: 0,
  };
}

// ============================================================================
// RESPONSE TYPE DEFINITIONS - Following FRAMEWORK-STANDARD
// ============================================================================

interface SystemInfoResponse {
  systemId: string;
  startTime: number;
  actorCount: number;
  childCount: number;
  isShuttingDown: boolean;
  messageCount: number;
}

interface SpawnActorResponse {
  actorId: string;
  name: string;
  path: string;
}

interface StopActorResponse {
  success: boolean;
}

interface ActorFailedResponse {
  handled: boolean;
}

interface ShutdownResponse {
  success: boolean;
  finalStats: {
    systemId: string;
    actorCount: number;
    messageCount: number;
  };
}

interface RegistrationResponse {
  success: boolean;
}

interface HealthCheckResponse {
  healthy: boolean;
  systemId: string;
  uptime: number;
  actorCount: number;
  messageCount: number;
}

// ============================================================================
// TYPE GUARDS - Following FRAMEWORK-STANDARD (Zero type casting)
// ============================================================================

function hasProperty<K extends PropertyKey>(obj: unknown, prop: K): obj is Record<K, unknown> {
  return obj !== null && typeof obj === 'object' && prop in obj;
}

function isSystemInfoResponse(value: unknown): value is SystemInfoResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    hasProperty(value, 'systemId') &&
    hasProperty(value, 'startTime') &&
    hasProperty(value, 'actorCount') &&
    hasProperty(value, 'childCount') &&
    hasProperty(value, 'isShuttingDown') &&
    hasProperty(value, 'messageCount') &&
    typeof value.systemId === 'string' &&
    typeof value.startTime === 'number' &&
    typeof value.actorCount === 'number' &&
    typeof value.childCount === 'number' &&
    typeof value.isShuttingDown === 'boolean' &&
    typeof value.messageCount === 'number'
  );
}

function isSpawnActorResponse(value: unknown): value is SpawnActorResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    hasProperty(value, 'actorId') &&
    hasProperty(value, 'name') &&
    hasProperty(value, 'path') &&
    typeof value.actorId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.path === 'string'
  );
}

function isStopActorResponse(value: unknown): value is StopActorResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    hasProperty(value, 'success') &&
    typeof value.success === 'boolean'
  );
}

function isActorFailedResponse(value: unknown): value is ActorFailedResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    hasProperty(value, 'handled') &&
    typeof value.handled === 'boolean'
  );
}

function isShutdownResponse(value: unknown): value is ShutdownResponse {
  if (
    value === null ||
    typeof value !== 'object' ||
    !hasProperty(value, 'success') ||
    !hasProperty(value, 'finalStats') ||
    typeof value.success !== 'boolean'
  ) {
    return false;
  }

  const finalStats = value.finalStats;
  return (
    finalStats !== null &&
    typeof finalStats === 'object' &&
    hasProperty(finalStats, 'systemId') &&
    hasProperty(finalStats, 'actorCount') &&
    hasProperty(finalStats, 'messageCount') &&
    typeof finalStats.systemId === 'string' &&
    typeof finalStats.actorCount === 'number' &&
    typeof finalStats.messageCount === 'number'
  );
}

function isRegistrationResponse(value: unknown): value is RegistrationResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    hasProperty(value, 'success') &&
    typeof value.success === 'boolean'
  );
}

function isHealthCheckResponse(value: unknown): value is HealthCheckResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    hasProperty(value, 'healthy') &&
    hasProperty(value, 'systemId') &&
    hasProperty(value, 'uptime') &&
    hasProperty(value, 'actorCount') &&
    hasProperty(value, 'messageCount') &&
    typeof value.healthy === 'boolean' &&
    typeof value.systemId === 'string' &&
    typeof value.uptime === 'number' &&
    typeof value.actorCount === 'number' &&
    typeof value.messageCount === 'number'
  );
}

// ============================================================================
// TESTS - Type-safe without any casting
// ============================================================================

describe('Guardian Ask Pattern - Critical Fix Tests', () => {
  let guardian: ActorPID;
  let mockActorSystem: {
    spawn: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // ✅ CRITICAL: Reset Guardian behavior context for test isolation
    guardianBehavior.context = createTestContext();

    // Create mock actor system
    mockActorSystem = {
      spawn: vi.fn().mockResolvedValue({
        address: { id: 'mock-actor', type: 'test', node: 'local', path: '/test/mock-actor' },
        send: vi.fn(),
        ask: vi.fn(),
        stop: vi.fn(),
        isAlive: vi.fn().mockResolvedValue(true),
        getStats: vi.fn(),
        subscribe: vi.fn(),
      } satisfies ActorPID),
      stop: vi.fn().mockResolvedValue(void 0),
      send: vi.fn().mockResolvedValue(void 0),
    };

    guardian = await createGuardianActor(mockActorSystem);
  });

  describe('GET_SYSTEM_INFO Ask Pattern', () => {
    it('should return system information via ask', async () => {
      const response: unknown = await guardian.ask({
        type: 'GET_SYSTEM_INFO',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard instead of any casting
      expect(isSystemInfoResponse(response)).toBe(true);

      if (isSystemInfoResponse(response)) {
        // Now TypeScript knows the exact type
        expect(typeof response.systemId).toBe('string');
        expect(typeof response.startTime).toBe('number');
        expect(typeof response.actorCount).toBe('number');
        expect(typeof response.childCount).toBe('number');
        expect(typeof response.isShuttingDown).toBe('boolean');
        expect(typeof response.messageCount).toBe('number');

        // Test actual values
        expect(response.systemId).toBeDefined();
        expect(response.startTime).toBeGreaterThan(0);
        expect(response.actorCount).toBeGreaterThanOrEqual(0);
        expect(response.childCount).toBeGreaterThanOrEqual(0);
        expect(response.messageCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('SPAWN_ACTOR Ask Pattern', () => {
    it('should return spawn success response via ask', async () => {
      const response: unknown = await guardian.ask({
        type: 'SPAWN_ACTOR',
        payload: {
          name: 'test-actor-ask',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard
      expect(isSpawnActorResponse(response)).toBe(true);

      if (isSpawnActorResponse(response)) {
        expect(response.name).toBe('test-actor-ask');
        expect(response.path).toBe('/test-actor-ask');
        expect(response.actorId).toBeDefined();
        expect(typeof response.actorId).toBe('string');
      }
    });

    it('should throw error for invalid spawn payload via ask', async () => {
      await expect(
        guardian.ask({
          type: 'SPAWN_ACTOR',
          payload: null, // Invalid payload
          timestamp: Date.now(),
          version: '1.0.0',
        })
      ).rejects.toThrow('Guardian: Spawn failed');
    });
  });

  describe('STOP_ACTOR Ask Pattern', () => {
    it('should return stop success response via ask', async () => {
      // First spawn an actor to stop
      await guardian.ask({
        type: 'SPAWN_ACTOR',
        payload: { name: 'actor-to-stop' },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      const response: unknown = await guardian.ask({
        type: 'STOP_ACTOR',
        payload: {
          actorId: 'some-actor-id',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard
      expect(isStopActorResponse(response)).toBe(true);

      if (isStopActorResponse(response)) {
        expect(response.success).toBe(true);
      }
    });
  });

  describe('ACTOR_FAILED Ask Pattern', () => {
    it('should return failure handling response via ask', async () => {
      const response: unknown = await guardian.ask({
        type: 'ACTOR_FAILED',
        payload: {
          actorId: 'failed-actor',
          error: 'Test failure',
          directive: 'restart',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard
      expect(isActorFailedResponse(response)).toBe(true);

      if (isActorFailedResponse(response)) {
        expect(response.handled).toBe(true);
      }
    });
  });

  describe('SHUTDOWN Ask Pattern', () => {
    it('should return shutdown response with final stats via ask', async () => {
      const response: unknown = await guardian.ask({
        type: 'SHUTDOWN',
        payload: {
          reason: 'Test shutdown',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard
      expect(isShutdownResponse(response)).toBe(true);

      if (isShutdownResponse(response)) {
        expect(response.success).toBe(true);
        expect(response.finalStats).toBeDefined();

        const finalStats = response.finalStats;
        expect(typeof finalStats.systemId).toBe('string');
        expect(typeof finalStats.actorCount).toBe('number');
        expect(typeof finalStats.messageCount).toBe('number');
      }
    });
  });

  describe('REGISTER_ACTOR Ask Pattern', () => {
    it('should return registration success via ask', async () => {
      const response: unknown = await guardian.ask({
        type: 'REGISTER_ACTOR',
        payload: {
          actorId: 'test-actor',
          path: '/test/actor',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard
      expect(isRegistrationResponse(response)).toBe(true);

      if (isRegistrationResponse(response)) {
        expect(response.success).toBe(true);
      }
    });
  });

  describe('UNREGISTER_ACTOR Ask Pattern', () => {
    it('should return unregistration success via ask', async () => {
      const response: unknown = await guardian.ask({
        type: 'UNREGISTER_ACTOR',
        payload: {
          actorId: 'test-actor',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard
      expect(isRegistrationResponse(response)).toBe(true);

      if (isRegistrationResponse(response)) {
        expect(response.success).toBe(true);
      }
    });
  });

  describe('SYSTEM_HEALTH_CHECK Ask Pattern', () => {
    it('should return health check response via ask', async () => {
      const response: unknown = await guardian.ask({
        type: 'SYSTEM_HEALTH_CHECK',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: Use type guard
      expect(isHealthCheckResponse(response)).toBe(true);

      if (isHealthCheckResponse(response)) {
        expect(response.healthy).toBe(true);
        expect(typeof response.systemId).toBe('string');
        expect(typeof response.uptime).toBe('number');
        expect(typeof response.actorCount).toBe('number');
        expect(typeof response.messageCount).toBe('number');

        // Test actual values
        expect(response.systemId).toBeDefined();
        expect(response.uptime).toBeGreaterThanOrEqual(0);
        expect(response.actorCount).toBeGreaterThanOrEqual(0);
        expect(response.messageCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Invalid Message Types', () => {
    it('should throw error for unknown message types via ask', async () => {
      await expect(
        guardian.ask({
          type: 'UNKNOWN_MESSAGE_TYPE',
          payload: null,
          timestamp: Date.now(),
          version: '1.0.0',
        })
      ).rejects.toThrow('Guardian: Invalid message type for ask pattern');
    });

    it('should throw error for non-Guardian message types via ask', async () => {
      await expect(
        guardian.ask({
          type: 'RANDOM_USER_MESSAGE',
          payload: { data: 'test' },
          timestamp: Date.now(),
          version: '1.0.0',
        })
      ).rejects.toThrow('Guardian: Invalid message type for ask pattern');
    });
  });

  describe('Ask Pattern Edge Cases', () => {
    it('should handle ask pattern timeout scenarios gracefully', async () => {
      // Test with very short timeout - should either timeout or complete quickly
      const startTime = Date.now();

      try {
        await guardian.ask(
          {
            type: 'GET_SYSTEM_INFO',
            payload: null,
            timestamp: Date.now(),
            version: '1.0.0',
          },
          1
        ); // 1ms timeout

        // If it doesn't timeout, it should complete very quickly
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeLessThan(100); // Should be much faster than 100ms
      } catch (error) {
        // Should be a timeout error
        expect(error).toBeDefined();
      }
    });

    it('should maintain state consistency across multiple ask calls', async () => {
      // Multiple ask calls should not interfere with each other
      const promises = [
        guardian.ask({
          type: 'GET_SYSTEM_INFO',
          payload: null,
          timestamp: Date.now(),
          version: '1.0.0',
        }),
        guardian.ask({
          type: 'SYSTEM_HEALTH_CHECK',
          payload: null,
          timestamp: Date.now(),
          version: '1.0.0',
        }),
        guardian.ask({
          type: 'GET_SYSTEM_INFO',
          payload: null,
          timestamp: Date.now(),
          version: '1.0.0',
        }),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      });

      // System info results should be consistent
      const [info1, health, info2] = results;

      if (isSystemInfoResponse(info1) && isSystemInfoResponse(info2)) {
        expect(info1.systemId).toBe(info2.systemId);
        expect(info1.startTime).toBe(info2.startTime);
      }

      if (isHealthCheckResponse(health)) {
        expect(health.healthy).toBe(true);
      }
    });
  });
});
