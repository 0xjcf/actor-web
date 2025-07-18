/**
 * @module actor-core/runtime/capability-security
 * @description Capability-based security model for actor system with fine-grained permissions
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import type { ActorRef } from './actor-ref.js';
import { Logger } from './logger.js';
import type { BaseEventObject } from './types.js';
import type { VirtualActorSystem } from './virtual-actor-system.js';

// ========================================================================================
// CAPABILITY INTERFACES
// ========================================================================================

/**
 * A capability represents a permission to perform specific operations on an actor
 */
export interface Capability<T = unknown> {
  /**
   * Unique identifier for this capability
   */
  readonly id: string;

  /**
   * The actor this capability grants access to
   */
  readonly subject: ActorRef<BaseEventObject>;

  /**
   * The permissions granted by this capability
   */
  readonly permissions: string[];

  /**
   * Optional metadata about the capability
   */
  readonly metadata?: {
    grantedBy?: string;
    grantedAt?: number;
    expiresAt?: number;
    constraints?: Record<string, unknown>;
  };

  /**
   * Invoke a method on the actor if permission is granted
   */
  invoke<M extends string | number | symbol>(method: M, ...args: unknown[]): Promise<unknown>;

  /**
   * Check if this capability grants a specific permission
   */
  can(permission: string): boolean;

  /**
   * Check if this capability is still valid
   */
  isValid(): boolean;

  /**
   * Revoke this capability
   */
  revoke(): void;
}

/**
 * Permission levels for different types of operations
 */
export enum PermissionLevel {
  READ = 'read',
  WRITE = 'write',
  EXECUTE = 'execute',
  ADMIN = 'admin',
}

/**
 * Capability grant request
 */
export interface CapabilityGrantRequest {
  actorId: string;
  actorType?: string;
  permissions: string[];
  grantedBy: string;
  expiresAt?: number;
  constraints?: Record<string, unknown>;
}

/**
 * Capability registry interface
 */
export interface CapabilityRegistry {
  /**
   * Grant a capability to an actor
   */
  grant<T>(request: CapabilityGrantRequest): Promise<Capability<T>>;

  /**
   * Revoke a capability
   */
  revoke(capabilityId: string): Promise<void>;

  /**
   * Get all capabilities for an actor
   */
  getCapabilities(actorId: string): Promise<Capability<unknown>[]>;

  /**
   * Check if a capability exists and is valid
   */
  validate(capabilityId: string): Promise<boolean>;

  /**
   * Cleanup expired capabilities
   */
  cleanup(): Promise<void>;
}

// ========================================================================================
// SECURE ACTOR PROXY
// ========================================================================================

/**
 * A secure proxy that wraps an actor with capability-based access control
 */
export class SecureActorProxy<T> implements Capability<T> {
  private logger = Logger.namespace('SECURE_ACTOR');
  private _isRevoked = false;

  constructor(
    public readonly id: string,
    public readonly subject: ActorRef<BaseEventObject>,
    public readonly permissions: string[],
    public readonly metadata?: {
      grantedBy?: string;
      grantedAt?: number;
      expiresAt?: number;
      constraints?: Record<string, unknown>;
    }
  ) {
    this.logger.debug('Created secure actor proxy', {
      capabilityId: id,
      actorId: subject.id,
      permissions,
      metadata,
    });
  }

  async invoke<M extends string | number | symbol>(
    method: M,
    ...args: unknown[]
  ): Promise<unknown> {
    if (!this.isValid()) {
      throw new SecurityError(`Capability ${this.id} is not valid`);
    }

    const methodName = String(method);
    if (!this.can(methodName)) {
      throw new PermissionDeniedError(
        `Permission denied: ${methodName} not allowed by capability ${this.id}`
      );
    }

    this.logger.debug('Invoking method through capability', {
      capabilityId: this.id,
      method: methodName,
      args: args.length,
    });

    try {
      // In a real implementation, this would invoke the method on the actor
      // For now, we'll use the actor's ask pattern as a proxy
      const result = await this.subject.ask({
        type: 'CAPABILITY_INVOKE',
        method: methodName,
        args,
        capabilityId: this.id,
      } as BaseEventObject);

      this.logger.debug('Method invocation successful', {
        capabilityId: this.id,
        method: methodName,
      });

      return result;
    } catch (error) {
      this.logger.error('Method invocation failed', {
        capabilityId: this.id,
        method: methodName,
        error,
      });
      throw error;
    }
  }

