/**
 * Guardian Actor - Root Supervisor for Pure Actor Model
 *
 * The Guardian is the first actor created in the system and serves as:
 * - Root supervisor for all other actors
 * - System lifecycle manager (spawn, stop, shutdown)
 * - Fault tolerance coordinator (restart, escalate strategies)
 * - Actor directory integration point
 */

import { v4 as uuidv4 } from 'uuid';
import type { ActorInstance } from './actor-instance';
import type { ActorRef } from './actor-ref.js';
import type {
  ActorAddress,
  ActorBehavior,
  ActorDependencies,
  ActorMessage,
  ActorSystem,
  JsonValue,
} from './actor-system';
import { SupervisionDirective } from './actor-system';
import { Logger } from './logger.js';

// Guardian Message Types - Flat structure
export interface SpawnActorMessage extends ActorMessage {
  type: 'SPAWN_ACTOR';
  name: string;
  parentId?: string;
}

export interface SpawnChildMessage extends ActorMessage {
  type: 'SPAWN_CHILD';
  name: string;
  address: string;
  parentId: string;
}

export interface StopActorMessage extends ActorMessage {
  type: 'STOP_ACTOR';
  actorId: string;
}

export interface ActorFailedMessage extends ActorMessage {
  type: 'ACTOR_FAILED';
  actorId: string;
  error: string;
  directive: string;
}

export interface ShutdownMessage extends ActorMessage {
  type: 'SHUTDOWN';
  reason?: string;
}

export interface GetSystemInfoMessage extends ActorMessage {
  type: 'GET_SYSTEM_INFO';
}

export interface RegisterActorMessage extends ActorMessage {
  type: 'REGISTER_ACTOR';
  actorId: string;
  path: string;
}

export interface UnregisterActorMessage extends ActorMessage {
  type: 'UNREGISTER_ACTOR';
  actorId: string;
}

export interface SystemHealthCheckMessage extends ActorMessage {
  type: 'SYSTEM_HEALTH_CHECK';
}

export type GuardianMessage =
  | SpawnActorMessage
  | SpawnChildMessage
  | StopActorMessage
  | ActorFailedMessage
  | ShutdownMessage
  | GetSystemInfoMessage
  | RegisterActorMessage
  | UnregisterActorMessage
  | SystemHealthCheckMessage;

// Guardian Context - Minimal serializable state
export interface GuardianContext {
  readonly systemId: string;
  readonly startTime: number;
  readonly isShuttingDown: boolean;
  readonly messageCount: number;
}

// Guardian's actual state - stored externally
interface GuardianState {
  readonly actors: Map<string, ActorInfo>;
  readonly children: Set<string>;
}

// Logger for guardian actor
const log = Logger.namespace('GUARDIAN');

// External state for the guardian (not part of actor context)
const guardianState: GuardianState = {
  actors: new Map(),
  children: new Set(),
};

export interface ActorInfo {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly path: string;
  readonly parentId?: string;
  readonly childIds: string[];
  readonly supervisionDirective: string; // Store as string for JSON serialization
  readonly createdAt: number;
  readonly restartCount: number;
}

/**
 * Guardian Actor Behavior - Pure Actor Model Implementation
 * Uses standard pattern with manual ask pattern response handling
 */
// Create initial serializable context
const initialContext: GuardianContext = {
  systemId: uuidv4(),
  startTime: Date.now(),
  isShuttingDown: false,
  messageCount: 0,
};

// Cast to JsonValue since we know it's serializable
const initialJsonContext: JsonValue = {
  systemId: initialContext.systemId,
  startTime: initialContext.startTime,
  isShuttingDown: initialContext.isShuttingDown,
  messageCount: initialContext.messageCount,
};

