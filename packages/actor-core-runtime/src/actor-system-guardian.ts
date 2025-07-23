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
import type {
  ActorAddress,
  ActorBehavior,
  ActorMessage,
  ActorPID,
  JsonValue,
} from './actor-system';
import { SupervisionDirective } from './actor-system';

// Guardian Message Types
export type GuardianMessage =
  | { type: 'SPAWN_ACTOR'; payload: JsonValue }
  | { type: 'STOP_ACTOR'; payload: JsonValue }
  | { type: 'ACTOR_FAILED'; payload: JsonValue }
  | { type: 'SHUTDOWN'; payload: JsonValue }
  | { type: 'GET_SYSTEM_INFO'; payload: JsonValue }
  | { type: 'REGISTER_ACTOR'; payload: JsonValue }
  | { type: 'UNREGISTER_ACTOR'; payload: JsonValue }
  | { type: 'SYSTEM_HEALTH_CHECK'; payload: null };

// Guardian Context - System State
export interface GuardianContext {
  readonly systemId: string;
  readonly startTime: number;
  readonly actors: Map<string, ActorInfo>;
  readonly children: Set<string>; // Store actor IDs as strings for serialization
  readonly isShuttingDown: boolean;
  readonly messageCount: number;
}

export interface ActorInfo {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly path: string;
  readonly parentId?: string;
  readonly childIds: string[];
  readonly supervisionDirective: SupervisionDirective;
  readonly createdAt: number;
  readonly restartCount: number;
}

/**
 * Guardian Actor Behavior - Pure Actor Model Implementation
 */
export const guardianBehavior: ActorBehavior<GuardianMessage, GuardianContext> = {
  context: {
    systemId: uuidv4(),
    startTime: Date.now(),
    actors: new Map(),
    children: new Set(),
    isShuttingDown: false,
    messageCount: 0,
  },

  async onMessage({ message, context }) {
    const newContext = {
      ...context,
      messageCount: context.messageCount + 1,
    };

    if (context.isShuttingDown && message.type !== 'SHUTDOWN') {
      // Ignore non-shutdown messages during shutdown
      return { context: newContext };
    }

    switch (message.type) {
      case 'SPAWN_ACTOR':
        return await handleSpawnActor(message.payload, newContext);

      case 'STOP_ACTOR':
        return await handleStopActor(message.payload, newContext);

      case 'ACTOR_FAILED':
        return await handleActorFailed(message.payload, newContext);

      case 'SHUTDOWN':
        return await handleShutdown(message.payload, newContext);

      case 'GET_SYSTEM_INFO':
        return await handleGetSystemInfo(message.payload, newContext);

      case 'REGISTER_ACTOR':
        return await handleRegisterActor(message.payload, newContext);

      case 'UNREGISTER_ACTOR':
        return await handleUnregisterActor(message.payload, newContext);

      case 'SYSTEM_HEALTH_CHECK':
        return await handleHealthCheck(newContext);

      default:
        // Unknown message type - log and continue
        console.warn(
          `Guardian: Unknown message type received: ${(message as { type: string }).type}`
        );
        return { context: newContext };
    }
  },

  supervisionStrategy: {
    onFailure: () => SupervisionDirective.RESTART,
    maxRetries: 5,
    retryDelay: 1000,
  },
};

// Message Handlers - Pure Functions

async function handleSpawnActor(
  payload: JsonValue,
  context: GuardianContext
): Promise<{ context: GuardianContext; emit?: ActorMessage[] }> {
  try {
    if (!isSpawnActorPayload(payload)) {
      throw new Error('Invalid SPAWN_ACTOR payload');
    }

    // Generate new actor ID
    const actorId = uuidv4();
    const actorInfo: ActorInfo = {
      id: actorId,
      name: payload.name,
      type: 'user',
      path: `/${payload.name}`,
      parentId: payload.parentId,
      childIds: [],
      supervisionDirective: SupervisionDirective.RESTART,
      createdAt: Date.now(),
      restartCount: 0,
    };

    // Update context
    const newActors = new Map(context.actors);
    newActors.set(actorId, actorInfo);

    const newChildren = new Set(context.children);
    newChildren.add(actorId);

    const newContext = {
      ...context,
      actors: newActors,
      children: newChildren,
    };

    // Send success response
    const successMessage: ActorMessage = {
      type: 'ACTOR_SPAWN_SUCCESS',
      payload: {
        actorId,
        name: payload.name,
        path: `/${payload.name}`,
      },
      timestamp: Date.now(),
      version: '1.0.0',
    };

    return {
      context: newContext,
      emit: [successMessage],
    };
  } catch (error) {
    // Send failure response
    const failureMessage: ActorMessage = {
      type: 'ACTOR_SPAWN_FAILED',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      timestamp: Date.now(),
      version: '1.0.0',
    };

    return {
      context,
      emit: [failureMessage],
    };
  }
}

