/**
 * @module actor-core/runtime/tests/capability-security.test
 * @description Tests for capability-based security model
 *
 * These tests verify that the capability system provides fine-grained
 * security without ACL overhead. This is critical for protecting actors
 * from unauthorized access while enabling flexible permission delegation.
 *
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorRef } from '../actor-ref.js';
import {
  type Capability,
  type CapabilityGrantRequest,
  type CapabilityRegistry,
  InMemoryCapabilityRegistry,
  PermissionDeniedError,
  SecureActorProxy,
  SecurityError,
  SecurityMiddleware,
  SecurityUtils,
  createCapabilityRegistry,
  createSecureActor,
  createSecurityMiddleware,
} from '../capability-security.js';
import type { BaseEventObject } from '../types.js';

// Mock actor for testing
function createMockActor(id: string): ActorRef<BaseEventObject> {
  return {
    id,
    status: 'running',
    send: vi.fn(),
    ask: vi.fn().mockResolvedValue({ success: true }),
    start: vi.fn(),
    stop: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue({ value: 'idle', context: {} }),
  } as unknown as ActorRef<BaseEventObject>;
}

describe('Capability-Based Security Model', () => {
  let registry: CapabilityRegistry;
  let mockActor: ActorRef<BaseEventObject>;
  let testCapabilities: Capability<unknown>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    registry = createCapabilityRegistry();
    mockActor = createMockActor('test-actor');
    testCapabilities = [];
  });

  afterEach(async () => {
    // ✅ CORRECT: Proper cleanup prevents memory leaks
    for (const capability of testCapabilities) {
      capability.revoke();
    }
    testCapabilities = [];
    await registry.cleanup();
  });

  describe('InMemoryCapabilityRegistry', () => {
    it('should grant capabilities with proper permissions', async () => {
      // Arrange
      const request: CapabilityGrantRequest = {
        actorId: 'test-actor',
        permissions: ['read', 'write'],
        grantedBy: 'admin',
        expiresAt: Date.now() + 60000, // 1 minute
      };

      // Act
      const capability = await registry.grant(request);
      testCapabilities.push(capability);

      // Assert
      expect(capability.id).toBeDefined();
      expect(capability.permissions).toEqual(['read', 'write']);
      expect(capability.can('read')).toBe(true);
      expect(capability.can('write')).toBe(true);
      expect(capability.can('admin')).toBe(false);
      expect(capability.isValid()).toBe(true);
    });

    it('should revoke capabilities correctly', async () => {
      // Arrange
      const request: CapabilityGrantRequest = {
        actorId: 'test-actor',
        permissions: ['read'],
        grantedBy: 'admin',
      };
      const capability = await registry.grant(request);
      testCapabilities.push(capability);

      // Act
      await registry.revoke(capability.id);

      // Assert
      expect(capability.isValid()).toBe(false);
      await expect(registry.validate(capability.id)).resolves.toBe(false);
    });

    it('should get capabilities for an actor', async () => {
      // Arrange
      const request1: CapabilityGrantRequest = {
        actorId: 'test-actor',
        permissions: ['read'],
        grantedBy: 'admin',
      };
      const request2: CapabilityGrantRequest = {
        actorId: 'test-actor',
        permissions: ['write'],
        grantedBy: 'admin',
      };

      const cap1 = await registry.grant(request1);
      const cap2 = await registry.grant(request2);
      testCapabilities.push(cap1, cap2);

      // Act
      const capabilities = await registry.getCapabilities('test-actor');

      // Assert
      expect(capabilities).toHaveLength(2);
      expect(capabilities.some((c) => c.can('read'))).toBe(true);
      expect(capabilities.some((c) => c.can('write'))).toBe(true);
    });

    it('should cleanup expired capabilities', async () => {
      // Arrange
      const expiredRequest: CapabilityGrantRequest = {
        actorId: 'test-actor',
        permissions: ['read'],
        grantedBy: 'admin',
        expiresAt: Date.now() - 1000, // Already expired
      };
      const validRequest: CapabilityGrantRequest = {
        actorId: 'test-actor',
        permissions: ['write'],
        grantedBy: 'admin',
        expiresAt: Date.now() + 60000, // Valid for 1 minute
      };

      const expiredCap = await registry.grant(expiredRequest);
      const validCap = await registry.grant(validRequest);
      testCapabilities.push(expiredCap, validCap);

      // Act
      await registry.cleanup();

      // Assert
      expect(await registry.validate(expiredCap.id)).toBe(false);
      expect(await registry.validate(validCap.id)).toBe(true);
    });

    it('should provide registry statistics', async () => {
      // Arrange
      const registryImpl = registry as InMemoryCapabilityRegistry;
      const request: CapabilityGrantRequest = {
        actorId: 'test-actor',
        permissions: ['read'],
        grantedBy: 'admin',
      };

      // Act
      const capability = await registry.grant(request);
      testCapabilities.push(capability);
      const stats = registryImpl.getStats();

      // Assert
      expect(stats.totalCapabilities).toBe(1);
      expect(stats.activeCapabilities).toBe(1);
      expect(stats.expiredCapabilities).toBe(0);
      expect(stats.actorsWithCapabilities).toBe(1);
    });
  });

  describe('SecureActorProxy', () => {
    let secureProxy: SecureActorProxy<any>;

    beforeEach(() => {
      secureProxy = new SecureActorProxy('test-cap-1', mockActor, ['read', 'write.data'], {
        grantedBy: 'admin',
        grantedAt: Date.now(),
      });
      testCapabilities.push(secureProxy);
    });

    it('should allow operations with granted permissions', async () => {
      // Arrange
      expect(secureProxy.can('read')).toBe(true);
      expect(secureProxy.can('write.data')).toBe(true);

      // Act & Assert - Should not throw
      await expect(secureProxy.invoke('read')).resolves.toBeDefined();
    });

    it('should deny operations without permissions', async () => {
      // Arrange
      expect(secureProxy.can('admin')).toBe(false);

      // Act & Assert - Should throw permission denied
      await expect(secureProxy.invoke('admin')).rejects.toThrow(PermissionDeniedError);
    });

    it('should handle wildcard permissions', async () => {
      // Arrange
      const wildcardProxy = new SecureActorProxy('test-cap-2', mockActor, ['*'], {
        grantedBy: 'admin',
        grantedAt: Date.now(),
      });
      testCapabilities.push(wildcardProxy);

      // Act & Assert
      expect(wildcardProxy.can('read')).toBe(true);
      expect(wildcardProxy.can('write')).toBe(true);
      expect(wildcardProxy.can('admin')).toBe(true);
      expect(wildcardProxy.can('any.operation')).toBe(true);
    });

    it('should handle pattern-based permissions', async () => {
      // Arrange
      const patternProxy = new SecureActorProxy('test-cap-3', mockActor, ['read.*', 'write.data'], {
        grantedBy: 'admin',
        grantedAt: Date.now(),
      });
      testCapabilities.push(patternProxy);

      // Act & Assert
      expect(patternProxy.can('read.user')).toBe(true);
      expect(patternProxy.can('read.config')).toBe(true);
      expect(patternProxy.can('write.data')).toBe(true);
      expect(patternProxy.can('write.config')).toBe(false);
      expect(patternProxy.can('admin')).toBe(false);
    });

    it('should handle capability expiration', async () => {
      // Arrange
      const expiredProxy = new SecureActorProxy('test-cap-4', mockActor, ['read'], {
        grantedBy: 'admin',
        grantedAt: Date.now() - 2000,
        expiresAt: Date.now() - 1000, // Already expired
      });
      testCapabilities.push(expiredProxy);

      // Act & Assert
      expect(expiredProxy.isValid()).toBe(false);
      await expect(expiredProxy.invoke('read')).rejects.toThrow(SecurityError);
    });

    it('should handle revoked capabilities', async () => {
      // Arrange
      expect(secureProxy.isValid()).toBe(true);

      // Act
      secureProxy.revoke();

      // Assert
      expect(secureProxy.isValid()).toBe(false);
      expect(secureProxy.can('read')).toBe(false);
      await expect(secureProxy.invoke('read')).rejects.toThrow(SecurityError);
    });

    it('should handle stopped actor subjects', async () => {
      // Arrange
      const stoppedActor = createMockActor('stopped-actor');
      stoppedActor.status = 'stopped';

      const proxy = new SecureActorProxy('test-cap-5', stoppedActor, ['read'], {
        grantedBy: 'admin',
        grantedAt: Date.now(),
      });
      testCapabilities.push(proxy);

      // Act & Assert
      expect(proxy.isValid()).toBe(false);
      await expect(proxy.invoke('read')).rejects.toThrow(SecurityError);
    });
  });

  describe('SecurityUtils', () => {
    it('should create read-only capabilities', async () => {
      // Act
      const capability = await SecurityUtils.createReadOnlyCapability(
        registry,
        'test-actor',
        'admin'
      );
      testCapabilities.push(capability);

      // Assert
      expect(capability.can('read.data')).toBe(true);
      expect(capability.can('read.config')).toBe(true);
      expect(capability.can('write.data')).toBe(false);
      expect(capability.can('admin')).toBe(false);
    });

    it('should create admin capabilities', async () => {
      // Act
      const capability = await SecurityUtils.createAdminCapability(
        registry,
        'test-actor',
        'superadmin'
      );
      testCapabilities.push(capability);

      // Assert
      expect(capability.can('read')).toBe(true);
      expect(capability.can('write')).toBe(true);
      expect(capability.can('admin')).toBe(true);
      expect(capability.can('delete')).toBe(true);
    });

    it('should create time-limited capabilities', async () => {
      // Act
      const capability = await SecurityUtils.createTimeLimitedCapability(
        registry,
        'test-actor',
        ['read'],
        'admin',
        100 // 100ms
      );
      testCapabilities.push(capability);

      // Assert
      expect(capability.isValid()).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(capability.isValid()).toBe(false);
    });

    it('should create constrained capabilities', async () => {
      // Act
      const capability = await SecurityUtils.createConstrainedCapability(
        registry,
        'test-actor',
        ['read'],
        'admin',
        { maxRequests: 10, ipAddress: '127.0.0.1' }
      );
      testCapabilities.push(capability);

      // Assert
      expect(capability.isValid()).toBe(true);
      expect(capability.metadata?.constraints).toEqual({
        maxRequests: 10,
        ipAddress: '127.0.0.1',
      });
    });

    it('should validate capability operations', async () => {
      // Arrange
      const validCap = await registry.grant({
        actorId: 'test-actor',
        permissions: ['read'],
        grantedBy: 'admin',
      });
      const expiredCap = await registry.grant({
        actorId: 'test-actor',
        permissions: ['write'],
        grantedBy: 'admin',
        expiresAt: Date.now() - 1000,
      });
      testCapabilities.push(validCap, expiredCap);

      // Act & Assert
      expect(SecurityUtils.canPerformOperation(validCap, 'read')).toBe(true);
      expect(SecurityUtils.canPerformOperation(validCap, 'write')).toBe(false);
      expect(SecurityUtils.canPerformOperation(expiredCap, 'write')).toBe(false);
    });

    it('should validate multiple capabilities', async () => {
      // Arrange
      const readCap = await registry.grant({
        actorId: 'test-actor',
        permissions: ['read'],
        grantedBy: 'admin',
      });
      const writeCap = await registry.grant({
        actorId: 'test-actor',
        permissions: ['write'],
        grantedBy: 'admin',
      });
      testCapabilities.push(readCap, writeCap);

      // Act & Assert
      expect(SecurityUtils.validateCapabilities([readCap, writeCap], 'read')).toBe(true);
      expect(SecurityUtils.validateCapabilities([readCap, writeCap], 'write')).toBe(true);
      expect(SecurityUtils.validateCapabilities([readCap, writeCap], 'admin')).toBe(false);
    });
  });

  describe('SecurityMiddleware', () => {
    let middleware: SecurityMiddleware;

    beforeEach(() => {
      middleware = createSecurityMiddleware(registry);
    });

    it('should check permissions for messages with capability IDs', async () => {
      // Arrange
      const capability = await registry.grant({
        actorId: 'test-actor',
        permissions: ['read'],
        grantedBy: 'admin',
      });
      testCapabilities.push(capability);

      const message = {
        type: 'READ_DATA',
        capabilityId: capability.id,
      };

      // Act
      const hasPermission = await middleware.checkPermissions(message, 'read');

      // Assert
      expect(hasPermission).toBe(true);
    });

    it('should deny messages without capability IDs', async () => {
      // Arrange
      const message = {
        type: 'READ_DATA',
      };

      // Act
      const hasPermission = await middleware.checkPermissions(message, 'read');

      // Assert
      expect(hasPermission).toBe(false);
    });

    it('should deny messages with invalid capability IDs', async () => {
      // Arrange
      const message = {
        type: 'READ_DATA',
        capabilityId: 'invalid-capability-id',
      };

      // Act
      const hasPermission = await middleware.checkPermissions(message, 'read');

      // Assert
      expect(hasPermission).toBe(false);
    });

    it('should create secure actor wrappers', async () => {
      // Act
      const secureWrapper = middleware.secureActor(mockActor);

      // Assert
      expect(secureWrapper).toBeDefined();
      expect(typeof secureWrapper.secureInvoke).toBe('function');
    });
  });

  describe('Factory Functions', () => {
    it('should create capability registry', () => {
      // Act
      const newRegistry = createCapabilityRegistry();

      // Assert
      expect(newRegistry).toBeInstanceOf(InMemoryCapabilityRegistry);
    });

    it('should create capability registry with virtual actor system', () => {
      // Arrange
      const mockVirtualActorSystem = {} as any;

      // Act
      const newRegistry = createCapabilityRegistry(mockVirtualActorSystem);

      // Assert
      expect(newRegistry).toBeInstanceOf(InMemoryCapabilityRegistry);
    });

    it('should create security middleware', () => {
      // Act
      const newMiddleware = createSecurityMiddleware();

      // Assert
      expect(newMiddleware).toBeInstanceOf(SecurityMiddleware);
    });

    it('should create secure actor with custom permissions', () => {
      // Act
      const secureActor = createSecureActor(mockActor, ['read', 'write'], 'admin', {
        expiresAt: Date.now() + 60000,
        constraints: { maxRequests: 100 },
      });
      testCapabilities.push(secureActor);

      // Assert
      expect(secureActor).toBeInstanceOf(SecureActorProxy);
      expect(secureActor.permissions).toEqual(['read', 'write']);
      expect(secureActor.can('read')).toBe(true);
      expect(secureActor.can('write')).toBe(true);
      expect(secureActor.can('admin')).toBe(false);
      expect(secureActor.metadata?.constraints).toEqual({ maxRequests: 100 });
    });
  });

  describe('Error Handling', () => {
    it('should throw SecurityError for invalid capabilities', async () => {
      // Arrange
      const invalidProxy = new SecureActorProxy('invalid-cap', mockActor, ['read'], {
        grantedBy: 'admin',
        grantedAt: Date.now(),
        expiresAt: Date.now() - 1000, // Already expired
      });
      testCapabilities.push(invalidProxy);

      // Act & Assert
      await expect(invalidProxy.invoke('read')).rejects.toThrow(SecurityError);
    });

    it('should throw PermissionDeniedError for unauthorized operations', async () => {
      // Arrange
      const limitedProxy = new SecureActorProxy('limited-cap', mockActor, ['read'], {
        grantedBy: 'admin',
        grantedAt: Date.now(),
      });
      testCapabilities.push(limitedProxy);

      // Act & Assert
      await expect(limitedProxy.invoke('write')).rejects.toThrow(PermissionDeniedError);
    });

    it('should handle capability not found scenarios', async () => {
      // Act & Assert
      await expect(registry.revoke('non-existent-capability')).rejects.toThrow(
        'Capability non-existent-capability not found'
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complex permission scenarios', async () => {
      // Arrange - Create a user with escalating permissions
      const userCap = await SecurityUtils.createReadOnlyCapability(
        registry,
        'user-actor',
        'system'
      );

      const moderatorCap = await SecurityUtils.createConstrainedCapability(
        registry,
        'user-actor',
        ['read.*', 'write.comments'],
        'admin',
        { role: 'moderator' }
      );

      const adminCap = await SecurityUtils.createAdminCapability(
        registry,
        'user-actor',
        'superadmin'
      );

      testCapabilities.push(userCap, moderatorCap, adminCap);

      // Act & Assert - Different permission levels
      expect(userCap.can('read.posts')).toBe(true);
      expect(userCap.can('write.comments')).toBe(false);
      expect(userCap.can('admin.deleteUser')).toBe(false);

      expect(moderatorCap.can('read.posts')).toBe(true);
      expect(moderatorCap.can('write.comments')).toBe(true);
      expect(moderatorCap.can('admin.deleteUser')).toBe(false);

      expect(adminCap.can('read.posts')).toBe(true);
      expect(adminCap.can('write.comments')).toBe(true);
      expect(adminCap.can('admin.deleteUser')).toBe(true);
    });

    it('should handle capability delegation chain', async () => {
      // Arrange - Create a chain of capabilities
      const rootCap = await SecurityUtils.createAdminCapability(registry, 'root-actor', 'system');

      const delegatedCap = await SecurityUtils.createConstrainedCapability(
        registry,
        'delegated-actor',
        ['read.*', 'write.data'],
        rootCap.id, // Granted by the root capability
        { delegatedBy: rootCap.id }
      );

      testCapabilities.push(rootCap, delegatedCap);

      // Act & Assert - Delegation should work
      expect(rootCap.can('admin.delegate')).toBe(true);
      expect(delegatedCap.can('read.data')).toBe(true);
      expect(delegatedCap.can('write.data')).toBe(true);
      expect(delegatedCap.can('admin.delegate')).toBe(false);
      expect(delegatedCap.metadata?.constraints?.delegatedBy).toBe(rootCap.id);
    });
  });
});
