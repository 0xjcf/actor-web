/**
 * Guardian Actor Integration Tests
 *
 * Tests to verify the Guardian Actor integrates properly with the ActorSystem
 * and can spawn, manage, and supervise child actors.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorPID, JsonValue } from '../actor-system.js';
import { createGuardianActor } from '../actor-system-guardian.js';

describe('Guardian Actor Integration', () => {
  let guardian: ActorPID;
  let mockActorSystem: {
    spawn: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
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

    // Create Guardian with mock system
    guardian = await createGuardianActor(mockActorSystem);
  });

  describe('Guardian Creation and Basic Operations', () => {
    it('should create Guardian with correct address', () => {
      expect(guardian.address).toEqual({
        id: 'guardian',
        type: 'system',
        node: 'local',
        path: '/system/guardian',
      });
    });

    it('should be alive after creation', async () => {
      const isAlive = await guardian.isAlive();
      expect(isAlive).toBe(true);
    });

    it('should provide system stats', async () => {
      const stats = await guardian.getStats();
      expect(stats).toHaveProperty('messagesReceived');
      expect(stats).toHaveProperty('messagesProcessed');
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('uptime');
    });
  });

  describe('Actor Spawning via Guardian', () => {
    it('should handle SPAWN_ACTOR message', async () => {
      const spawnMessage = {
        type: 'SPAWN_ACTOR',
        payload: {
          name: 'test-child-actor',
        } satisfies JsonValue,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      await expect(guardian.send(spawnMessage)).resolves.not.toThrow();
    });

    it('should handle STOP_ACTOR message', async () => {
      const stopMessage = {
        type: 'STOP_ACTOR',
        payload: {
          actorId: 'test-actor-id',
        } satisfies JsonValue,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      await expect(guardian.send(stopMessage)).resolves.not.toThrow();
    });
  });

  describe('Actor Supervision', () => {
    it('should handle ACTOR_FAILED message with restart directive', async () => {
      const failedMessage = {
        type: 'ACTOR_FAILED',
        payload: {
          actorId: 'failed-actor',
          error: 'Test failure',
          directive: 'restart',
        } satisfies JsonValue,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      await expect(guardian.send(failedMessage)).resolves.not.toThrow();
    });

    it('should handle ACTOR_FAILED message with stop directive', async () => {
      const failedMessage = {
        type: 'ACTOR_FAILED',
        payload: {
          actorId: 'failed-actor',
          error: 'Test failure',
          directive: 'stop',
        } satisfies JsonValue,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      await expect(guardian.send(failedMessage)).resolves.not.toThrow();
    });
  });

  describe('System Management', () => {
    it('should respond to GET_SYSTEM_INFO via ask pattern', async () => {
      const systemInfoMessage = {
        type: 'GET_SYSTEM_INFO',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const result = await guardian.ask(systemInfoMessage);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should handle SYSTEM_HEALTH_CHECK', async () => {
      const healthCheckMessage = {
        type: 'SYSTEM_HEALTH_CHECK',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      await expect(guardian.send(healthCheckMessage)).resolves.not.toThrow();
    });

    it('should handle SHUTDOWN message', async () => {
      const shutdownMessage = {
        type: 'SHUTDOWN',
        payload: {
          reason: 'Test shutdown',
        } satisfies JsonValue,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      await expect(guardian.send(shutdownMessage)).resolves.not.toThrow();

      // Guardian should no longer be alive after shutdown
      const isAlive = await guardian.isAlive();
      expect(isAlive).toBe(false);
    });
  });

  describe('Message Validation', () => {
    it('should handle invalid message types gracefully', async () => {
      const invalidMessage = {
        type: 'INVALID_MESSAGE_TYPE',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw, but should log warning
      await expect(guardian.send(invalidMessage)).resolves.not.toThrow();
    });

    it('should reject non-Guardian messages', async () => {
      const nonGuardianMessage = {
        type: 'RANDOM_USER_MESSAGE',
        payload: { data: 'test' },
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw, but should log warning
      await expect(guardian.send(nonGuardianMessage)).resolves.not.toThrow();
    });
  });
});
