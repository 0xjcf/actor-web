/**
 * @module actor-core/runtime/utils/factories
 * @description Consolidated factory utilities for actor creation
 *
 * This module provides factory functions for creating:
 * - Actor messages with proper validation
 * - Actor IDs and correlation IDs
 * - Actor addresses for location transparency
 * - Standard actor behaviors and components
 */

import type { ActorRef } from '../actor-ref.js';
import type { ActorAddress, ActorMessage } from '../actor-system.js';
import type { JsonValue } from '../types.js';
import { isJsonValue } from './validation.js';

// ============================================================================
// MESSAGE FACTORIES
// ============================================================================

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generates unique actor IDs with optional prefix
 */
export function generateActorId(prefix = 'actor'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generates correlation IDs for ask patterns
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 12);
  return `corr-${timestamp}-${random}`;
}

/**
 * Generates system-wide unique identifiers
 */
export function generateSystemId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `sys-${timestamp}-${random}`;
}

// ============================================================================
// ACTOR ADDRESS FACTORIES
// ============================================================================

/**
 * Creates actor address for location transparency
 */
export function createActorAddress(id: string, type: string, node?: string): ActorAddress {
  if (!id || typeof id !== 'string') {
    throw new Error('Actor ID must be a non-empty string');
  }

  if (!type || typeof type !== 'string') {
    throw new Error('Actor type must be a non-empty string');
  }

  const actualNode = node || 'local';
  return {
    id,
    type,
    node: actualNode,
    path: `actor://${actualNode}/${type}/${id}`,
  };
}

/**
 * Creates local actor address (same node)
 */
export function createLocalActorAddress(id: string, type: string): ActorAddress {
  return createActorAddress(id, type, 'local');
}

/**
 * Creates remote actor address (different node)
 */
export function createRemoteActorAddress(id: string, type: string, node: string): ActorAddress {
  return createActorAddress(id, type, node);
}

// ============================================================================
// UTILITY FACTORIES
// ============================================================================

/**
 * Creates initial context for actors with default values
 */
export function createInitialContext<T extends Record<string, JsonValue>>(defaults: T): T {
  // Validate that context is JSON serializable
  if (!isJsonValue(defaults)) {
    throw new Error('Actor context must be JSON-serializable for location transparency');
  }

  return { ...defaults };
}

/**
 * Creates actor spawn options with defaults
 */
export function createSpawnOptions(
  options: { id?: string; type?: string; parent?: string; supervised?: boolean } = {}
): {
  id: string;
  type: string;
  parent?: string;
  supervised: boolean;
} {
  return {
    id: options.id || generateActorId(),
    type: options.type || 'actor',
    parent: options.parent,
    supervised: options.supervised !== false, // Default to true
  };
}

/**
 * Creates actor capabilities configuration
 */
export function createActorCapabilities(
  capabilities: {
    canSpawn?: boolean;
    canSupervise?: boolean;
    canRoute?: boolean;
    canPersist?: boolean;
  } = {}
): {
  canSpawn: boolean;
  canSupervise: boolean;
  canRoute: boolean;
  canPersist: boolean;
} {
  return {
    canSpawn: capabilities.canSpawn ?? true,
    canSupervise: capabilities.canSupervise ?? false,
    canRoute: capabilities.canRoute ?? false,
    canPersist: capabilities.canPersist ?? false,
  };
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a mock ActorRef for testing that implements the full interface
 * Avoids TypeScript errors when using incomplete mocks in tests
 */
export function createMockActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
>(overrides: Partial<ActorRef<TContext, TMessage>> = {}): ActorRef<TContext, TMessage> {
  const mockRef = {
    id: 'mock-actor',
    status: 'running' as const,
    parent: undefined,
    supervision: undefined,

    // Message passing
    send: () => {},
    ask: async () => ({}) as JsonValue,

    // Event emission
    emit: () => {},
    subscribe: () => () => {},
    on: () => () => {},

    // State access
    getSnapshot: () => ({
      value: 'idle',
      context: {} as TContext,
      status: 'running',
      matches: () => false,
      can: () => false,
      hasTag: () => false,
      toJSON: () => ({ value: 'idle', context: {}, status: 'running' }),
    }),

    // Lifecycle
    start: () => {},
    stop: async () => {},
    restart: async () => {},

    // Supervision
    spawn: () => createMockActorRef(),
    stopChild: async () => {},
    getChildren: () => new Map(),

    // Utility methods
    matches: () => false,
    accepts: () => true,

    ...overrides,
  };

  return mockRef as ActorRef<TContext, TMessage>;
}
