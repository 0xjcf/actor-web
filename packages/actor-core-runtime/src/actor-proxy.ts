/**
 * @module actor-core/runtime/actor-proxy
 * @description tRPC-inspired actor proxies for reduced boilerplate
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorRef } from './actor-ref.js';
import { createActorRef } from './create-actor-ref.js';
import { Logger } from './logger.js';
import type { BaseEventObject } from './types.js';

// ========================================================================================
// PROXY EVENT TYPES
// ========================================================================================

/**
 * Event types for actor proxy communication
 */
export interface ProxyQueryEvent extends BaseEventObject {
  type: 'PROXY_QUERY';
  procedure: string;
  input: unknown;
  correlationId: string;
}

export interface ProxyMutationEvent extends BaseEventObject {
  type: 'PROXY_MUTATION';
  procedure: string;
  input: unknown;
  correlationId: string;
}

export interface ProxySubscriptionEvent extends BaseEventObject {
  type: 'PROXY_SUBSCRIPTION';
  procedure: string;
  input: unknown;
}

export interface ProxyUnsubscribeEvent extends BaseEventObject {
  type: 'PROXY_UNSUBSCRIBE';
  procedure: string;
}

export interface SubscriptionDataEvent extends BaseEventObject {
  type: 'SUBSCRIPTION_DATA';
  procedure: string;
  data: unknown;
}

export type ProxyEvent =
  | ProxyQueryEvent
  | ProxyMutationEvent
  | ProxySubscriptionEvent
  | ProxyUnsubscribeEvent
  | SubscriptionDataEvent;

// ========================================================================================
// ACTOR PROXY TYPES
// ========================================================================================

/**
 * Query definition for actor proxy
 */
export interface QueryDefinition<TInput = unknown, TOutput = unknown> {
  input: TInput;
  output: TOutput;
}

/**
 * Mutation definition for actor proxy
 */
export interface MutationDefinition<TInput = unknown, TOutput = unknown> {
  input: TInput;
  output: TOutput;
}

/**
 * Subscription definition for actor proxy
 */
export interface SubscriptionDefinition<TInput = unknown, TOutput = unknown> {
  input: TInput;
  output: TOutput;
}

/**
 * Actor procedure type
 */
export type ActorProcedure<TInput = unknown, TOutput = unknown> =
  | { type: 'query'; def: QueryDefinition<TInput, TOutput> }
  | { type: 'mutation'; def: MutationDefinition<TInput, TOutput> }
  | { type: 'subscription'; def: SubscriptionDefinition<TInput, TOutput> };

/**
 * Actor router definition
 */
export interface ActorRouter {
  [key: string]: ActorProcedure<unknown, unknown> | ActorRouter;
}

/**
 * Infer input type from procedure
 */
export type InferInput<T> = T extends ActorProcedure<infer I, unknown> ? I : never;

/**
 * Infer output type from procedure
 */
export type InferOutput<T> = T extends ActorProcedure<unknown, infer O> ? O : never;

/**
 * Create proxy client type from router
 */
export type CreateProxyClient<T extends ActorRouter> = {
  [K in keyof T]: T[K] extends ActorProcedure<unknown, unknown>
    ? T[K] extends { type: 'query' }
      ? (input: InferInput<T[K]>) => Promise<InferOutput<T[K]>>
      : T[K] extends { type: 'mutation' }
        ? (input: InferInput<T[K]>) => Promise<InferOutput<T[K]>>
        : T[K] extends { type: 'subscription' }
          ? (input: InferInput<T[K]>) => {
              subscribe: (callback: (data: InferOutput<T[K]>) => void) => {
                unsubscribe: () => void;
              };
            }
          : never
    : T[K] extends ActorRouter
      ? CreateProxyClient<T[K]>
      : never;
};

// ========================================================================================
// ACTOR PROXY BUILDER
// ========================================================================================

/**
 * Actor proxy builder for creating type-safe actor APIs
 */
export class ActorProxyBuilder {
  private procedures: Record<string, ActorProcedure> = {};
  private logger = Logger.namespace('ACTOR_PROXY_BUILDER');

  /**
   * Add a query procedure
   */
  query<TInput = unknown, TOutput = unknown>(name: string): this {
    this.logger.debug('Adding query procedure', { name });
    this.procedures[name] = {
      type: 'query',
      def: { input: undefined as TInput, output: undefined as TOutput },
    };
    return this;
  }