export const guardianBehavior: ActorBehavior<GuardianMessage, GuardianContext> = {
  context: initialJsonContext,

  async onMessage({
    message,
    actor,
    dependencies,
  }: {
    message: GuardianMessage;
    actor: ActorInstance;
    dependencies: ActorDependencies;
  }): Promise<void> {
    log.debug('🔍 GUARDIAN DEBUG: onMessage called with:', (message as { type: string }).type);
    log.debug('🔍 GUARDIAN DEBUG: Full message:', message);

    const currentContext = actor.getSnapshot().context as GuardianContext;
    const newContext: GuardianContext = {
      ...currentContext,
      messageCount: currentContext.messageCount + 1,
    };

    let response: unknown | undefined;

    try {
      switch (message.type) {
        case 'SPAWN_ACTOR':
          response = await handleSpawnActor(message, newContext);
          break;

        case 'SPAWN_CHILD': // ✅ ADD: Handle child spawn notifications
          response = await handleSpawnChild(message, newContext);
          break;

        case 'STOP_ACTOR':
          response = await handleStopActor(message, newContext);
          break;

        case 'ACTOR_FAILED':
          response = await handleActorFailed(message, newContext);
          break;

        case 'SHUTDOWN':
          response = await handleShutdown(newContext);
          break;

        case 'GET_SYSTEM_INFO': {
          log.debug('🔍 GUARDIAN DEBUG: About to call handleGetSystemInfo');
          response = await handleGetSystemInfo(newContext);
          log.debug('🔍 GUARDIAN DEBUG: handleGetSystemInfo response:', response);
          break;
        }

        case 'REGISTER_ACTOR':
          response = await handleRegisterActor();
          break;

        case 'UNREGISTER_ACTOR':
          response = await handleUnregisterActor();
          break;

        case 'SYSTEM_HEALTH_CHECK':
          response = await handleHealthCheck(newContext);
          break;

        default: {
          // For unknown message types, always throw an error
          const errorMsg = `Guardian: Invalid message type for ask pattern: ${(message as { type: string }).type}`;
          log.debug('🔍 GUARDIAN DEBUG: Throwing error for unknown message type:', errorMsg);
          throw new Error(errorMsg);
        }
      }
    } catch (error) {
      // Re-throw errors - the actor system will handle them correctly
      // For ask patterns (with correlation ID), the system will reject the promise
      // For send patterns, this will log the error
      log.debug('🔍 GUARDIAN DEBUG: Re-throwing error:', error);
      throw error;
    }

    // Handle ask pattern responses manually for standard behaviors
    if (response !== undefined && hasCorrelationId(message)) {
      log.debug('🔍 GUARDIAN DEBUG: Handling ask pattern response manually');
      const correlationId = message._correlationId;

      // Send response through correlation manager
      if (
        dependencies.correlationManager &&
        typeof dependencies.correlationManager === 'object' &&
        'handleResponse' in dependencies.correlationManager &&
        typeof (dependencies.correlationManager as { handleResponse: unknown }).handleResponse ===
          'function'
      ) {
        const responseMessage = {
          type: message.type,
          ...response,
          _correlationId: correlationId,
          _timestamp: Date.now(),
          _version: '1.0.0',
        };

        log.debug('🔍 GUARDIAN DEBUG: Sending response via correlation manager:', responseMessage);
        (
          dependencies.correlationManager as {
            handleResponse: (correlationId: string, response: unknown) => void;
          }
        ).handleResponse(correlationId, responseMessage);
      }
    }

    return;
  },

  supervisionStrategy: {
    onFailure: () => SupervisionDirective.RESTART,
    maxRetries: 5,
    retryDelay: 1000,
  },
};

// Message Handlers - Pure Functions returning ActorHandlerResult

