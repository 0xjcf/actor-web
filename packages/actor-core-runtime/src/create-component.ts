/**
 * @module actor-core/runtime/create-component
 * @description New createComponent API - Web Components as Pure Actors
 *
 * This module provides the new v2.0 createComponent API that creates components
 * backed by actors in the pure actor model. Each component becomes a supervised
 * actor that can run anywhere (local, worker, remote).
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorInstance } from './actor-instance.js';
import type { ActorRef } from './actor-ref.js';
import type {
  ActorBehavior,
  ActorDependencies,
  ActorMessage,
  ActorSystem,
  JsonValue,
} from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import {
  type ComponentActorConfig,
  type ComponentDependencies,
  createComponentActorBehavior,
  type TemplateFunction,
} from './component-actor.js';
import { Logger } from './logger.js';

const log = Logger.namespace('CREATE_COMPONENT');

/**
 * Safely serialize component data to JsonValue
 */
function safeJsonSerialize(data: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return {};
  }
}

// ============================================================================
// CREATE COMPONENT API TYPES
// ============================================================================

/**
 * Component configuration for the unified createComponent API
 *
 * Uses defineActor() + clean component properties for consistent developer experience
 */
export interface CreateComponentConfig {
  // ============================================================================
  // CORE COMPONENT DEFINITION (Required)
  // ============================================================================

  /**
   * XState machine that defines the component's UI state transitions
   */
  machine: AnyStateMachine;

  /**
   * Template function that renders the component's UI based on current state
   */
  template: TemplateFunction;

  // ============================================================================
  // UNIFIED API - Use defineActor for actor logic
  // ============================================================================

  /**
   * Actor behavior created with defineActor() for cross-actor communication
   *
   * @example
   * ```typescript
   * // 1. Create reusable behavior with standard actor API
   * const formBehavior = defineActor({
   *   onMessage: ({ message, machine }) => {
   *     const context = machine.getSnapshot().context;
   *     switch (message.type) {
   *       case 'FORM_SAVE_REQUESTED':
   *         return {
   *           context: { ...context, lastSaveTime: Date.now() },
   *           emit: { type: 'SAVE_ACKNOWLEDGED', timestamp: Date.now() }
   *         };
   *       default:
   *         return { context };
   *     }
   *   }
   * });
   *
   * // 2. Use with clean component configuration
   * const FormComponent = createComponent({
   *   machine: formMachine,
   *   template: formTemplate,
   *   behavior: formBehavior,  // ✅ Unified API!
   *   dependencies: { backend: 'actor://system/backend' }
   * });
   * ```
   */
  behavior?: ActorBehavior;

  // ============================================================================
  // COMPONENT ACTOR PROPERTIES (Clean & Flat)
  // ============================================================================

  /**
   * Actor dependencies for cross-actor communication
   * Maps dependency names to actor addresses (e.g., { backend: 'actor://system/backend' })
   */
  dependencies?: ComponentDependencies;

  /**
   * Mailbox configuration for message queue management
   */
  mailbox?: {
    capacity: number;
    strategy: 'drop-oldest' | 'drop-newest' | 'suspend';
  };

  /**
   * Supervision strategy for component fault tolerance
   */
  supervision?: {
    strategy: 'restart' | 'stop' | 'escalate' | 'resume';
    maxRestarts?: number;
    withinMs?: number;
  };

  /**
   * Transport layer selection for location transparency
   */
  transport?: 'local' | 'worker' | 'websocket';

  // ============================================================================
  // WEB COMPONENT OPTIONS
  // ============================================================================

  /**
   * Custom HTML tag name (defaults to machine.id + '-component')
   */
  tagName?: string;

  /**
   * CSS styles for shadow DOM
   */
  styles?: string;
}

/**
 * Component Actor Element - Web Component backed by Actor
 */
export interface ComponentActorElement extends HTMLElement {
  // Actor integration
  readonly actorPID: ActorRef;
  readonly isActorMounted: boolean;

  // Component lifecycle
  send(message: Record<string, unknown> & { type: string }): Promise<void>;
  getActorSnapshot(): Promise<unknown>;

  // Dependency management
  updateDependencies(dependencies: Record<string, ActorRef>): Promise<void>;
}

/**
 * Component Class returned by createComponent
 */
export interface ComponentClass {
  readonly tagName: string;
  readonly machineId: string;