  can(permission: string): boolean {
    if (this._isRevoked) {
      return false;
    }

    // Check if permission is explicitly granted
    if (this.permissions.includes(permission)) {
      return true;
    }

    // Check for wildcard permissions
    if (this.permissions.includes('*')) {
      return true;
    }

    // Check for pattern-based permissions (e.g., 'read.*')
    for (const grantedPermission of this.permissions) {
      if (grantedPermission.endsWith('*')) {
        const prefix = grantedPermission.slice(0, -1);
        if (permission.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }

  isValid(): boolean {
    if (this._isRevoked) {
      return false;
    }

    // Check expiration
    if (this.metadata?.expiresAt && Date.now() > this.metadata.expiresAt) {
      this.logger.debug('Capability expired', {
        capabilityId: this.id,
        expiresAt: this.metadata.expiresAt,
        now: Date.now(),
      });
      return false;
    }

    // Check if subject actor is still valid
    if (this.subject.status === 'stopped') {
      this.logger.debug('Capability invalid - subject actor stopped', {
        capabilityId: this.id,
        actorId: this.subject.id,
      });
      return false;
    }

    return true;
  }

  revoke(): void {
    this._isRevoked = true;
    this.logger.debug('Capability revoked', { capabilityId: this.id });
  }
}

// ========================================================================================
// CAPABILITY REGISTRY IMPLEMENTATION
// ========================================================================================

/**
 * In-memory capability registry with virtual actor system integration
 */
export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private capabilities = new Map<string, Capability<any>>();
  private actorCapabilities = new Map<string, Set<string>>();
  private logger = Logger.namespace('CAPABILITY_REGISTRY');

  constructor(private virtualActorSystem?: VirtualActorSystem) {}

  async grant<T>(request: CapabilityGrantRequest): Promise<Capability<T>> {
    const capabilityId = this.generateCapabilityId();

    const actorRef = this.getActorRef(request.actorId);

    const capability = new SecureActorProxy<T>(capabilityId, actorRef, request.permissions, {
      grantedBy: request.grantedBy,
      grantedAt: Date.now(),
      expiresAt: request.expiresAt,
      constraints: request.constraints,
    });

    this.capabilities.set(capabilityId, capability);

    // Track capabilities by actor
    if (!this.actorCapabilities.has(request.actorId)) {
      this.actorCapabilities.set(request.actorId, new Set());
    }
    this.actorCapabilities.get(request.actorId)!.add(capabilityId);

    this.logger.debug('Capability granted', {
      capabilityId,
      actorId: request.actorId,
      permissions: request.permissions,
      grantedBy: request.grantedBy,
    });

    return capability;
  }

  async revoke(capabilityId: string): Promise<void> {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) {
      throw new Error(`Capability ${capabilityId} not found`);
    }

    capability.revoke();
    this.capabilities.delete(capabilityId);

    // Remove from actor tracking
    for (const [actorId, capabilityIds] of this.actorCapabilities.entries()) {
      if (capabilityIds.has(capabilityId)) {
        capabilityIds.delete(capabilityId);
        if (capabilityIds.size === 0) {
          this.actorCapabilities.delete(actorId);
        }
        break;
      }
    }

    this.logger.debug('Capability revoked', { capabilityId });
  }

  async getCapabilities(actorId: string): Promise<Capability<unknown>[]> {
    const capabilityIds = this.actorCapabilities.get(actorId) || new Set();
    const capabilities: Capability<unknown>[] = [];

    for (const capabilityId of capabilityIds) {
      const capability = this.capabilities.get(capabilityId);
      if (capability && capability.isValid()) {
        capabilities.push(capability);
      }
    }

    return capabilities;
  }

  async validate(capabilityId: string): Promise<boolean> {
    const capability = this.capabilities.get(capabilityId);
    return capability ? capability.isValid() : false;
  }

  async cleanup(): Promise<void> {
    const expiredCapabilities: string[] = [];

    for (const [capabilityId, capability] of this.capabilities.entries()) {
      if (!capability.isValid()) {
        expiredCapabilities.push(capabilityId);
      }
    }

    for (const capabilityId of expiredCapabilities) {
      await this.revoke(capabilityId);
    }

    this.logger.debug('Capability cleanup completed', {
      expiredCount: expiredCapabilities.length,
      remainingCount: this.capabilities.size,
    });
  }

  /**
   * Get statistics about the capability registry
   */
  getStats() {
    const totalCapabilities = this.capabilities.size;
    const activeCapabilities = Array.from(this.capabilities.values()).filter((cap) =>
      cap.isValid()
    ).length;

    return {
      totalCapabilities,
      activeCapabilities,
      expiredCapabilities: totalCapabilities - activeCapabilities,
      actorsWithCapabilities: this.actorCapabilities.size,
    };
  }

  private generateCapabilityId(): string {
    return `cap-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private getActorRef(actorId: string): ActorRef<BaseEventObject> {
    // If we have a virtual actor system, use it to get the actor reference
    if (this.virtualActorSystem) {
      this.logger.debug('Getting actor from virtual actor system', { actorId });
      return this.virtualActorSystem.getActor('default', actorId);
    }

    // Fall back to mock actor ref for testing or when no virtual actor system is provided
    this.logger.debug('Using mock actor ref (no virtual actor system)', { actorId });
    return {
      id: actorId,
      status: 'running',
      send: () => {},
      ask: async () => ({ success: true }),
      emit: () => {},
      subscribe: () => () => {},
      on: () => () => {},
      observe: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
      start: () => {},
      stop: async () => {},
      restart: async () => {},
      spawn: () => ({}) as any,
      stopChild: async () => {},
      getChildren: () => new Map(),
      matches: () => false,
      accepts: () => false,
      getSnapshot: () => ({
        value: 'idle',
        context: {},
        status: 'running',
        matches: () => false,
        can: () => false,
        hasTag: () => false,
        toJSON: () => ({ value: 'idle', context: {}, status: 'running' }),
      }),
      parent: undefined,
      supervision: undefined,
    } as ActorRef<BaseEventObject>;
  }
}

// ========================================================================================
// SECURITY UTILITIES
// ========================================================================================

/**
 * Security utility functions for capability management
 */
export namespace SecurityUtils {
  /**
   * Create a capability with read-only permissions
   */
  export function createReadOnlyCapability<T>(
    registry: CapabilityRegistry,
    actorId: string,
    grantedBy: string,
    expiresAt?: number
  ): Promise<Capability<T>> {
    return registry.grant<T>({
      actorId,
      permissions: ['read.*'],
      grantedBy,
      expiresAt,
    });
  }

  /**
   * Create a capability with full permissions
   */
  export function createAdminCapability<T>(
    registry: CapabilityRegistry,
    actorId: string,
    grantedBy: string,
    expiresAt?: number
  ): Promise<Capability<T>> {
    return registry.grant<T>({
      actorId,
      permissions: ['*'],
      grantedBy,
      expiresAt,
    });
  }

  /**
   * Create a time-limited capability
   */
  export function createTimeLimitedCapability<T>(
    registry: CapabilityRegistry,
    actorId: string,
    permissions: string[],
    grantedBy: string,
    durationMs: number
  ): Promise<Capability<T>> {
    return registry.grant<T>({
      actorId,
      permissions,
      grantedBy,
      expiresAt: Date.now() + durationMs,
    });
  }

  /**
   * Create a constrained capability with additional restrictions
   */
  export function createConstrainedCapability<T>(
    registry: CapabilityRegistry,
    actorId: string,
    permissions: string[],
    grantedBy: string,
    constraints: Record<string, unknown>
  ): Promise<Capability<T>> {
    return registry.grant<T>({
      actorId,
      permissions,
      grantedBy,
      constraints,
    });
  }

  /**
   * Check if a capability can perform a specific operation
   */
  export function canPerformOperation(capability: Capability<unknown>, operation: string): boolean {
    return capability.isValid() && capability.can(operation);
  }

  /**
   * Validate multiple capabilities for an operation
   */
  export function validateCapabilities(
    capabilities: Capability<unknown>[],
    requiredPermission: string
  ): boolean {
    return capabilities.some((cap) => canPerformOperation(cap, requiredPermission));
  }
}

// ========================================================================================
// SECURITY MIDDLEWARE
// ========================================================================================

/**
 * Security middleware for actor message handling
 */
export class SecurityMiddleware {
  private logger = Logger.namespace('SECURITY_MIDDLEWARE');

  constructor(private registry: CapabilityRegistry) {}

  /**
   * Middleware function to check permissions before message processing
   */
  async checkPermissions(
    message: BaseEventObject & { capabilityId?: string },
    _requiredPermission: string
  ): Promise<boolean> {
    if (!message.capabilityId) {
      this.logger.warn('Message without capability ID', { message });
      return false;
    }

    const isValid = await this.registry.validate(message.capabilityId);
    if (!isValid) {
      this.logger.warn('Invalid capability', { capabilityId: message.capabilityId });
      return false;
    }

    // In a real implementation, we'd check the specific permission
    // For now, we'll just validate the capability exists
    return true;
  }

  /**
   * Wrap an actor with security middleware
   */
  secureActor(actor: ActorRef<BaseEventObject>): SecureActorWrapper {
    return new SecureActorWrapper(actor, this);
  }
}

/**
 * Wrapper that adds security checks to actor operations
 */
export class SecureActorWrapper {
  private logger = Logger.namespace('SECURE_ACTOR_WRAPPER');

  constructor(
    private actor: ActorRef<BaseEventObject>,
    private middleware: SecurityMiddleware
  ) {}

  async secureInvoke(
    capabilityId: string,
    method: string,
    args: unknown[],
    requiredPermission: string
  ): Promise<unknown> {
    const hasPermission = await this.middleware.checkPermissions(
      { type: 'INVOKE', capabilityId } as BaseEventObject & { capabilityId: string },
      requiredPermission
    );

    if (!hasPermission) {
      throw new PermissionDeniedError(
        `Permission denied for method ${method} with capability ${capabilityId}`
      );
    }

    this.logger.debug('Secure invocation authorized', {
      method,
      capabilityId,
      requiredPermission,
    });

    return this.actor.ask({
      type: 'CAPABILITY_INVOKE',
      method,
      args,
      capabilityId,
    } as BaseEventObject);
  }
}

// ========================================================================================
// SECURITY ERRORS
// ========================================================================================

/**
 * Base security error
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Permission denied error
 */
export class PermissionDeniedError extends SecurityError {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Capability not found error
 */
export class CapabilityNotFoundError extends SecurityError {
  constructor(capabilityId: string) {
    super(`Capability ${capabilityId} not found`);
    this.name = 'CapabilityNotFoundError';
  }
}

/**
 * Capability expired error
 */
export class CapabilityExpiredError extends SecurityError {
  constructor(capabilityId: string) {
    super(`Capability ${capabilityId} has expired`);
    this.name = 'CapabilityExpiredError';
  }
}

// ========================================================================================
// FACTORY FUNCTIONS
// ========================================================================================

/**
 * Create a new capability registry
 */
export function createCapabilityRegistry(
  virtualActorSystem?: VirtualActorSystem
): CapabilityRegistry {
  return new InMemoryCapabilityRegistry(virtualActorSystem);
}

/**
 * Create security middleware with a registry
 */
export function createSecurityMiddleware(
  registry?: CapabilityRegistry,
  virtualActorSystem?: VirtualActorSystem
): SecurityMiddleware {
  return new SecurityMiddleware(registry || createCapabilityRegistry(virtualActorSystem));
}

/**
 * Create a secure actor proxy with specific permissions
 */
export function createSecureActor<T>(
  actor: ActorRef<BaseEventObject>,
  permissions: string[],
  grantedBy: string,
  options?: {
    expiresAt?: number;
    constraints?: Record<string, unknown>;
  }
): SecureActorProxy<T> {
  const capabilityId = `cap-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  return new SecureActorProxy<T>(capabilityId, actor, permissions, {
    grantedBy,
    grantedAt: Date.now(),
    expiresAt: options?.expiresAt,
    constraints: options?.constraints,
  });
}