async function handleSpawnActor(
  message: SpawnActorMessage,
  _context: GuardianContext
): Promise<unknown> {
  try {
    // Validate required fields
    if (!message.name || typeof message.name !== 'string') {
      throw new Error('Guardian: Spawn failed - name is required');
    }

    // Generate new actor ID
    const actorId = uuidv4();
    const actorInfo: ActorInfo = {
      id: actorId,
      name: message.name,
      type: 'user',
      path: `/${message.name}`,
      parentId: message.parentId,
      childIds: [],
      supervisionDirective: SupervisionDirective.RESTART as string,
      createdAt: Date.now(),
      restartCount: 0,
    };

    // Update external state
    guardianState.actors.set(actorId, actorInfo);
    guardianState.children.add(actorId);

    // Return response for ask pattern
    return {
      actorId,
      name: message.name,
      path: `/${message.name}`,
    };
  } catch (error) {
    throw new Error(
      `Guardian: Spawn failed - ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

async function handleSpawnChild(
  message: SpawnChildMessage,
  _context: GuardianContext
): Promise<unknown> {
  try {
    log.debug(`✅ Guardian: Child actor spawned - ${message.name} at ${message.address}`);

    // Track the child actor in guardian context
    const actorInfo: ActorInfo = {
      id: message.name,
      name: message.name,
      type: 'child',
      path: message.address,
      parentId: 'guardian',
      childIds: [],
      supervisionDirective: SupervisionDirective.RESUME,
      createdAt: Date.now(),
      restartCount: 0,
    };

    // Update external state
    guardianState.actors.set(message.name, actorInfo);
    guardianState.children.add(message.name);

    // Return response for ask pattern
    return {
      actorId: message.name,
      name: message.name,
      path: message.address,
    };
  } catch (error) {
    console.error('❌ Guardian: Failed to handle SPAWN_CHILD:', error);
    throw error;
  }
}

async function handleStopActor(
  message: StopActorMessage,
  _context: GuardianContext
): Promise<unknown> {
  const actorInfo = guardianState.actors.get(message.actorId);
  if (!actorInfo) {
    // Actor doesn't exist, return success anyway
    return { success: true };
  }

  // Remove from external state
  guardianState.actors.delete(message.actorId);
  guardianState.children.delete(message.actorId);

  // Return response for ask pattern
  return { success: true };
}

async function handleActorFailed(
  message: ActorFailedMessage,
  _context: GuardianContext
): Promise<unknown> {
  // Handle actor failure

  const actorInfo = guardianState.actors.get(message.actorId);
  if (!actorInfo) {
    // Actor doesn't exist, but we still handled the failure notification
    return { handled: true };
  }

  // Update actor info with restart count
  const updatedActorInfo = {
    ...actorInfo,
    restartCount: actorInfo.restartCount + 1,
  };

  // Update external state
  guardianState.actors.set(message.actorId, updatedActorInfo);

  // Return response for ask pattern
  return { handled: true };
}

async function handleShutdown(context: GuardianContext): Promise<unknown> {
  // Update context state would happen through XState if needed
  // For now just return the response

  // Return response for ask pattern
  return {
    success: true,
    finalStats: {
      systemId: context.systemId,
      actorCount: guardianState.actors.size,
      messageCount: context.messageCount,
    },
  };
}

async function handleGetSystemInfo(context: GuardianContext): Promise<unknown> {
  log.debug('🔍 GUARDIAN DEBUG: handleGetSystemInfo called');
  log.debug('🔍 GUARDIAN DEBUG: context:', context);
  log.debug('🔍 GUARDIAN DEBUG: guardianState:', guardianState);

  // Return response for ask pattern
  const response = {
    systemId: context.systemId,
    startTime: context.startTime,
    actorCount: guardianState.actors.size,
    childCount: guardianState.children.size,
    isShuttingDown: context.isShuttingDown,
    messageCount: context.messageCount,
  };

  log.debug('🔍 GUARDIAN DEBUG: handleGetSystemInfo returning:', response);
  return response;
}

async function handleRegisterActor(): Promise<unknown> {
  // Registration handled - could integrate with directory later
  return { success: true };
}

async function handleUnregisterActor(): Promise<unknown> {
  // Unregistration handled - could integrate with directory later
  return { success: true };
}

async function handleHealthCheck(context: GuardianContext): Promise<unknown> {
  return {
    healthy: !context.isShuttingDown,
    systemId: context.systemId,
    uptime: Date.now() - context.startTime,
    actorCount: guardianState.actors.size,
    messageCount: context.messageCount,
  };
}

// Type Guards for message validation
function hasCorrelationId(message: unknown): message is { _correlationId: string } {
  return (
    message !== null &&
    typeof message === 'object' &&
    '_correlationId' in message &&
    typeof (message as Record<string, unknown>)._correlationId === 'string'
  );
}

/**
 * Guardian Actor Address - Well-known system address
 */
export const GUARDIAN_ADDRESS: ActorAddress = {
  id: 'guardian',
  type: 'system',
  node: 'local',
  path: '/system/guardian',
};

/**
 * Creates the Guardian Actor instance
 * The Guardian is the root supervisor in the pure actor model
 */
export async function createGuardianActor(actorSystem: ActorSystem): Promise<ActorRef> {
  // The guardian uses external state, so we can spawn it directly
  const guardianRef = await actorSystem.spawn(guardianBehavior, {
    id: 'guardian',
    supervised: false, // Guardian is not supervised by anyone
  });

  log.debug(`✅ Guardian actor created and registered at ${guardianRef.address.path}`);

  return guardianRef;
}