  // Factory methods for programmatic creation
  create(): ComponentActorElement;
  createWithDependencies(dependencies: Record<string, ActorRef>): ComponentActorElement;
}

// ============================================================================
// ACTOR SYSTEM SINGLETON (TRANSITIONAL)
// ============================================================================

// Global actor system for components (will be replaced with dependency injection)
let globalActorSystem: ActorSystem | null = null;

/**
 * Initialize or get the global actor system for components
 */
async function getActorSystem(): Promise<ActorSystem> {
  if (!globalActorSystem) {
    globalActorSystem = createActorSystem({
      nodeAddress: 'component-node',
      maxActors: 1000,
    });
    await globalActorSystem.start();
    log.info('Component actor system started');
  }
  return globalActorSystem;
}

// ============================================================================
// CREATE COMPONENT IMPLEMENTATION
// ============================================================================

/**
 * Create a Web Component backed by a Pure Actor - Unified API
 *
 * This API provides a consistent developer experience by using defineActor()
 * for actor logic and clean component-specific properties at the top level.
 *
 * @example
 * ```typescript
 * // 🧠 1. XState ― UI state only
 * const formMachine = createMachine({
 *   id: 'form',
 *   initial: 'editing',
 *   context: { formData: {}, error: null },
 *   states: {
 *     editing: { on: { UPDATE_FIELD: 'editing', SUBMIT: 'saving' } },
 *     saving: { on: { SAVE_SUCCESS: 'saved', SAVE_ERROR: { target: 'editing', actions: 'setError' } } },
 *     saved: { after: { 2000: 'editing' } }
 *   }
 * });
 *
 * // 🎨 2. Template ― purely declarative markup
 * const formTemplate = ({ context }) => html`
  *   <form>
    *     <input name="name" .value=${context.formData.name ?? ''} />
  *     <button type="submit">Save</button>
  *     ${context.error && html`
      <p class="error">${context.error}</p>
`}
  *</form>
`;
 *
 * // 🔌 3. Behavior ― standard actor behavior
 * const formBehavior = defineActor({
 *   onMessage: ({ message, machine }) => {
 *     const context = machine.getSnapshot().context;
 *     switch (message.type) {
 *       case 'FORM_SAVE_REQUESTED':
 *         return {
 *           context: { ...context, lastSaveTime: Date.now() },
 *           emit: { type: 'SAVE_ACKNOWLEDGED', timestamp: Date.now() }
 *         };
 *       case 'CLEAR_CACHE':
 *         return { context: { ...context, lastSaveTime: null } };
 *       default:
 *         return { context };
 *     }
 *   }
 * });
 *
 * // 🌟 4. Component Creation ― unified API
 * const FormComponent = createComponent({
 *   // Core component definition
 *   machine: formMachine,
 *   template: formTemplate,
 *   behavior: formBehavior,  // ✅ Standard ActorBehavior!
 *   
 *   // Component-specific configuration (clean & flat)
 *   dependencies: {
 *     backend: 'actor://system/backend',
 *     storage: 'actor://system/storage'
 *   },
 *   mailbox: { capacity: 100, strategy: 'drop-oldest' },
 *   supervision: { strategy: 'restart', maxRestarts: 3 }
 * });
 *
 * // 📱 5. Usage ― same as before
 * document.body.appendChild(FormComponent.create());
 * ```
 *
 * @param config - Component configuration with unified API
 * @returns Component class with create() method
 */
