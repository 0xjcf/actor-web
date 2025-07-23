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
import type { Actor, AnyStateMachine } from 'xstate';
import type {
  ActorAddress,
  ActorBehavior,
  ActorDependencies,
  ActorMessage,
  ActorPID,
  JsonValue,
} from './actor-system';
import { SupervisionDirective } from './actor-system';
import type { ScopedLogger } from './logger';
import type { DomainEvent, MessagePlan } from './message-plan';

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

// Guardian Context - System State (now managed by XState machine)
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
export const guardianBehavior: ActorBehavior<GuardianMessage, ActorMessage> = {
  async onMessage({ message, machine, dependencies }) {
    const context = machine.getSnapshot().context as GuardianContext;
    const newContext = {
      ...context,
      messageCount: context.messageCount + 1,
    };

    if (context.isShuttingDown && message.type !== 'SHUTDOWN') {
      // Ignore non-shutdown messages during shutdown
      return;
    }

    switch (message.type) {
      case 'SPAWN_ACTOR':
        return await handleSpawnActor(message.payload, newContext, dependencies);

      case 'STOP_ACTOR':
        return await handleStopActor(message.payload, newContext, dependencies);

      case 'ACTOR_FAILED':
        return await handleActorFailed(message.payload, newContext, dependencies);

      case 'SHUTDOWN':
        return await handleShutdown(message.payload, newContext, dependencies);

      case 'GET_SYSTEM_INFO':
        return await handleGetSystemInfo(message.payload, newContext, dependencies);

      case 'REGISTER_ACTOR':
        return await handleRegisterActor(message.payload, newContext, dependencies);

      case 'UNREGISTER_ACTOR':
        return await handleUnregisterActor(message.payload, newContext, dependencies);

      case 'SYSTEM_HEALTH_CHECK':
        return await handleHealthCheck(newContext, dependencies);

      default:
        // Unknown message type - log and continue
        (dependencies.logger as ScopedLogger).warn(
          `Guardian: Unknown message type received: ${(message as { type: string }).type}`
        );
        return;
    }
  },

  supervisionStrategy: {
    onFailure: () => SupervisionDirective.RESTART,
    maxRetries: 5,
    retryDelay: 1000,
  },
};

// Message Handlers - Pure Functions returning MessagePlan

