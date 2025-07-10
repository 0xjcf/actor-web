/**
 * @module framework/core/component-bridge
 * @description Integration bridge between unified ActorRef system and UI components
 * @author Agent A (Tech Lead) - 2025-07-10
 */

import type { ActorRefOptions, ActorRef, BaseEventObject } from './actors/actor-ref.js';
import type { ActorSnapshot } from './actors/types.js';
import type { Observable } from './observables/observable.js';
import { createActorRef } from './create-actor-ref.js';
import type { AnyStateMachine } from 'xstate';

// ========================================================================================
// COMPONENT INTEGRATION TYPES
// ========================================================================================

/**
 * Component configuration for actor integration
 */
export interface ComponentActorConfig {
  /** State machine for the component's actor */
  machine: AnyStateMachine;

  /** Optional actor configuration */
  actorOptions?: ActorRefOptions;

  /** Component-specific settings */
  component?: {
    /** Auto-bind events to DOM elements */
    autoBindEvents?: boolean;

    /** Prefix for auto-generated event handlers */
    eventPrefix?: string;

    /** Component lifecycle hooks */
    hooks?: ComponentHooks;
  };
}

/**
 * Component lifecycle hooks for actor integration
 */
export interface ComponentHooks {
  /** Called after actor is created but before start */
  onActorCreated?: (actor: ActorRef) => void;

  /** Called after actor starts */
  onActorStarted?: (actor: ActorRef) => void;

  /** Called when actor state changes */
  onStateChange?: (snapshot: ActorSnapshot) => void;

  /** Called when actor encounters an error */
  onError?: (error: Error) => void;

  /** Called before actor stops */
  onBeforeStop?: (actor: ActorRef) => void;

  /** Called after actor stops */
  onAfterStop?: () => void;
}

/**
 * Component state selector function
 */
export type ComponentStateSelector<TState> = (snapshot: ActorSnapshot) => TState;

/**
 * Component event handler function
 */
export type ComponentEventHandler<TEvent extends BaseEventObject = BaseEventObject> = (
  event: Event,
  actorRef: ActorRef<TEvent>
) => TEvent | void;

// ========================================================================================
// COMPONENT ACTOR BRIDGE
// ========================================================================================

/**
 * Bridge class that connects a component with an ActorRef
 * Provides lifecycle management and state synchronization
 */
export class ComponentActorBridge<TEvent extends BaseEventObject = BaseEventObject> {
  private actorRef: ActorRef<TEvent>;
  private config: ComponentActorConfig;
  private subscriptions = new Set<{ unsubscribe(): void }>();
  private isConnected = false;

  constructor(config: ComponentActorConfig) {
    this.config = config;

    // Create the actor with configuration
    this.actorRef = createActorRef<TEvent>(config.machine, {
      autoStart: false, // Component controls when to start
      ...config.actorOptions,
    });

    // Call creation hook
    this.config.component?.hooks?.onActorCreated?.(this.actorRef);
  }

  // ========================================================================================
  // COMPONENT LIFECYCLE
  // ========================================================================================

  /**
   * Connect the component to its actor (typically called in connectedCallback)
   */
  connect(): void {
    if (this.isConnected) return;

    // Start the actor
    this.actorRef.start();
    this.isConnected = true;

    // Set up state observation
    this.setupStateObservation();

    // Auto-bind events if configured
    if (this.config.component?.autoBindEvents) {
      this.setupEventBinding();
    }

    // Call lifecycle hook
    this.config.component?.hooks?.onActorStarted?.(this.actorRef);
  }

  /**
   * Disconnect the component from its actor (typically called in disconnectedCallback)
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    // Call before stop hook
    this.config.component?.hooks?.onBeforeStop?.(this.actorRef);

    // Clean up all subscriptions
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();

    // Stop the actor
    await this.actorRef.stop();
    this.isConnected = false;

    // Call after stop hook
    this.config.component?.hooks?.onAfterStop?.();
  }

  // ========================================================================================
  // STATE MANAGEMENT
  // ========================================================================================

  /**
   * Observe specific state changes from the actor
   * @param selector - Function to select state slice
   * @returns Observable of selected state changes
   */
  observeState<TState>(selector: ComponentStateSelector<TState>): Observable<TState> {
    return this.actorRef.observe(selector);
  }

  /**
   * Get the current state snapshot
   * @returns Current actor state snapshot
   */
  getState(): ActorSnapshot {
    return this.actorRef.getSnapshot();
  }

  /**
   * Send an event to the actor
   * @param event - Event to send
   */
  send(event: TEvent): void {
    this.actorRef.send(event);
  }

  /**
   * Query the actor and wait for a response
   * @param query - Query to send
   * @returns Promise resolving to response
   */
  async ask<TQuery, TResponse>(query: TQuery): Promise<TResponse> {
    return this.actorRef.ask<TQuery, TResponse>(query);
  }

  // ========================================================================================
  // DIRECT ACTOR ACCESS
  // ========================================================================================

  /**
   * Get direct access to the underlying ActorRef
   * @returns The managed ActorRef instance
   */
  getActor(): ActorRef<TEvent> {
    return this.actorRef;
  }