  /**
   * Add a mutation procedure
   */
  mutation<TInput = unknown, TOutput = unknown>(name: string): this {
    this.logger.debug('Adding mutation procedure', { name });
    this.procedures[name] = {
      type: 'mutation',
      def: { input: undefined as TInput, output: undefined as TOutput },
    };
    return this;
  }

  /**
   * Add a subscription procedure
   */
  subscription<TInput = unknown, TOutput = unknown>(name: string): this {
    this.logger.debug('Adding subscription procedure', { name });
    this.procedures[name] = {
      type: 'subscription',
      def: { input: undefined as TInput, output: undefined as TOutput },
    };
    return this;
  }

  /**
   * Build the actor router
   */
  build(): ActorRouter {
    this.logger.info('Building actor router', {
      procedureCount: Object.keys(this.procedures).length,
    });
    return { ...this.procedures };
  }
}

// ========================================================================================
// ACTOR PROXY CLIENT
// ========================================================================================

/**
 * Actor proxy client for type-safe actor communication
 */
export class ActorProxyClient<T extends ActorRouter> {
  private actorRef: ActorRef<ProxyEvent>;
  private router: T;
  private logger = Logger.namespace('ACTOR_PROXY_CLIENT');

  constructor(actorRef: ActorRef<ProxyEvent>, router: T) {
    this.actorRef = actorRef;
    this.router = router;
    this.logger.debug('Actor proxy client created', { actorId: actorRef.id });
  }

  /**
   * Type guard for proxy events
   */
  private isProxyEvent(event: unknown): event is ProxyEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      typeof (event as BaseEventObject).type === 'string'
    );
  }

  /**
   * Type guard for subscription data events
   */
  private isSubscriptionDataEvent(event: unknown): event is SubscriptionDataEvent {
    return (
      this.isProxyEvent(event) &&
      event.type === 'SUBSCRIPTION_DATA' &&
      'procedure' in event &&
      'data' in event
    );
  }

  /**
   * Create proxy client with type-safe procedures
   */
  createProxy(): CreateProxyClient<T> {
    const proxy = {} as CreateProxyClient<T>;

    for (const [name, procedure] of Object.entries(this.router)) {
      if (this.isProcedure(procedure)) {
        switch (procedure.type) {
          case 'query':
            (proxy as Record<string, unknown>)[name] = async (input: unknown) => {
              this.logger.debug('Executing query', { name, input });
              const queryEvent: ProxyQueryEvent = {
                type: 'PROXY_QUERY',
                procedure: name,
                input,
                correlationId: this.generateCorrelationId(),
              };
              const result = await this.actorRef.ask(queryEvent);
              return result;
            };
            break;

          case 'mutation':
            (proxy as Record<string, unknown>)[name] = async (input: unknown) => {
              this.logger.debug('Executing mutation', { name, input });
              const mutationEvent: ProxyMutationEvent = {
                type: 'PROXY_MUTATION',
                procedure: name,
                input,
                correlationId: this.generateCorrelationId(),
              };
              const result = await this.actorRef.ask(mutationEvent);
              return result;
            };
            break;

          case 'subscription':
            (proxy as Record<string, unknown>)[name] = (input: unknown) => {
              this.logger.debug('Creating subscription', { name, input });
              return {
                subscribe: (callback: (data: unknown) => void) => {
                  const subscriptionEvent: ProxySubscriptionEvent = {
                    type: 'PROXY_SUBSCRIPTION',
                    procedure: name,
                    input,
                  };
                  this.actorRef.send(subscriptionEvent);

                  const subscription = this.actorRef.subscribe((event) => {
                    if (this.isSubscriptionDataEvent(event) && event.procedure === name) {
                      callback(event.data);
                    }
                  });

                  return {
                    unsubscribe: () => {
                      subscription();
                      const unsubscribeEvent: ProxyUnsubscribeEvent = {
                        type: 'PROXY_UNSUBSCRIBE',
                        procedure: name,
                      };
                      this.actorRef.send(unsubscribeEvent);
                    },
                  };
                },
              };
            };
            break;
        }
      } else {
        // Handle nested routers
        if (this.isActorRouter(procedure)) {
          const nestedClient = new ActorProxyClient(this.actorRef, procedure);
          (proxy as Record<string, unknown>)[name] = nestedClient.createProxy();
        }
      }
    }

    return proxy;
  }

  /**
   * Generate a unique correlation ID
   */
  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Type guard for actor procedures
   */
  private isProcedure(value: unknown): value is ActorProcedure {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      'def' in value &&
      typeof (value as ActorProcedure).type === 'string'
    );
  }

  /**
   * Type guard for actor routers
   */
  private isActorRouter(value: unknown): value is ActorRouter {
    return typeof value === 'object' && value !== null && !this.isProcedure(value);
  }
}