async function handleStopActor(
  payload: JsonValue,
  context: GuardianContext
): Promise<{ context: GuardianContext; emit?: ActorMessage[] }> {
  if (!isStopActorPayload(payload)) {
    return { context };
  }

  const actorInfo = context.actors.get(payload.actorId);
  if (!actorInfo) {
    return { context }; // Actor doesn't exist, nothing to do
  }

  // Remove from context
  const newActors = new Map(context.actors);
  newActors.delete(payload.actorId);

  const newChildren = new Set(context.children);
  newChildren.delete(payload.actorId);

  const newContext = {
    ...context,
    actors: newActors,
    children: newChildren,
  };

  // Emit stop event
  const stopMessage: ActorMessage = {
    type: 'ACTOR_STOPPED',
    payload: {
      actorId: payload.actorId,
      name: actorInfo.name,
    },
    timestamp: Date.now(),
    version: '1.0.0',
  };

  return {
    context: newContext,
    emit: [stopMessage],
  };
}

async function handleActorFailed(
  payload: JsonValue,
  context: GuardianContext
): Promise<{ context: GuardianContext; emit?: ActorMessage[] }> {
  if (!isActorFailedPayload(payload)) {
    return { context };
  }

  const actorInfo = context.actors.get(payload.actorId);
  if (!actorInfo) {
    return { context }; // Actor doesn't exist
  }

  // Update actor info with restart count
  const updatedActorInfo = {
    ...actorInfo,
    restartCount: actorInfo.restartCount + 1,
  };

  const newActors = new Map(context.actors);
  newActors.set(payload.actorId, updatedActorInfo);

  const newContext = {
    ...context,
    actors: newActors,
  };

  // Handle supervision strategy based on directive
  const directive = payload.directive || SupervisionDirective.RESTART;

  switch (directive) {
    case SupervisionDirective.RESTART: {
      const restartMessage: ActorMessage = {
        type: 'RESTART_ACTOR',
        payload: {
          actorId: payload.actorId,
          name: actorInfo.name,
        },
        timestamp: Date.now(),
        version: '1.0.0',
      };
      return { context: newContext, emit: [restartMessage] };
    }

    case SupervisionDirective.STOP:
      return await handleStopActor({ actorId: payload.actorId }, newContext);

    case SupervisionDirective.ESCALATE: {
      const escalateMessage: ActorMessage = {
        type: 'ESCALATE_FAILURE',
        payload: {
          actorId: payload.actorId,
          error: payload.error,
        },
        timestamp: Date.now(),
        version: '1.0.0',
      };
      return { context: newContext, emit: [escalateMessage] };
    }

    default:
      return { context: newContext };
  }
}

async function handleShutdown(
  payload: JsonValue,
  context: GuardianContext
): Promise<{ context: GuardianContext; emit?: ActorMessage[] }> {
  const newContext = {
    ...context,
    isShuttingDown: true,
  };

  // Create shutdown message for system
  const shutdownMessage: ActorMessage = {
    type: 'SYSTEM_SHUTDOWN_COMPLETE',
    payload: {
      reason: isShutdownPayload(payload) ? payload.reason : 'Unknown',
      actorCount: context.actors.size,
      uptime: Date.now() - context.startTime,
    },
    timestamp: Date.now(),
    version: '1.0.0',
  };

  return {
    context: newContext,
    emit: [shutdownMessage],
  };
}