  // ========================================================================================
  // PRIVATE IMPLEMENTATION
  // ========================================================================================

  private setupStateObservation(): void {
    // Subscribe to all state changes
    const stateSubscription = this.actorRef
      .observe((snapshot) => snapshot)
      .subscribe({
        next: (snapshot) => {
          this.config.component?.hooks?.onStateChange?.(snapshot);
        },
        error: (error) => {
          this.config.component?.hooks?.onError?.(error);
        },
      });

    this.subscriptions.add(stateSubscription);
  }

  private setupEventBinding(): void {
    // Basic event binding implementation
    // Agent B can extend this with their specific event delegation system
    console.log('Auto event binding - Agent B to implement specific delegation logic');
  }
}

// ========================================================================================
// FACTORY FUNCTIONS FOR COMPONENTS
// ========================================================================================

/**
 * Create a component actor bridge with simplified configuration
 * @param machine - State machine for the component
 * @param options - Optional configuration
 * @returns ComponentActorBridge instance
 */
export function createComponentActor<TEvent extends BaseEventObject = BaseEventObject>(
  machine: AnyStateMachine,
  options?: Partial<ComponentActorConfig>
): ComponentActorBridge<TEvent> {
  return new ComponentActorBridge<TEvent>({
    machine,
    actorOptions: options?.actorOptions,
    component: options?.component,
  });
}

/**
 * Create a component actor with built-in supervision for UI resilience
 * @param machine - State machine for the component
 * @param options - Optional configuration
 * @returns ComponentActorBridge with UI-optimized supervision
 */
export function createUIComponentActor<TEvent extends BaseEventObject = BaseEventObject>(
  machine: AnyStateMachine,
  options?: Partial<ComponentActorConfig>
): ComponentActorBridge<TEvent> {
  return new ComponentActorBridge<TEvent>({
    machine,
    actorOptions: {
      supervision: 'restart-on-failure', // UI components should recover from errors
      askTimeout: 5000, // Shorter timeout for UI responsiveness
      ...options?.actorOptions,
    },
    component: {
      autoBindEvents: true, // UI components typically need event binding
      eventPrefix: 'on', // Standard event prefix
      ...options?.component,
    },
  });
}

/**
 * Create a component actor optimized for forms and user input
 * @param machine - State machine for the form component
 * @param options - Optional configuration
 * @returns ComponentActorBridge optimized for form handling
 */
export function createFormComponentActor<TEvent extends BaseEventObject = BaseEventObject>(
  machine: AnyStateMachine,
  options?: Partial<ComponentActorConfig>
): ComponentActorBridge<TEvent> {
  return new ComponentActorBridge<TEvent>({
    machine,
    actorOptions: {
      supervision: 'restart-on-failure',
      askTimeout: 10000, // Forms may need more time for validation
      ...options?.actorOptions,
    },
    component: {
      autoBindEvents: true,
      eventPrefix: 'form',
      ...options?.component,
      hooks: {
        onError: (error) => {
          // Form-specific error handling
          console.warn('Form validation error:', error);
          options?.component?.hooks?.onError?.(error);
        },
        ...options?.component?.hooks,
      },
    },
  });
}

// ========================================================================================
// UTILITY FUNCTIONS FOR AGENT B
// ========================================================================================

/**
 * Create a standard event handler that maps DOM events to actor events
 * @param eventType - The actor event type to send
 * @param dataExtractor - Function to extract data from DOM event
 * @returns Event handler function
 */
export function createEventHandler<TEvent extends BaseEventObject>(
  eventType: TEvent['type'],
  dataExtractor?: (event: Event) => Partial<TEvent>
): ComponentEventHandler<TEvent> {
  return (event: Event, actorRef: ActorRef<TEvent>) => {
    const actorEvent = {
      type: eventType,
      timestamp: Date.now(),
      ...dataExtractor?.(event),
    } as TEvent;

    actorRef.send(actorEvent);
    return actorEvent;
  };
}

/**
 * Create a debounced event handler for input events
 * @param eventType - The actor event type to send
 * @param delay - Debounce delay in milliseconds
 * @param dataExtractor - Function to extract data from DOM event
 * @returns Debounced event handler function
 */
export function createDebouncedEventHandler<TEvent extends BaseEventObject>(
  eventType: TEvent['type'],
  delay = 300,
  dataExtractor?: (event: Event) => Partial<TEvent>
): ComponentEventHandler<TEvent> {
  let timeoutId: NodeJS.Timeout;

  return (event: Event, actorRef: ActorRef<TEvent>) => {
    clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      const actorEvent = {
        type: eventType,
        timestamp: Date.now(),
        ...dataExtractor?.(event),
      } as TEvent;

      actorRef.send(actorEvent);
    }, delay);
  };
}

// ========================================================================================
// TYPE EXPORTS FOR AGENT B
// ========================================================================================

// Re-export core types that Agent B will need
export type {
  ActorRef,
  BaseEventObject,
  ActorRefOptions,
} from './actors/actor-ref.js';

export type { ActorSnapshot } from './actors/types.js';

export type { Observable } from './observables/observable.js';
