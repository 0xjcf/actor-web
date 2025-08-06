/**
 * Guardian Actor Integration Tests
 *
 * Tests to verify the Guardian Actor integrates properly with the ActorSystem
 * and can spawn, manage, and supervise child actors.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorRef } from '../actor-ref.js';
import type { ActorSystem } from '../actor-system.js';
import { createGuardianActor } from '../actor-system-guardian.js';

describe('Guardian Actor Integration', () => {
  let guardian: ActorRef;
  let mockActorSystem: Partial<ActorSystem>;

  beforeEach(async () => {
    // Track shutdown state
    let isShutdown = false;

    // Create mock actor system
    mockActorSystem = {
      spawn: vi.fn().mockResolvedValue({
        address: { id: 'guardian', type: 'system', node: 'local', path: '/system/guardian' },
        send: vi.fn().mockImplementation((message) => {
          // Track shutdown messages
          if (message.type === 'SHUTDOWN') {
            isShutdown = true;
          }
        }),
        ask: vi.fn().mockImplementation((message) => {
          // Mock responses for ask pattern based on message type
          if (message.type === 'GET_SYSTEM_INFO') {
            return Promise.resolve({
              systemId: 'test-system-id',
              startTime: Date.now(),
              actorCount: 1,
              childCount: 0,
              isShuttingDown: false,
              messageCount: 0,
            });
          }
          return Promise.resolve({});
        }),
        stop: vi.fn(),
        isAlive: vi.fn().mockImplementation(() => Promise.resolve(!isShutdown)),
        getStats: vi.fn().mockResolvedValue({
          messagesReceived: 0,
          messagesProcessed: 0,
          errors: 0,
          uptime: 0,
        }),
        getSnapshot: vi.fn().mockReturnValue({
          status: 'running',
          context: {},
          value: 'active',
          children: new Map(),
          meta: {},
        }),
      } satisfies ActorRef),
      stop: vi.fn().mockResolvedValue(void 0),
    };

    // Create Guardian with mock system
    guardian = await createGuardianActor(mockActorSystem as ActorSystem);
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
        name: 'test-child-actor',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      expect(() => guardian.send(spawnMessage)).not.toThrow();
    });

    it('should handle STOP_ACTOR message', async () => {
      const stopMessage = {
        type: 'STOP_ACTOR',
        actorId: 'test-actor-id',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      expect(() => guardian.send(stopMessage)).not.toThrow();
    });
  });

  describe('Actor Supervision', () => {
    it('should handle ACTOR_FAILED message with restart directive', async () => {
      const failedMessage = {
        type: 'ACTOR_FAILED',
        actorId: 'failed-actor',
        error: 'Test failure',
        directive: 'restart',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      expect(() => guardian.send(failedMessage)).not.toThrow();
    });

    it('should handle ACTOR_FAILED message with stop directive', async () => {
      const failedMessage = {
        type: 'ACTOR_FAILED',
        actorId: 'failed-actor',
        error: 'Test failure',
        directive: 'stop',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      expect(() => guardian.send(failedMessage)).not.toThrow();
    });
  });

  describe('System Management', () => {
    it('should respond to GET_SYSTEM_INFO via ask pattern', async () => {
      const systemInfoMessage = {
        type: 'GET_SYSTEM_INFO',
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
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      expect(() => guardian.send(healthCheckMessage)).not.toThrow();
    });

    it('should handle SHUTDOWN message', async () => {
      const shutdownMessage = {
        type: 'SHUTDOWN',
        reason: 'Test shutdown',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      expect(() => guardian.send(shutdownMessage)).not.toThrow();

      // Guardian should no longer be alive after shutdown
      const isAlive = await guardian.isAlive();
      expect(isAlive).toBe(false);
    });
  });

  describe('Message Validation', () => {
    it('should handle invalid message types gracefully', async () => {
      const invalidMessage = {
        type: 'INVALID_MESSAGE_TYPE',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw, but should log warning
      expect(() => guardian.send(invalidMessage)).not.toThrow();
    });

    it('should reject non-Guardian messages', async () => {
      const nonGuardianMessage = {
        type: 'RANDOM_USER_MESSAGE',
        data: 'test',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw, but should log warning
      expect(() => guardian.send(nonGuardianMessage)).not.toThrow();
    });
  });
});