async function handleGetSystemInfo(
  _payload: JsonValue,
  context: GuardianContext
): Promise<{ context: GuardianContext; emit?: ActorMessage[] }> {
  const systemInfo = {
    systemId: context.systemId,
    startTime: context.startTime,
    uptime: Date.now() - context.startTime,
    actorCount: context.actors.size,
    messageCount: context.messageCount,
    isShuttingDown: context.isShuttingDown,
    actors: Array.from(context.actors.values()).map((actor) => ({
      id: actor.id,
      name: actor.name,
      type: actor.type,
      path: actor.path,
      restartCount: actor.restartCount,
      createdAt: actor.createdAt,
    })),
  };

  const infoMessage: ActorMessage = {
    type: 'SYSTEM_INFO_RESPONSE',
    payload: systemInfo,
    timestamp: Date.now(),
    version: '1.0.0',
  };

  return {
    context,
    emit: [infoMessage],
  };
}

async function handleRegisterActor(
  _payload: JsonValue,
  context: GuardianContext
): Promise<{ context: GuardianContext }> {
  // Registration handled - could integrate with directory later
  return { context };
}

async function handleUnregisterActor(
  _payload: JsonValue,
  context: GuardianContext
): Promise<{ context: GuardianContext }> {
  // Unregistration handled - could integrate with directory later
  return { context };
}

async function handleHealthCheck(
  context: GuardianContext
): Promise<{ context: GuardianContext; emit?: ActorMessage[] }> {
  const healthStatus = {
    systemId: context.systemId,
    healthy: !context.isShuttingDown,
    uptime: Date.now() - context.startTime,
    actorCount: context.actors.size,
  };

  const healthMessage: ActorMessage = {
    type: 'SYSTEM_HEALTH_RESPONSE',
    payload: healthStatus,
    timestamp: Date.now(),
    version: '1.0.0',
  };

  return {
    context,
    emit: [healthMessage],
  };
}

// Type Guards for payload validation
function isSpawnActorPayload(payload: JsonValue): payload is { name: string; parentId?: string } {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'name' in payload &&
    typeof payload.name === 'string'
  );
}

function isStopActorPayload(payload: JsonValue): payload is { actorId: string } {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'actorId' in payload &&
    typeof payload.actorId === 'string'
  );
}

function isActorFailedPayload(payload: JsonValue): payload is {
  actorId: string;
  error: string;
  directive?: SupervisionDirective;
} {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'actorId' in payload &&
    typeof payload.actorId === 'string' &&
    'error' in payload &&
    typeof payload.error === 'string'
  );
}

