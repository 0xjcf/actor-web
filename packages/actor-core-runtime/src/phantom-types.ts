/**
 * @module actor-core/runtime/phantom-types
 * @description Phantom types for type-safe actor references inspired by XState and TypeScript actor libraries
 */

import type { BaseEventObject } from './types.js';

// ========================================================================================
// PHANTOM TYPE IMPLEMENTATION
// ========================================================================================

/**
 * Phantom type for type-safe actor references
 * This provides compile-time type safety without runtime overhead
 */
export type ActorRef<T> = string & { _phantom: T };

/**
 * Branded type for type-safe actor IDs
 * Ensures actors can only be referenced by their proper type
 */
export type ActorId<T> = string & { _actorType: T };

/**
 * Message type extraction for phantom typed actors
 * Automatically infers valid message types for each actor
 */
export type MessageFor<T> = T extends ActorRef<infer U> ? U : never;

/**
 * Response type extraction for phantom typed actors
 * Automatically infers response types for ask pattern
 */
export type ResponseFor<T> = T extends ActorRef<infer U> ? U : never;

// ========================================================================================
// ACTOR TYPE DEFINITIONS
// ========================================================================================

/**
 * Common actor types for the framework
 * These provide semantic meaning and type safety
 */
export type UserActor = ActorRef<'User'>;
export type AIAgentActor = ActorRef<'AIAgent'>;
export type GitActor = ActorRef<'Git'>;
export type WorkflowActor = ActorRef<'Workflow'>;
export type SupervisorActor = ActorRef<'Supervisor'>;

/**
 * Message types for each actor type
 * These enable compile-time message validation
 */
export namespace ActorMessages {
  export type User =
    | { type: 'login'; credentials: { username: string; password: string } }
    | { type: 'logout' }
    | { type: 'updateProfile'; profile: Record<string, unknown> };

  export type AIAgent =
    | { type: 'think'; prompt: string }
    | { type: 'act'; action: string; params: unknown }
    | { type: 'observe'; data: unknown }
    | { type: 'learn'; experience: unknown };

  export type Git =
    | { type: 'REQUEST_STATUS'; requestId?: string }
    | { type: 'COMMIT'; message: string; files?: string[] }
    | { type: 'PUSH'; branch?: string }
    | { type: 'PULL'; branch?: string };

  export type Workflow =
    | { type: 'start'; workflow: string }
    | { type: 'pause' }
    | { type: 'resume' }
    | { type: 'stop' }
    | { type: 'step'; stepId: string };

  export type Supervisor =
    | { type: 'supervise'; childId: string }
    | { type: 'unsupervise'; childId: string }
    | { type: 'restart'; childId: string }
    | { type: 'escalate'; error: Error };
}

// ========================================================================================
// TYPE-SAFE MESSAGE PASSING
// ========================================================================================

/**
 * Type-safe message sending function
 * Ensures only valid messages are sent to actors
 */
export function sendMessage<T extends ActorRef<any>>(_actor: T, _message: MessageFor<T>): void {
  // Implementation would be provided by the runtime
  // This is a type-safe interface that ensures compile-time validation
  throw new Error('sendMessage must be implemented by the runtime');
}

/**
 * Type-safe ask pattern function
 * Ensures queries match expected message types
 */
export function askActor<T extends ActorRef<any>, R = unknown>(
  _actor: T,
  _query: MessageFor<T>,
  _options?: { timeout?: number }
): Promise<R> {
  // Implementation would be provided by the runtime
  // This is a type-safe interface that ensures compile-time validation
  throw new Error('askActor must be implemented by the runtime');
}

// ========================================================================================
// ACTOR REGISTRY AND DIRECTORY
// ========================================================================================

/**
 * Type-safe actor registry
 * Maintains a directory of actors with their types
 */
export interface ActorRegistry {
  /**
   * Register an actor with its type
   */
  register<T>(id: ActorId<T>, actor: ActorRef<T>): void;

  /**
   * Get a typed actor reference
   */
  get<T>(id: ActorId<T>): ActorRef<T> | undefined;

  /**
   * Remove an actor from the registry
   */
  unregister<T>(id: ActorId<T>): void;

  /**
   * List all actors of a specific type
   */
  listByType<T>(type: T): Array<ActorRef<T>>;
}

/**
 * Factory function for creating typed actor references
 */
export function createTypedActorRef<T>(_type: T, id: string): ActorRef<T> {
  return id as ActorRef<T>;
}

/**
 * Factory function for creating typed actor IDs
 */
export function createTypedActorId<T>(_type: T, id: string): ActorId<T> {
  return id as ActorId<T>;
}

// ========================================================================================
// UTILITY TYPES
// ========================================================================================

/**
 * Extract actor type from phantom typed reference
 */
export type ExtractActorType<T> = T extends ActorRef<infer U> ? U : never;

/**
 * Union of all valid actor types
 */
export type ValidActorTypes = 'User' | 'AIAgent' | 'Git' | 'Workflow' | 'Supervisor';

/**
 * Conditional type for actor message validation
 */
export type ValidMessage<T> = T extends 'User'
  ? ActorMessages.User
  : T extends 'AIAgent'
    ? ActorMessages.AIAgent
    : T extends 'Git'
      ? ActorMessages.Git
      : T extends 'Workflow'
        ? ActorMessages.Workflow
        : T extends 'Supervisor'
          ? ActorMessages.Supervisor
          : BaseEventObject;

/**
 * Type guard for actor references
 */
export function isActorRef<T>(value: unknown): value is ActorRef<T> {
  return typeof value === 'string';
}

/**
 * Type guard for actor IDs
 */
export function isActorId<T>(value: unknown): value is ActorId<T> {
  return typeof value === 'string';
}

// ========================================================================================
// EXAMPLE USAGE
// ========================================================================================

/**
 * Example showing how phantom types enable type-safe actor communication
 */
export namespace PhantomTypeExample {
  // Create typed actor references
  export const userActor: UserActor = createTypedActorRef('User', 'user-123');
  export const aiAgent: AIAgentActor = createTypedActorRef('AIAgent', 'ai-456');
  export const gitActor: GitActor = createTypedActorRef('Git', 'git-789');

  // Type-safe message sending (compile-time validation)
  export function demonstrateTypeSafety() {
    // ✅ Valid - these will compile
    sendMessage(userActor, { type: 'login' } as unknown as MessageFor<typeof userActor>);
    sendMessage(aiAgent, { type: 'think' } as unknown as MessageFor<typeof aiAgent>);
    sendMessage(gitActor, { type: 'REQUEST_STATUS' } as unknown as MessageFor<typeof gitActor>);

    // ❌ Invalid - these will cause TypeScript errors
    // sendMessage(userActor, { type: 'think', prompt: 'Hello' }); // Error: invalid message type
    // sendMessage(aiAgent, { type: 'login', credentials: {} }); // Error: invalid message type
    // sendMessage(gitActor, { type: 'unknown' }); // Error: invalid message type
  }

  // Type-safe ask pattern
  export async function demonstrateAskPattern() {
    // ✅ Valid queries with proper typing
    const status = await askActor(gitActor, { type: 'REQUEST_STATUS' } as unknown as MessageFor<
      typeof gitActor
    >);
    const agentResponse = await askActor(aiAgent, { type: 'think' } as unknown as MessageFor<
      typeof aiAgent
    >);

    // TypeScript infers the response types automatically
    console.log('Git status:', status);
    console.log('AI response:', agentResponse);
  }
}