// ========================================================================================
// ACTOR PROXY FACTORY
// ========================================================================================

/**
 * Create an actor proxy builder
 */
export function createActorProxyBuilder(): ActorProxyBuilder {
  return new ActorProxyBuilder();
}

/**
 * Create an actor proxy client
 */
export function createActorProxyClient<T extends ActorRouter>(
  actorRef: ActorRef<ProxyEvent>,
  router: T
): CreateProxyClient<T> {
  const client = new ActorProxyClient(actorRef, router);
  return client.createProxy();
}

/**
 * Create an actor with proxy support
 */
export function createProxyActor<T extends ActorRouter>(
  machine: AnyStateMachine,
  router: T
): {
  actor: ActorRef<ProxyEvent>;
  proxy: CreateProxyClient<T>;
} {
  const actor = createActorRef(machine) as ActorRef<ProxyEvent>;
  const proxy = createActorProxyClient(actor, router);

  return { actor, proxy };
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Infer router type from actor proxy builder
 */
export type InferRouter<T> = T extends ActorProxyBuilder ? ActorRouter : never;

/**
 * Type-safe procedure helpers
 */
export const procedures = {
  /**
   * Create a query procedure
   */
  query: <TInput = unknown, TOutput = unknown>() => ({
    type: 'query' as const,
    def: { input: undefined as TInput, output: undefined as TOutput },
  }),

  /**
   * Create a mutation procedure
   */
  mutation: <TInput = unknown, TOutput = unknown>() => ({
    type: 'mutation' as const,
    def: { input: undefined as TInput, output: undefined as TOutput },
  }),

  /**
   * Create a subscription procedure
   */
  subscription: <TInput = unknown, TOutput = unknown>() => ({
    type: 'subscription' as const,
    def: { input: undefined as TInput, output: undefined as TOutput },
  }),
};

// ========================================================================================
// EXAMPLES AND USAGE
// ========================================================================================

/**
 * Example user service router
 */
export const userServiceRouter = {
  getUser: procedures.query<{ id: string }, { id: string; name: string; email: string }>(),
  createUser: procedures.mutation<{ name: string; email: string }, { id: string }>(),
  userUpdates: procedures.subscription<{ userId: string }, { event: string; data: unknown }>(),

  // Nested router example
  profile: {
    getProfile: procedures.query<{ userId: string }, { bio: string; avatar: string }>(),
    updateProfile: procedures.mutation<{ userId: string; bio: string }, { success: boolean }>(),
  },
} as const;

/**
 * Example AI agent router
 */
export const aiAgentRouter = {
  think: procedures.query<{ prompt: string }, { response: string; confidence: number }>(),
  act: procedures.mutation<
    { action: string; params: unknown },
    { result: unknown; success: boolean }
  >(),
  observe: procedures.subscription<{ sensorId: string }, { data: unknown; timestamp: number }>(),

  // Nested capabilities
  memory: {
    store: procedures.mutation<{ key: string; value: unknown }, { stored: boolean }>(),
    retrieve: procedures.query<{ key: string }, { value: unknown | null }>(),
    search: procedures.query<
      { query: string },
      { results: Array<{ key: string; value: unknown; score: number }> }
    >(),
  },

  learning: {
    train: procedures.mutation<
      { data: unknown[]; labels: unknown[] },
      { modelId: string; accuracy: number }
    >(),
    predict: procedures.query<
      { input: unknown; modelId: string },
      { prediction: unknown; confidence: number }
    >(),
  },
} as const;

// Type inference examples
export type UserServiceClient = CreateProxyClient<typeof userServiceRouter>;
export type AIAgentClient = CreateProxyClient<typeof aiAgentRouter>;