async function handleSpawnActor(
  payload: JsonValue,
  context: GuardianContext,
  dependencies: ActorDependencies
): Promise<MessagePlan<DomainEvent>> {
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

    // Update machine context
    const newActors = new Map(context.actors);
    newActors.set(actorId, actorInfo);

    const newChildren = new Set(context.children);
    newChildren.add(actorId);

    // Update machine state
    (dependencies.machine as Actor<AnyStateMachine>).send({
      type: 'UPDATE_CONTEXT',
      actors: newActors,
      children: newChildren,
    });

    // Return success domain event
    return {
      type: 'ACTOR_SPAWN_SUCCESS',
      actorId,
      name: payload.name,
      path: `/${payload.name}`,
    };
  } catch (error) {
    // Return failure domain event
    return {
      type: 'ACTOR_SPAWN_FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleStopActor(
  payload: JsonValue,
  context: GuardianContext,
  dependencies: ActorDependencies
): Promise<MessagePlan<DomainEvent> | undefined> {
  if (!isStopActorPayload(payload)) {
    return;
  }

  const actorInfo = context.actors.get(payload.actorId);
  if (!actorInfo) {
    return; // Actor doesn't exist, nothing to do
  }

  // Update machine context
  const newActors = new Map(context.actors);
  newActors.delete(payload.actorId);

  const newChildren = new Set(context.children);
  newChildren.delete(payload.actorId);

  (dependencies.machine as Actor<AnyStateMachine>).send({
    type: 'UPDATE_CONTEXT',
    actors: newActors,
    children: newChildren,
  });

  // Return stop domain event
  return {
    type: 'ACTOR_STOPPED',
    actorId: payload.actorId,
    name: actorInfo.name,
  };
}

async function handleActorFailed(
  payload: JsonValue,
  context: GuardianContext,
  dependencies: ActorDependencies
): Promise<MessagePlan<DomainEvent> | undefined> {
  if (!isActorFailedPayload(payload)) {
    return;
  }

  const actorInfo = context.actors.get(payload.actorId);
  if (!actorInfo) {
    return; // Actor doesn't exist
  }

  // Update actor info with restart count
  const updatedActorInfo = {
    ...actorInfo,
    restartCount: actorInfo.restartCount + 1,
  };

  const newActors = new Map(context.actors);
  newActors.set(payload.actorId, updatedActorInfo);

  (dependencies.machine as Actor<AnyStateMachine>).send({
    type: 'UPDATE_CONTEXT',
    actors: newActors,
  });

  // Handle supervision strategy based on directive
  const directive = payload.directive || SupervisionDirective.RESTART;

  switch (directive) {
    case SupervisionDirective.RESTART:
      return {
        type: 'RESTART_ACTOR',
        actorId: payload.actorId,
        name: actorInfo.name,
      };

    case SupervisionDirective.STOP:
      return await handleStopActor({ actorId: payload.actorId }, context, dependencies);

    case SupervisionDirective.ESCALATE:
      return {
        type: 'ESCALATE_FAILURE',
        actorId: payload.actorId,
        error: payload.error,
      };

    default:
      return;
  }
}

async function handleShutdown(
  payload: JsonValue,
  context: GuardianContext,
  dependencies: ActorDependencies
): Promise<MessagePlan<DomainEvent>> {
  // Update machine state to shutting down
  (dependencies.machine as Actor<AnyStateMachine>).send({ type: 'SHUTDOWN' });

  // Return shutdown domain event
  return {
    type: 'SYSTEM_SHUTDOWN_COMPLETE',
    reason: isShutdownPayload(payload) ? payload.reason : 'Unknown',
    actorCount: context.actors.size,
    uptime: Date.now() - context.startTime,
  };
}

async function handleGetSystemInfo(
  _payload: JsonValue,
  context: GuardianContext,
  _dependencies: ActorDependencies
): Promise<MessagePlan<DomainEvent>> {
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

  return {
    type: 'SYSTEM_INFO_RESPONSE',
    ...systemInfo,
  };
}

async function handleRegisterActor(
  _payload: JsonValue,
  _context: GuardianContext,
  _dependencies: ActorDependencies
): Promise<void> {
  // Registration handled - could integrate with directory later
}

async function handleUnregisterActor(
  _payload: JsonValue,
  _context: GuardianContext,
  _dependencies: ActorDependencies
): Promise<void> {
  // Unregistration handled - could integrate with directory later
}

async function handleHealthCheck(
  context: GuardianContext,
  _dependencies: ActorDependencies
): Promise<MessagePlan<DomainEvent>> {
  return {
    type: 'SYSTEM_HEALTH_RESPONSE',
    systemId: context.systemId,
    healthy: !context.isShuttingDown,
    uptime: Date.now() - context.startTime,
    actorCount: context.actors.size,
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

/**
 * Creates the Guardian Actor instance
 * The Guardian is the root supervisor in the pure actor model
 */
export async function createGuardianActor(_actorSystem: unknown): Promise<ActorPID> {
  // Track Guardian shutdown state
  let isShutdown = false;

  // Create a proper ActorPID using the actor system
  // This is a simplified implementation that should be replaced with proper system integration
  const guardianPID: ActorPID = {
    address: GUARDIAN_ADDRESS,

    async send(message: ActorMessage): Promise<void> {
      // This should integrate with the actual actor system
      console.log('Guardian: Received message:', message.type);

      // Update shutdown state when SHUTDOWN message is received
      if (message.type === 'SHUTDOWN') {
        isShutdown = true;
      }
    },

    async ask<T>(message: ActorMessage, _timeout?: number): Promise<T> {
      // This should integrate with the actual actor system
      console.log('Guardian: Ask pattern for:', message.type);
      return {} as T;
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
      return !isShutdown; // Return false after shutdown
    },

    getStats: async () => {
      return {
        messagesReceived: 0,
        messagesProcessed: 0,
        errors: 0,
        uptime: Date.now(),
      };
    },

    subscribe(_eventType: string, _handler: (message: ActorMessage) => void): () => void {
      // Simplified subscription implementation
      return () => {}; // Unsubscribe function
    },
  };

  return guardianPID;
}
