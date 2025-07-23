/**
 * @module actor-core/runtime/create-component
 * @description New createComponent API - Web Components as Pure Actors
 *
 * This module provides the new v2.0 createComponent API that creates components
 * backed by actors in the pure actor model. Each component becomes a supervised
 * actor that can run anywhere (local, worker, remote).
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorMessage, ActorPID, ActorSystem } from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import {
  type ActorDependencies,
  type ComponentActorConfig,
  type ComponentActorContext,
  createComponentActorBehavior,
  type TemplateFunction,
} from './component-actor.js';
import type { ActorBehavior } from './create-actor.js';
import { Logger } from './logger.js';

const log = Logger.namespace('CREATE_COMPONENT');

// ============================================================================
// CREATE COMPONENT API TYPES
// ============================================================================

/**
 * Component configuration for the unified createComponent API
 *
 * Uses defineBehavior() + clean component properties for consistent developer experience
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
  // UNIFIED API - Use defineBehavior for actor logic
  // ============================================================================

  /**
   * Actor behavior created with defineBehavior() for cross-actor communication
   *
   * @example
   * ```typescript
   * // 1. Create reusable behavior with standard actor API
   * const formBehavior = defineBehavior({
   *   context: { lastSaveTime: null },
   *   onMessage: ({ message, context }) => {
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
  dependencies?: ActorDependencies;

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
  readonly actorPID: ActorPID;
  readonly isActorMounted: boolean;

  // Component lifecycle
  send(message: Record<string, unknown> & { type: string }): Promise<void>;
  getActorSnapshot(): Promise<unknown>;

  // Dependency management
  updateDependencies(dependencies: Record<string, ActorPID>): Promise<void>;
}

/**
 * Component Class returned by createComponent
 */
export interface ComponentClass {
  readonly tagName: string;
  readonly machineId: string;

  // Factory methods for programmatic creation
  create(): ComponentActorElement;
  createWithDependencies(dependencies: Record<string, ActorPID>): ComponentActorElement;
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
 * This API provides a consistent developer experience by using defineBehavior()
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
 * const formBehavior = defineBehavior({
 *   context: { lastSaveTime: null },
 *   onMessage: ({ message, context }) => {
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
      ? // Adapt standard actor onMessage to component message handler signature
        async ({ message, context, machine, dependencies: _dependencies }) => {
          if (config.behavior?.onMessage) {
            const result = await config.behavior.onMessage({
              message: message as ActorMessage, // Type adaptation for component message
              context: context as unknown, // Context type adaptation
            });

            // Ensure we maintain the full ComponentActorContext structure
            const updatedContext: ComponentActorContext = {
              ...context, // Keep existing component context (includes original machine)
              xstateActor: machine, // The machine parameter is the Actor instance
              ...(result.context as Partial<ComponentActorContext>), // Merge in updates
            };

            return {
              context: updatedContext,
              emit: result.emit ? ([result.emit].flat() as never[]) : undefined,
            };
          }
          return { context };
        }
      : undefined,
    mailbox: config.mailbox,
    supervision: config.supervision,
    transport: config.transport || 'local',
  };

  const componentBehavior = createComponentActorBehavior(componentActorConfig);

  // Define the Web Component class
  class ComponentActorElementImpl extends HTMLElement implements ComponentActorElement {
    private _actorPID: ActorPID | null = null;
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
    get actorPID(): ActorPID {
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
          payload: {
            elementId: this.id || generateComponentId(),
            hasTemplate: true,
            hasDependencies: !!config.dependencies,
          },
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
            payload: null,
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
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });
    }

    async updateDependencies(dependencies: Record<string, ActorPID>): Promise<void> {
      if (!this._actorPID) {
        throw new Error('Component actor not available. Component may not be connected.');
      }

      // Convert ActorPID objects to serializable references
      const dependencyRefs: Record<string, string> = {};
      for (const [key, actor] of Object.entries(dependencies)) {
        dependencyRefs[key] = actor.address.path;
      }

      await this._actorPID.send({
        type: 'UPDATE_DEPENDENCIES',
        payload: { dependencyRefs },
      });
    }

    // Private helper methods
    private async resolveDependencies(dependencies: ActorDependencies): Promise<void> {
      if (!this._actorPID) return;

      const actorSystem = await getActorSystem();
      const resolvedDependencies: Record<string, ActorPID> = {};

      // Resolve each dependency path to an ActorPID
      for (const [key, actorPath] of Object.entries(dependencies)) {
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

    createWithDependencies(dependencies: Record<string, ActorPID>): ComponentActorElement {
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