export function createComponent(config: CreateComponentConfig): ComponentClass {
  const machineId = config.machine.id || 'anonymous-component';
  const tagName = config.tagName || `${machineId}-component`;

  log.info('Creating component class', { machineId, tagName });

  // Create the component actor behavior
  const componentActorConfig: ComponentActorConfig = {
    machine: config.machine,
    template: config.template,
    dependencies: config.dependencies,
    onMessage: config.behavior?.onMessage
      ? // Integrate pure actor behavior with component message handling
        async ({ message, context, machine }) => {
          // Convert ComponentActorMessage to flat ActorMessage format for pure actor behavior
          // Build message that satisfies { type: string; [key: string]: unknown }
          const actorMessage = (() => {
            const baseMessage = { type: message.type };

            if (message && typeof message === 'object') {
              const serialized = safeJsonSerialize(message);
              // Only spread if the result is an object (not array or primitive)
              if (serialized && typeof serialized === 'object' && !Array.isArray(serialized)) {
                return { ...baseMessage, ...serialized };
              }
              if (serialized !== null && serialized !== undefined) {
                // If it's not an object, store it under a data field
                return { ...baseMessage, data: serialized };
              }
            }

            return baseMessage;
          })();

          // Create an ActorInstance adapter for the XState machine
          const actorInstanceAdapter: ActorInstance = {
            id: machine.id || 'component-actor',
            send: (message) => machine.send(message),
            getSnapshot: () => {
              const snapshot = machine.getSnapshot();
              // Convert XState snapshot to our ActorSnapshot format
              return {
                context: snapshot.context,
                value: snapshot.value,
                status: 'running' as const,
                matches: () => false,
                can: () => false,
                hasTag: () => false,
                toJSON: () => ({ context: snapshot.context, value: snapshot.value }),
              };
            },
            start: () => {}, // XState actors are already started
            stop: async () => machine.stop(),
            ask: async <T>(_message: ActorMessage, _timeout?: number): Promise<T> => {
              throw new Error(`Ask pattern not yet implemented for component actor ${machine.id}`);
            },
            getType: () => 'machine' as const,
            status: 'running' as const, // Components are running when processing messages
          };

          // Create simplified ActorDependencies for the pure actor behavior
          const actorDependencies: ActorDependencies = {
            actorId: machine.id || 'component-actor',
            actor: actorInstanceAdapter,
            self: {} as ActorRef<unknown>, // Component manages its own reference
            emit: () => {}, // Components manage their own emission
            send: async () => {}, // Components handle sends through their own system
            ask: async <T>(): Promise<T> => ({}) as T, // Components handle asks through their own system
            logger: Logger.namespace('COMPONENT'),
          };

          // Call the pure actor behavior's onMessage (fire and forget)
          // The behavior will handle its own MessagePlan processing
          if (config.behavior?.onMessage) {
            try {
              await config.behavior.onMessage({
                message: actorMessage,
                actor: actorInstanceAdapter,
                dependencies: actorDependencies,
              });
            } catch (error) {
              // Log any errors from the pure actor behavior but don't break component flow
              Logger.namespace('COMPONENT').error('Pure actor behavior error', { error });
            }
          }

          // Components with pure actor behaviors manage their own emission
          // Return standard component result format
          return {
            context, // Component context remains unchanged (managed by XState machine)
            emit: undefined, // Components with pure actor behaviors manage their own emission
          };
        }
      : undefined,
    mailbox: config.mailbox,
    supervision: config.supervision,
    transport: config.transport || 'local',
  };

  const componentBehavior = createComponentActorBehavior(componentActorConfig);

  // Define the Web Component class
  class ComponentActorElementImpl extends HTMLElement implements ComponentActorElement {
    private _actorPID: ActorRef | null = null;
    private _isActorMounted = false;
    private _shadowRoot: ShadowRoot;

    constructor() {
      super();

      // Create shadow root for style encapsulation
      this._shadowRoot = this.attachShadow({ mode: 'open' });

      // Apply component styles if provided
      if (config.styles) {
        const styleElement = document.createElement('style');
        styleElement.textContent = config.styles;
        this._shadowRoot.appendChild(styleElement);
      }

      log.debug('Component element created', { machineId, tagName });
    }

    // Getters for actor integration
    get actorPID(): ActorRef {
      if (!this._actorPID) {
        throw new Error('Component actor not yet spawned. Call connectedCallback first.');
      }
      return this._actorPID;
    }

    get isActorMounted(): boolean {
      return this._isActorMounted;
    }

    // Web Component lifecycle
    async connectedCallback(): Promise<void> {
      try {
        log.info('Component connecting to DOM', { machineId });

        // Get actor system
        const actorSystem = await getActorSystem();

        // Spawn component actor
        this._actorPID = await actorSystem.spawn(componentBehavior, {
          id: `${machineId}-${generateComponentId()}`,
          supervised: true,
        });

        log.info('Component actor spawned', {
          machineId,
          actorId: this._actorPID.address.id,
        });

        // Mount the component actor with DOM element
        // Note: We don't pass the DOM element in the message since it's not JSON-serializable
        // Instead, the actor will access the element directly when needed
        await this._actorPID.send({
          type: 'MOUNT_COMPONENT',
          elementId: this.id || generateComponentId(),
          hasTemplate: true,
          hasDependencies: !!config.dependencies,
        });

        // Resolve dependencies if configured
        if (config.dependencies) {
          await this.resolveDependencies(config.dependencies);
        }

        this._isActorMounted = true;

        log.info('Component mounted successfully', { machineId });
      } catch (error) {
        log.error('Failed to connect component', {
          error: error instanceof Error ? error.message : 'Unknown error',
          machineId,
        });
        throw error;
      }
    }

    async disconnectedCallback(): Promise<void> {
      try {
        log.info('Component disconnecting from DOM', { machineId });

        if (this._actorPID) {
          // Unmount the component actor
          await this._actorPID.send({
            type: 'UNMOUNT_COMPONENT',
          });

          // Stop the actor
          await this._actorPID.stop();

          this._actorPID = null;
        }

        this._isActorMounted = false;

        log.info('Component unmounted successfully', { machineId });
      } catch (error) {
        log.error('Failed to disconnect component', {
          error: error instanceof Error ? error.message : 'Unknown error',
          machineId,
        });
      }
    }

    // Public API methods
    async send(message: Record<string, unknown> & { type: string }): Promise<void> {
      if (!this._actorPID) {
        throw new Error('Component actor not available. Component may not be connected.');
      }

      await this._actorPID.send(message);
    }

    async getActorSnapshot(): Promise<unknown> {
      if (!this._actorPID) {
        throw new Error('Component actor not available. Component may not be connected.');
      }

      // Request current state from actor
      return await this._actorPID.ask({
        type: 'GET_STATE',
      });
    }

    async updateDependencies(dependencies: Record<string, ActorRef>): Promise<void> {
      if (!this._actorPID) {
        throw new Error('Component actor not available. Component may not be connected.');
      }

      // Convert ActorRef objects to serializable references
      const dependencyRefs: Record<string, string> = {};
      for (const [key, actor] of Object.entries(dependencies)) {
        dependencyRefs[key] = actor.address.path;
      }

      await this._actorPID.send({
        type: 'UPDATE_DEPENDENCIES',
        dependencyRefs,
      });
    }

    // Private helper methods
    private async resolveDependencies(dependencies: ComponentDependencies): Promise<void> {
      if (!this._actorPID) return;

      const actorSystem = await getActorSystem();
      const resolvedDependencies: Record<string, ActorRef> = {};

      // Resolve each dependency path to an ActorRef
      for (const [key, actorPath] of Object.entries(dependencies)) {
        if (typeof actorPath !== 'string') continue;

        try {
          const dependencyActor = await actorSystem.lookup(actorPath);
          if (dependencyActor) {
            resolvedDependencies[key] = dependencyActor;
            log.debug('Dependency resolved', { key, actorPath });
          } else {
            log.warn('Dependency not found', { key, actorPath });
          }
        } catch (error) {
          log.error('Failed to resolve dependency', {
            key,
            actorPath,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Update component actor with resolved dependencies
      if (Object.keys(resolvedDependencies).length > 0) {
        await this.updateDependencies(resolvedDependencies);
      }
    }

    // Type guard for JsonValue
    private isJsonValue(value: unknown): value is JsonValue {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        return true;
      }
      if (Array.isArray(value)) {
        return value.every((v) => this.isJsonValue(v));
      }
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).every((v) => this.isJsonValue(v));
      }
      return false;
    }
  }

  // Register as custom element
  if (!customElements.get(tagName)) {
    customElements.define(tagName, ComponentActorElementImpl);
    log.info('Component registered as custom element', { tagName, machineId });
  }

  // Create and return the component class
  const componentClass: ComponentClass = {
    // Metadata
    tagName,
    machineId,

    // Factory methods
    create(): ComponentActorElement {
      return document.createElement(tagName) as ComponentActorElement;
    },

    createWithDependencies(dependencies: Record<string, ActorRef>): ComponentActorElement {
      const element = document.createElement(tagName) as ComponentActorElement;

      // Set up dependency injection when component connects
      element.addEventListener(
        'connected',
        async () => {
          await element.updateDependencies(dependencies);
        },
        { once: true }
      );

      return element;
    },
  };

  log.info('Component class created successfully', { tagName, machineId });

  return componentClass;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate unique component ID
 */
let componentIdCounter = 0;
function generateComponentId(): string {
  return `component-${componentIdCounter++}`;
}