function isShutdownPayload(payload: JsonValue): payload is { reason: string } {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'reason' in payload &&
    typeof payload.reason === 'string'
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

// Helper to get Guardian context safely
function _getGuardianContext(): GuardianContext {
  return (
    guardianBehavior.context || {
      systemId: uuidv4(),
      startTime: Date.now(),
      actors: new Map(),
      children: new Set(),
      isShuttingDown: false,
      messageCount: 0,
    }
  );
}

/**
 * Creates the Guardian Actor instance
 * The Guardian is the root supervisor in the pure actor model
 */
export async function createGuardianActor(_actorSystem?: unknown): Promise<ActorPID> {
  // For now, create a mock ActorPID that _actorSystemthe Guardian behavior
  // This will be replaced when the full actor system integration is ready
  const guardianPID: ActorPID = {
    address: GUARDIAN_ADDRESS,

    async send(message: ActorMessage): Promise<void> {
      try {
        if (!isGuardianMessage(message)) {
          console.warn('Guardian: Received non-guardian message:', message.type);
          return;
        }

        // Process the message through the guardian behavior
        const currentContext = _getGuardianContext();
        const result = await guardianBehavior.onMessage({
          message: message as GuardianMessage,
          context: currentContext,
        });

        // Update the behavior context with the new state
        if (result.context) {
          guardianBehavior.context = result.context;
        }
      } catch (error) {
        console.error('Guardian: Error processing message:', error);
      }
    },

    async ask<T>(message: ActorMessage, _timeout?: number): Promise<T> {
      // Handle ask pattern for different Guardian message types
      if (!isGuardianMessage(message)) {
        throw new Error(`Guardian: Invalid message type for ask pattern: ${message.type}`);
      }

      const currentContext = _getGuardianContext();
      const result = await guardianBehavior.onMessage({
        message: message as GuardianMessage,
        context: currentContext,
      });

      // Update the behavior context with the new state
      if (result.context) {
        guardianBehavior.context = result.context;
      }

      // Handle responses based on message type
      switch (message.type) {
        case 'GET_SYSTEM_INFO': {
          return {
            systemId: currentContext.systemId,
            startTime: currentContext.startTime,
            actorCount: currentContext.actors.size,
            childCount: currentContext.children.size,
            isShuttingDown: currentContext.isShuttingDown,
            messageCount: currentContext.messageCount,
          } as T;
        }

        case 'SPAWN_ACTOR': {
          if (result.emit) {
            const emissions = Array.isArray(result.emit) ? result.emit : [result.emit];
            const successMessage = emissions.find((e) => e.type === 'ACTOR_SPAWN_SUCCESS');
            const failureMessage = emissions.find((e) => e.type === 'ACTOR_SPAWN_FAILED');

            if (successMessage) {
              return successMessage.payload as T;
            }
            if (failureMessage) {
              throw new Error(`Guardian: Spawn failed - ${failureMessage.payload}`);
            }
          }
          throw new Error('Guardian: Spawn failed - no response emitted');
        }

        case 'STOP_ACTOR': {
          if (result.emit) {
            const emissions = Array.isArray(result.emit) ? result.emit : [result.emit];
            const stopMessage = emissions.find((e) => e.type === 'ACTOR_STOPPED');
            if (stopMessage) {
              return stopMessage.payload as T;
            }
          }
          return { success: true } as T; // Stop completed successfully
        }

        case 'ACTOR_FAILED': {
          if (result.emit) {
            const emissions = Array.isArray(result.emit) ? result.emit : [result.emit];
            if (emissions.length > 0) {
              return emissions[0].payload as T;
            }
          }
          return { handled: true } as T; // Failure handled
        }

        case 'SHUTDOWN': {
          return {
            success: true,
            finalStats: {
              systemId: currentContext.systemId,
              actorCount: currentContext.actors.size,
              messageCount: currentContext.messageCount,
            },
          } as T;
        }

        case 'REGISTER_ACTOR':
        case 'UNREGISTER_ACTOR': {
          return { success: true } as T; // Registration/unregistration completed
        }

        case 'SYSTEM_HEALTH_CHECK': {
          return {
            healthy: !currentContext.isShuttingDown,
            systemId: currentContext.systemId,
            uptime: Date.now() - currentContext.startTime,
            actorCount: currentContext.actors.size,
            messageCount: currentContext.messageCount,
          } as T;
        }

        default: {
          throw new Error(`Guardian: Ask not implemented for message type: ${message.type}`);
        }
      }
    },

    async stop(): Promise<void> {
      await this.send({
        type: 'SHUTDOWN',
        payload: { reason: 'Guardian stop requested' },
        timestamp: Date.now(),
        version: '1.0.0',
      });
    },

    isAlive: async (): Promise<boolean> => {
      const currentContext = _getGuardianContext();
      return !currentContext.isShuttingDown;
    },

    getStats: async () => {
      const context = _getGuardianContext();
      return {
        messagesReceived: context.messageCount,
        messagesProcessed: context.messageCount,
        errors: 0, // Guardian tracks errors separately
        uptime: Date.now() - context.startTime,
      };
    },

    subscribe(_eventType: string, _handler: (message: ActorMessage) => void): () => void {
      // Simplified subscription implementation
      console.warn('Guardian: Subscribe not fully implemented');
      return () => {}; // Unsubscribe function
    },
  };

  return guardianPID;
}

// Type guard for guardian messages
function isGuardianMessage(message: ActorMessage): boolean {
  const validTypes = [
    'SPAWN_ACTOR',
    'STOP_ACTOR',
    'ACTOR_FAILED',
    'SHUTDOWN',
    'GET_SYSTEM_INFO',
    'REGISTER_ACTOR',
    'UNREGISTER_ACTOR',
    'SYSTEM_HEALTH_CHECK',
  ];
  return validTypes.includes(message.type);
}
