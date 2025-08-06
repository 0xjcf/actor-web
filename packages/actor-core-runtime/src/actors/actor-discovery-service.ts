/**
 * @module actor-core/runtime/actors/actor-discovery-service
 * @description Actor Discovery Service for Location-Transparent Actor Discovery
 *
 * This service implements pure message-based actor discovery following FRAMEWORK-STANDARD:
 * - All interactions through messages (REGISTER, UNREGISTER, LOOKUP, LIST)
 * - Support for both well-known names and ephemeral PID patterns
 * - Pattern-based queries (e.g., 'services.*')
 * - Location transparency for distributed scenarios
 * - No direct method calls or singleton patterns
 * - Automatic cleanup on actor termination
 *
 * @author Agent A - Actor-Core Framework
 * @version 1.0.0
 */

import type { ActorInstance } from '../actor-instance.js';
import type { ActorDependencies, ActorMessage, JsonValue } from '../actor-system.js';
import { Logger } from '../logger.js';
import type { DomainEvent, MessagePlan } from '../message-plan.js';
import { createSendInstruction } from '../message-plan.js';
import { createNullActorRef } from '../utils/null-actor.js';

const log = Logger.namespace('ACTOR_DISCOVERY_SERVICE');

// ============================================================================
// DISCOVERY SERVICE MESSAGE TYPES (FRAMEWORK-STANDARD Compliant)
// ============================================================================

/**
 * Register an actor with a well-known name or ephemeral PID
 */
export interface RegisterMessage extends ActorMessage {
  type: 'REGISTER';
  readonly name: string; // Well-known name (e.g., 'services.user') or ephemeral PID
  readonly address: string; // Actor address/path
  readonly isEphemeral?: boolean; // True for ephemeral PIDs, false for well-known names
  readonly metadata?: JsonValue; // Optional metadata about the actor
}

/**
 * Unregister an actor
 */
export interface UnregisterMessage extends ActorMessage {
  type: 'UNREGISTER';
  readonly name: string; // Name or PID to unregister
  readonly address?: string; // Optional address verification
}

/**
 * Lookup an actor by name or pattern
 */
export interface LookupMessage extends ActorMessage {
  type: 'LOOKUP';
  readonly name: string; // Name or pattern to lookup
  readonly requestor: string; // Actor address to send response to
  readonly requestId?: string; // Optional request correlation ID
}

/**
 * List actors matching a pattern
 */
export interface ListMessage extends ActorMessage {
  type: 'LIST';
  readonly pattern?: string; // Pattern to match (e.g., 'services.*'), or null for all
  readonly requestor: string; // Actor address to send response to
  readonly requestId?: string; // Optional request correlation ID
  readonly includeEphemeral?: boolean; // Include ephemeral PIDs in results
}

/**
 * Health check message
 */
export interface HealthCheckMessage extends ActorMessage {
  type: 'HEALTH_CHECK';
  readonly requestor: string; // Actor address to send response to
}

/**
 * Union type for all Discovery Service messages
 */
export type DiscoveryServiceMessage =
  | RegisterMessage
  | UnregisterMessage
  | LookupMessage
  | ListMessage
  | HealthCheckMessage;

// ============================================================================
// DISCOVERY SERVICE CONTEXT AND STATE
// ============================================================================

/**
 * Actor registry entry
 */
export interface ActorRegistryEntry {
  readonly name: string;
  readonly address: string;
  readonly isEphemeral: boolean;
  readonly metadata?: JsonValue;
  readonly registeredAt: number;
  readonly lastSeen: number;
}

/**
 * Discovery Service Actor Context (stored in XState machine)
 */
export interface DiscoveryServiceContext {
  readonly wellKnownNames: Map<string, ActorRegistryEntry>; // name -> entry
  readonly ephemeralPids: Map<string, ActorRegistryEntry>; // PID -> entry
  readonly messageCount: number;
  readonly registrationCount: number;
  readonly lookupCount: number;
  readonly startTime: number; // Track when the service started
}

/**
 * Initial context for Discovery Service
 */
export function createInitialDiscoveryServiceContext(): DiscoveryServiceContext {
  return {
    wellKnownNames: new Map(),
    ephemeralPids: new Map(),
    messageCount: 0,
    registrationCount: 0,
    lookupCount: 0,
    startTime: Date.now(),
  };
}

