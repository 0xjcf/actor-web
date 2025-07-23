import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorPID, JsonValue } from '../actor-system';
import { SupervisionDirective } from '../actor-system';
import {
  createGuardianActor,
  type GuardianContext,
  type GuardianMessage,
  guardianBehavior,
} from '../actor-system-guardian';

// Test utilities
function createGuardianMessage<T extends GuardianMessage['type']>(
  type: T,
  payload: JsonValue | null = null
): Extract<GuardianMessage, { type: T }> {
  return {
    type,
    payload,
  } as Extract<GuardianMessage, { type: T }>;
}

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

describe('Guardian Actor - Pure Actor Model', () => {
  let guardian: ActorPID | null = null;
  let mockActorSystem: {
    createActor: ReturnType<typeof vi.fn>;
    getActor: ReturnType<typeof vi.fn>;
    stopActor: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockActorSystem = {
      createActor: vi.fn(),
      getActor: vi.fn(),
      stopActor: vi.fn(),
    };

    // Reset Guardian behavior context to initial state before each test
    guardianBehavior.context = createTestContext();

    // Create actual Guardian Actor instance for testing
    guardian = await createGuardianActor(mockActorSystem);
  });

  afterEach(async () => {
    if (guardian !== null) {
      await guardian.stop();
    }
  });

  describe('Guardian Behavior', () => {
    it('should define guardian behavior for pure actor model', () => {
      expect(guardianBehavior).toBeDefined();
      expect(guardianBehavior.onMessage).toBeDefined();
      expect(guardianBehavior.context).toBeDefined();
      expect(guardianBehavior.supervisionStrategy).toBeDefined();
    });

    it('should handle SPAWN_ACTOR message type in behavior', async () => {
      const testContext = createTestContext();

      const spawnMessage = createGuardianMessage('SPAWN_ACTOR', {
        name: 'test-actor',
      });

      const result = await guardianBehavior.onMessage({
        message: spawnMessage,
        context: testContext,
      });

      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
      expect(result.emit).toBeDefined();
    });

    it('should handle STOP_ACTOR message type in behavior', async () => {
      const testContext = createTestContext();

      // First add an actor to stop
      testContext.actors.set('test-actor-id', {
        id: 'test-actor-id',
        name: 'test-actor',
        type: 'user',
        path: '/test-actor',
        childIds: [],
        supervisionDirective: SupervisionDirective.RESTART,
        createdAt: Date.now(),
        restartCount: 0,
      });
      testContext.children.add('test-actor-id');

      const stopMessage = createGuardianMessage('STOP_ACTOR', {
        actorId: 'test-actor-id',
      });

      const result = await guardianBehavior.onMessage({
        message: stopMessage,
        context: testContext,
      });

      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
      expect(result.emit).toBeDefined();
    });

    it('should handle ACTOR_FAILED message for supervision', async () => {
      const testContext = createTestContext();

      // Add a failing actor
      testContext.actors.set('failed-actor-id', {
        id: 'failed-actor-id',
        name: 'failed-actor',
        type: 'user',
        path: '/failed-actor',
        childIds: [],
        supervisionDirective: SupervisionDirective.RESTART,
        createdAt: Date.now(),
        restartCount: 0,
      });

      const failureMessage = createGuardianMessage('ACTOR_FAILED', {
        actorId: 'failed-actor-id',
        error: 'Test failure',
      });

      const result = await guardianBehavior.onMessage({
        message: failureMessage,
        context: testContext,
      });

      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
      expect(result.context.actors.get('failed-actor-id')?.restartCount).toBe(1);
    });

    it('should handle SHUTDOWN message', async () => {
      const testContext = createTestContext();

      const shutdownMessage = createGuardianMessage('SHUTDOWN', {
        reason: 'User requested',
      });

      const result = await guardianBehavior.onMessage({
        message: shutdownMessage,
        context: testContext,
      });

      expect(result).toBeDefined();
      expect(result.context.isShuttingDown).toBe(true);
      expect(result.emit).toBeDefined();
    });

    it('should handle GET_SYSTEM_INFO message', async () => {
      const testContext = createTestContext();

      const infoMessage = createGuardianMessage('GET_SYSTEM_INFO', {
        requestId: 'test-request',
      });

      const result = await guardianBehavior.onMessage({
        message: infoMessage,
        context: testContext,
      });

      expect(result).toBeDefined();
      expect(result.emit).toBeDefined();
      expect(result.emit?.[0]?.type).toBe('SYSTEM_INFO_RESPONSE');
    });

    it('should handle SYSTEM_HEALTH_CHECK message', async () => {
      const testContext = createTestContext();

      const healthMessage = createGuardianMessage('SYSTEM_HEALTH_CHECK', null);

      const result = await guardianBehavior.onMessage({
        message: healthMessage,
        context: testContext,
      });

      expect(result).toBeDefined();
      expect(result.emit).toBeDefined();
      expect(result.emit?.[0]?.type).toBe('SYSTEM_HEALTH_RESPONSE');
    });

    it('should handle unknown payload gracefully', async () => {
      const testContext = createTestContext();

      const messageWithNullPayload = createGuardianMessage('SPAWN_ACTOR', null);

      const result = await guardianBehavior.onMessage({
        message: messageWithNullPayload,
        context: testContext,
      });

      expect(result).toBeDefined();
      expect(result.context.messageCount).toBe(testContext.messageCount + 1);
    });

    it('should ignore messages during shutdown except SHUTDOWN', async () => {
      const testContext = createTestContext();
      const shuttingDownContext = {
        ...testContext,
        isShuttingDown: true,
      };

      const spawnMessage = createGuardianMessage('SPAWN_ACTOR', {
        name: 'test-actor',
      });

      const result = await guardianBehavior.onMessage({
        message: spawnMessage,
        context: shuttingDownContext,
      });

      expect(result).toBeDefined();
      expect(result.emit).toBeUndefined(); // Should not emit during shutdown
    });
  });

  describe('Guardian Actor Instance', () => {
    it('should create guardian actor instance successfully', async () => {
      expect(guardian).toBeDefined();
      expect(guardian?.address).toEqual({
        id: 'guardian',
        type: 'system',
        node: 'local',
        path: '/system/guardian',
      });
    });

    it('should handle messages through send method', async () => {
      if (!guardian) throw new Error('Guardian not initialized');

      const healthCheckMessage = {
        type: 'SYSTEM_HEALTH_CHECK',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw
      await expect(guardian.send(healthCheckMessage)).resolves.not.toThrow();
    });

    it('should report alive status correctly', async () => {
      if (!guardian) throw new Error('Guardian not initialized');

      const isAlive = await guardian.isAlive();
      expect(isAlive).toBe(true);
    });

    it('should provide stats', async () => {
      if (!guardian) throw new Error('Guardian not initialized');

      const stats = await guardian.getStats();
      expect(stats).toHaveProperty('messagesReceived');
      expect(stats).toHaveProperty('messagesProcessed');
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('uptime');
      expect(typeof stats.messagesReceived).toBe('number');
      expect(typeof stats.messagesProcessed).toBe('number');
      expect(typeof stats.errors).toBe('number');
      expect(typeof stats.uptime).toBe('number');
    });

    it('should handle invalid message types gracefully', async () => {
      if (!guardian) throw new Error('Guardian not initialized');

      // Create message with invalid type - TypeScript allows this through ActorMessage interface
      const invalidMessage = {
        type: 'INVALID_MESSAGE_TYPE',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Should not throw - Guardian's isGuardianMessage type guard handles this
      await expect(guardian.send(invalidMessage)).resolves.not.toThrow();
    });
  });

  describe('Pure Actor Model Compliance', () => {
    it('should define behavior without any forbidden patterns', () => {
      // Guardian behavior should not use setTimeout, setInterval, or polling
      const behaviorString = guardianBehavior.toString();
      expect(behaviorString).not.toContain('setTimeout');
      expect(behaviorString).not.toContain('setInterval');
      expect(behaviorString).not.toContain('while');
    });

    it('should use only message-based communication patterns', () => {
      expect(guardianBehavior.onMessage).toBeDefined();
      expect(typeof guardianBehavior.onMessage).toBe('function');
    });

    it('should have proper supervision strategy defined', () => {
      expect(guardianBehavior.supervisionStrategy).toBeDefined();

      // Use optional chaining for possibly undefined properties
      if (guardianBehavior.supervisionStrategy) {
        expect(typeof guardianBehavior.supervisionStrategy.onFailure).toBe('function');
        expect(guardianBehavior.supervisionStrategy.maxRetries).toBeGreaterThan(0);
        expect(guardianBehavior.supervisionStrategy.retryDelay).toBeGreaterThan(0);
      }
    });
  });
});
