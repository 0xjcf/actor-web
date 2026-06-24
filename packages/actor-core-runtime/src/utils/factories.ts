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
import type { ActorAddress, ActorMessage, AddressQuery } from '../actor-system.js';
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
 * Mint a branded actor address. The path IS the address. This is the ONLY
 * brand-emission site for normal addresses (the reserved guardian sentinel in
 * actor-system-guardian.ts is the single deliberate exception).
 */
function mint(id: string, node: string | undefined, kind: 'actor' | 'callback'): ActorAddress {
  if (!id || typeof id !== 'string') {
    throw new Error('Actor ID must be a non-empty string'); // KEEP: value-object precondition
  }
  // `node` is a single path segment (parse captures it as [^/]+). A non-string,
  // empty, or slash-bearing node would mis-split the minted path so it no longer
  // round-trips through parse(). Reject it at the only brand-emission site.
  if (node !== undefined && (typeof node !== 'string' || node.length === 0 || node.includes('/'))) {
    throw new Error(`Actor node must be a single non-empty path segment without "/": ${node}`);
  }
  // `/callback/` is the load-bearing delivery discriminator (the callback regex
  // matches it ANYWHERE in the path), so an actor id starting with `callback/` —
  // OR embedding a `/callback/` segment mid-string (e.g. `group/callback/sub`) —
  // would round-trip back as kind:'callback' and misroute. Reserve the segment
  // (and its prefix form) for actor-kind ids; benign slash-bearing ids stay valid.
  if (kind === 'actor' && (id.startsWith('callback/') || id.includes('/callback/'))) {
    throw new Error(`Actor id must not contain the reserved "callback/" segment: ${id}`);
  }
  // Reserved-id guard (locked): 'guardian' is the well-known system root supervisor id;
  // no user actor may claim it. The guardian's own address bypasses this via a direct
  // cast in actor-system-guardian.ts.
  if (kind === 'actor' && id === 'guardian') {
    throw new Error('Actor id "guardian" is reserved for the system root supervisor');
  }
  const resolvedNode = node || 'local'; // single node-normalization site; node ALWAYS set
  const path =
    kind === 'callback'
      ? `actor://${resolvedNode}/callback/${id}`
      : `actor://${resolvedNode}/${id}`; // 2-segment for actors (drop redundant /actor/)
  return path as ActorAddress; // ONLY brand-emission site for normal addresses
}

/**
 * The sole smart constructor for actor addresses. Accepts either a raw path
 * string (re-normalized via `parse`) or a structured input, and returns a total
 * branded value. Echoes `URL`/`Temporal` `.from`. Only minter.
 */
export const Address = {
  from(input: string | { id: string; kind?: 'actor' | 'callback'; node?: string }): ActorAddress {
    if (typeof input === 'string') {
      const { id, kind, node } = parse(input as ActorAddress);
      return mint(id, node, kind);
    }
    return mint(input.id, input.node, input.kind ?? 'actor');
  },
} as const;

/**
 * Boundary helper for structured reads of an address. Hot routing keeps the
 * `.includes('/callback/')` fast path; use this where id/kind/node are needed.
 * Pure: no I/O.
 */
export function parse(address: ActorAddress): {
  id: string;
  kind: 'actor' | 'callback';
  node: string;
} {
  const cb = address.match(/^actor:\/\/([^/]+)\/callback\/(.+)$/);
  if (cb) {
    const [, node, id] = cb;
    return { id, kind: 'callback', node };
  }
  const a = address.match(/^actor:\/\/([^/]+)\/(.+)$/);
  if (!a) {
    throw new Error(`Invalid actor address: ${address}`);
  }
  const [, node, id] = a;
  return { id, kind: 'actor', node };
}

/**
 * Pure functional-core predicate: does an address satisfy a typed query? Every
 * provided field must match (conjunction); an empty query matches all.
 */
export function matchesAddressQuery(address: ActorAddress, query: AddressQuery): boolean {
  const { id, kind, node } = parse(address);
  return (
    (query.id === undefined || query.id === id) &&
    (query.kind === undefined || query.kind === kind) &&
    (query.node === undefined || query.node === node)
  );
}

/**
 * Thin alias so the existing createActorAddress(...) call sites keep compiling.
 * Prefer `Address.from` for new code.
 */
export function createActorAddress(
  id: string,
  node?: string,
  kind: 'actor' | 'callback' = 'actor'
): ActorAddress {
  return mint(id, node, kind);
}

/**
 * Creates local actor address (same node)
 */
export function createLocalActorAddress(id: string): ActorAddress {
  return mint(id, 'local', 'actor');
}

/**
 * Creates remote actor address (different node)
 */
export function createRemoteActorAddress(id: string, node: string): ActorAddress {
  return mint(id, node, 'actor');
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