// ============================================================================
// TYPE GUARDS (FRAMEWORK-STANDARD compliant)
// ============================================================================

/**
 * Type guard for RegisterMessage
 */
function isRegisterMessage(message: ActorMessage): message is RegisterMessage {
  return (
    message.type === 'REGISTER' &&
    message !== null &&
    typeof message === 'object' &&
    'name' in message &&
    'address' in message &&
    typeof message.name === 'string' &&
    typeof message.address === 'string'
  );
}

/**
 * Type guard for UnregisterMessage
 */
function isUnregisterMessage(message: ActorMessage): message is UnregisterMessage {
  return (
    message.type === 'UNREGISTER' &&
    message !== null &&
    typeof message === 'object' &&
    'name' in message &&
    typeof message.name === 'string'
  );
}

/**
 * Type guard for LookupMessage
 */
function isLookupMessage(message: ActorMessage): message is LookupMessage {
  return (
    message.type === 'LOOKUP' &&
    message !== null &&
    typeof message === 'object' &&
    'name' in message &&
    'requestor' in message &&
    typeof message.name === 'string' &&
    typeof message.requestor === 'string'
  );
}

/**
 * Type guard for ListMessage
 */
function isListMessage(message: ActorMessage): message is ListMessage {
  return (
    message.type === 'LIST' &&
    message !== null &&
    typeof message === 'object' &&
    'requestor' in message &&
    typeof message.requestor === 'string'
  );
}

/**
 * Type guard for HealthCheckMessage
 */
function isHealthCheckMessage(message: ActorMessage): message is HealthCheckMessage {
  return (
    message.type === 'HEALTH_CHECK' &&
    message !== null &&
    typeof message === 'object' &&
    'requestor' in message &&
    typeof message.requestor === 'string'
  );
}

// ============================================================================
// PATTERN MATCHING
// ============================================================================

/**
 * Check if a name matches a pattern
 * Supports patterns like 'services.*', 'user.*.active', etc.
 */
function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === '*') {
    return true; // Match all names
  }

  if (!pattern.includes('*')) {
    return name === pattern; // Exact match
  }

  // Convert wildcard pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.') // Escape dots
    .replace(/\*/g, '.*'); // Convert * to .*

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(name);
}

/**
 * Find all entries matching a pattern
 */
function findMatchingEntries(
  pattern: string,
  wellKnownNames: Map<string, ActorRegistryEntry>,
  ephemeralPids: Map<string, ActorRegistryEntry>,
  includeEphemeral = false
): ActorRegistryEntry[] {
  const matches: ActorRegistryEntry[] = [];

  // Search well-known names
  for (const [name, entry] of wellKnownNames.entries()) {
    if (matchesPattern(name, pattern)) {
      matches.push(entry);
    }
  }

  // Search ephemeral PIDs if requested
  if (includeEphemeral) {
    for (const [pid, entry] of ephemeralPids.entries()) {
      if (matchesPattern(pid, pattern)) {
        matches.push(entry);
      }
    }
  }

  return matches;
}

// ============================================================================
// DISCOVERY SERVICE ACTOR BEHAVIOR
// ============================================================================

/**
 * Create Actor Discovery Service Behavior (FRAMEWORK-STANDARD compliant)
 *
 * This pure actor handles actor discovery through messages only:
 * - REGISTER: Register actor with well-known name or ephemeral PID
 * - UNREGISTER: Remove actor registration
 * - LOOKUP: Find actor by name/pattern
 * - LIST: List all actors matching pattern
 * - HEALTH_CHECK: Service health status
 */
export function createDiscoveryServiceBehavior() {
  return {
    async onMessage({
      message,
      machine,
      dependencies,
    }: {
      message: ActorMessage;
      machine: ActorInstance;
      dependencies: ActorDependencies;
    }): Promise<MessagePlan | undefined> {
      const context = machine.getSnapshot().context as DiscoveryServiceContext;

      log.debug('Discovery service received message', {
        messageType: message.type,
        actorId: dependencies.actorId,
        registrationCount: context.registrationCount,
      });

      // Update message count
      const newContext = {
        ...context,
        messageCount: context.messageCount + 1,
      };

      if (isRegisterMessage(message)) {
        return await handleRegister(message, newContext, dependencies);
      }

      if (isUnregisterMessage(message)) {
        return await handleUnregister(message, newContext, dependencies);
      }

      if (isLookupMessage(message)) {
        return await handleLookup(message, newContext, dependencies);
      }

      if (isListMessage(message)) {
        return await handleList(message, newContext, dependencies);
      }

      if (isHealthCheckMessage(message)) {
        return await handleHealthCheck(message, newContext, dependencies);
      }

      log.warn('Unknown message type received by discovery service', {
        messageType: message.type,
        actorId: dependencies.actorId,
      });

      // Return domain event for unknown message
      return {
        type: 'DISCOVERY_UNKNOWN_MESSAGE',
        messageType: message.type,
        timestamp: Date.now(),
      };
    },
  };
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

/**
 * Handle REGISTER message - Register actor with name/PID
 */
async function handleRegister(
  message: RegisterMessage,
  context: DiscoveryServiceContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { name, address, isEphemeral = false, metadata } = message;

  log.debug('Handling registration', {
    name,
    address,
    isEphemeral,
    actorId: dependencies.actorId,
  });

  const now = Date.now();
  const entry: ActorRegistryEntry = {
    name,
    address,
    isEphemeral,
    metadata,
    registeredAt: now,
    lastSeen: now,
  };

  // Determine which registry to use
  const registry = isEphemeral ? context.ephemeralPids : context.wellKnownNames;

  // Check if already registered
  const existing = registry.get(name);
  const wasNew = !existing;

  // Register the entry
  registry.set(name, entry);

  // Update context
  const newContext = {
    ...context,
    registrationCount: wasNew ? context.registrationCount + 1 : context.registrationCount,
  };

  // Update machine state
  dependencies.actor.send({
    type: 'ACTOR_REGISTERED',
    name,
    address,
    isEphemeral,
    wasNew,
  });

  // Return domain event for successful registration
  return {
    type: 'ACTOR_REGISTERED',
    name,
    address,
    isEphemeral,
    wasNew,
    totalRegistrations: newContext.registrationCount,
    timestamp: now,
  };
}

/**
 * Handle UNREGISTER message - Remove actor registration
 */
async function handleUnregister(
  message: UnregisterMessage,
  context: DiscoveryServiceContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { name, address } = message;

  log.debug('Handling unregistration', {
    name,
    address,
    actorId: dependencies.actorId,
  });

  let wasRemoved = false;
  let wasEphemeral = false;

  // Try removing from well-known names first
  const wellKnownEntry = context.wellKnownNames.get(name);
  if (wellKnownEntry && (!address || wellKnownEntry.address === address)) {
    context.wellKnownNames.delete(name);
    wasRemoved = true;
    wasEphemeral = false;
  } else {
    // Try removing from ephemeral PIDs
    const ephemeralEntry = context.ephemeralPids.get(name);
    if (ephemeralEntry && (!address || ephemeralEntry.address === address)) {
      context.ephemeralPids.delete(name);
      wasRemoved = true;
      wasEphemeral = true;
    }
  }

  // Update context
  const newContext = {
    ...context,
    registrationCount: wasRemoved ? context.registrationCount - 1 : context.registrationCount,
  };

  // Update machine state
  dependencies.actor.send({
    type: 'ACTOR_UNREGISTERED',
    name,
    address,
    wasRemoved,
    wasEphemeral,
  });

  // Return domain event for unregistration attempt
  return {
    type: 'ACTOR_UNREGISTERED',
    name,
    address,
    wasRemoved,
    wasEphemeral,
    totalRegistrations: newContext.registrationCount,
    timestamp: Date.now(),
  };
}

/**
 * Handle LOOKUP message - Find actor by name
 */
async function handleLookup(
  message: LookupMessage,
  context: DiscoveryServiceContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { name, requestor, requestId } = message;

  log.debug('Handling lookup', {
    name,
    requestor,
    requestId,
    actorId: dependencies.actorId,
  });

  // Update lookup count
  const newContext = {
    ...context,
    lookupCount: context.lookupCount + 1,
  };

  // Search well-known names first
  let entry = context.wellKnownNames.get(name);
  let foundIn = 'well-known';

  // If not found, search ephemeral PIDs
  if (!entry) {
    entry = context.ephemeralPids.get(name);
    foundIn = 'ephemeral';
  }

  // Update machine state
  dependencies.actor.send({
    type: 'LOOKUP_PERFORMED',
    name,
    found: !!entry,
    foundIn: entry ? foundIn : undefined,
  });

  // Create response message with proper JsonValue handling
  const lookupResponseMessage = {
    type: 'LOOKUP_RESULT',
    name,
    entry: entry
      ? {
          name: entry.name,
          address: entry.address,
          isEphemeral: entry.isEphemeral,
          metadata: entry.metadata || null, // Convert undefined to null for JsonValue compatibility
          registeredAt: entry.registeredAt,
        }
      : null,
    requestId: requestId || null, // Convert undefined to null for JsonValue compatibility
  };

  // Create proper SendInstruction with null actor placeholder
  const sendInstruction = createSendInstruction(
    createNullActorRef(requestor),
    lookupResponseMessage,
    'fireAndForget'
  );

  const domainEvent: DomainEvent = {
    type: 'LOOKUP_PERFORMED',
    name,
    found: !!entry,
    foundIn: entry ? foundIn : undefined,
    requestor,
    lookupCount: newContext.lookupCount,
    timestamp: Date.now(),
  };

  return [domainEvent, sendInstruction];
}

/**
 * Handle LIST message - List actors matching pattern
 */
async function handleList(
  message: ListMessage,
  context: DiscoveryServiceContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { pattern = '*', requestor, requestId, includeEphemeral = false } = message;

  log.debug('Handling list', {
    pattern,
    requestor,
    includeEphemeral,
    actorId: dependencies.actorId,
  });

  // Find matching entries
  const matchingEntries = findMatchingEntries(
    pattern,
    context.wellKnownNames,
    context.ephemeralPids,
    includeEphemeral
  );

  // Update machine state
  dependencies.actor.send({
    type: 'LIST_PERFORMED',
    pattern,
    matchCount: matchingEntries.length,
    includeEphemeral,
  });

  // Create response message with serializable entry data and proper JsonValue handling
  const listResponseMessage = {
    type: 'LIST_RESULT',
    pattern,
    entries: matchingEntries.map((entry) => ({
      name: entry.name,
      address: entry.address,
      isEphemeral: entry.isEphemeral,
      metadata: entry.metadata || null, // Convert undefined to null for JsonValue compatibility
      registeredAt: entry.registeredAt,
    })),
    requestId: requestId || null, // Convert undefined to null for JsonValue compatibility
  };

  // Create proper SendInstruction with null actor placeholder
  const sendInstruction = createSendInstruction(
    createNullActorRef(requestor),
    listResponseMessage,
    'fireAndForget'
  );

  const domainEvent: DomainEvent = {
    type: 'LIST_PERFORMED',
    pattern,
    matchCount: matchingEntries.length,
    includeEphemeral,
    requestor,
    timestamp: Date.now(),
  };

  return [domainEvent, sendInstruction];
}

/**
 * Handle HEALTH_CHECK message - Return service health status
 */
async function handleHealthCheck(
  message: HealthCheckMessage,
  context: DiscoveryServiceContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { requestor } = message;

  log.debug('Handling health check', {
    requestor,
    actorId: dependencies.actorId,
  });

  // Collect health statistics
  const health = {
    status: 'healthy',
    messageCount: context.messageCount,
    registrationCount: context.registrationCount,
    lookupCount: context.lookupCount,
    wellKnownNamesCount: context.wellKnownNames.size,
    ephemeralPidsCount: context.ephemeralPids.size,
    uptime: Date.now() - context.startTime,
    timestamp: Date.now(),
  };

  // Create response message
  const healthResponseMessage = {
    type: 'HEALTH_CHECK_RESPONSE',
    health,
  };

  // Return send instruction to requestor with null actor placeholder
  return createSendInstruction(
    createNullActorRef(requestor),
    healthResponseMessage,
    'fireAndForget'
  );
}

// ============================================================================
// SYSTEM INTEGRATION
// ============================================================================

/**
 * Well-known address for the system discovery service
 */
export const SYSTEM_DISCOVERY_SERVICE_ADDRESS = 'system.discovery';

/**
 * Create the system discovery service actor (for use by ActorSystem)
 */
export function createSystemDiscoveryService() {
  return {
    behavior: createDiscoveryServiceBehavior(),
    initialContext: createInitialDiscoveryServiceContext(),
    address: SYSTEM_DISCOVERY_SERVICE_ADDRESS,
  };
}
