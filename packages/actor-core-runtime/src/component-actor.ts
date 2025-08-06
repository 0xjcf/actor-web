/**
 * @module actor-core/runtime/component-actor
 * @description Component Actor - Web Components as Pure Actors
 *
 * This module implements the component-as-actor pattern where each web component
 * is backed by a pure actor that handles:
 * - XState machine integration for UI logic
 * - DOM event to message conversion
 * - State changes to render messages
 * - Cross-actor communication via dependencies
 */

import type { Actor, AnyStateMachine } from 'xstate';
import { createActor } from 'xstate';
import type { ActorInstance } from './actor-instance.js';
import type { ActorRef } from './actor-ref.js';
import { ComponentSymbols } from './actor-symbols.js';
import type { ActorBehavior, ActorMessage, JsonValue } from './actor-system.js';
import { SupervisionDirective } from './actor-system.js';
import { Logger } from './logger.js';
import type { FanOutResult } from './runtime-fanout.js';
// Import fan-out detection and types
import { detectFanOutEvents } from './runtime-fanout.js';
import type { Message } from './types.js';

/**
 * Adapter to convert XState Actor to ActorInstance interface
 */
function xstateToActorInstance(xstateActor: Actor<AnyStateMachine>): ActorInstance {
  return {
    id: xstateActor.id || 'xstate-actor',
    send: (message) => xstateActor.send(message),
    getSnapshot: () => {
      const snapshot = xstateActor.getSnapshot();
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
    stop: () => {
      xstateActor.stop();
      return Promise.resolve();
    },
    ask: async <T>(_message: ActorMessage, _timeout?: number): Promise<T> => {
      throw new Error(
        `Ask pattern not yet implemented for component XState actor ${xstateActor.id}`
      );
    },
    getType: () => 'machine' as const,
    status: 'running' as const,
  };
}

const log = Logger.namespace('COMPONENT_ACTOR');

// ============================================================================
// COMPONENT ACTOR TYPES
// ============================================================================

/**
 * Component Actor Messages - All messages a component actor can receive (Flat format)
 */
export type ComponentActorMessage =
  | DOMEventMessage
  | RenderMessage
  | XStateTransitionMessage
  | StateChangedMessage
  | MountComponentMessage
  | UnmountComponentMessage
  | UpdateDependenciesMessage;

// ============================================================================
// FLAT MESSAGE INTERFACES (New format)
// ============================================================================

export interface MountComponentMessage extends ActorMessage {
  type: 'MOUNT_COMPONENT';
  elementId: string;
  hasTemplate: boolean;
  dependencies?: Record<string, ActorRef>;
}

export interface DOMEventMessage extends ActorMessage {
  type: 'DOM_EVENT';
  eventType: string;
  domEventType: DOMEventType;
  attributes?: Record<string, string>;
  formData?: Record<string, string>;
  target?: {
    tagName: HTMLTagName;
    id: string;
    className: string;
  };
}

export interface XStateTransitionMessage extends ActorMessage {
  type: 'XSTATE_TRANSITION';
  from: string;
  to: string;
  event: JsonValue;
  context: JsonValue;
}

export interface StateChangedMessage extends ActorMessage {
  type: 'STATE_CHANGED';
  value: unknown;
  context: JsonValue;
  tags: string[];
  status: XStateStatus;
  output?: JsonValue;
}

export interface UpdateDependenciesMessage extends ActorMessage {
  type: 'UPDATE_DEPENDENCIES';
  dependencies: Record<string, ActorRef>;
}

export interface RenderMessage extends ActorMessage {
  type: 'RENDER';
}

export interface UnmountComponentMessage extends ActorMessage {
  type: 'UNMOUNT_COMPONENT';
}

/**
 * Template function type
 */
export type TemplateFunction = (state: unknown) => string;

/**
 * Component dependencies configuration with type-safe actor URLs
 */
export interface ComponentDependencies {
  [key: string]: `actor://${string}` | `/${string}`; // Type-safe actor URLs
}

/**
 * Common DOM event types for better type safety
 */
export type DOMEventType =
  | 'click'
  | 'dblclick'
  | 'input'
  | 'change'
  | 'blur'
  | 'focus'
  | 'submit'
  | 'reset'
  | 'keydown'
  | 'keyup'
  | 'keypress'
  | 'mousedown'
  | 'mouseup'
  | 'mouseover'
  | 'mouseout'
  | string; // Allow custom events

/**
 * Common HTML tag names for better type safety
 */
export type HTMLTagName =
  | 'BUTTON'
  | 'INPUT'
  | 'FORM'
  | 'DIV'
  | 'SPAN'
  | 'A'
  | 'IMG'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'P'
  | 'UL'
  | 'OL'
  | 'LI'
  | 'TABLE'
  | 'TR'
  | 'TD'
  | 'TH'
  | string; // Allow custom elements

/**
 * XState status values for better type safety
 */
export type XStateStatus = 'active' | 'done' | 'error' | 'stopped';

/**
 * Component Actor Context - Internal state
 */
export interface ComponentActorContext {
  // XState integration
  readonly machine: AnyStateMachine;
  readonly xstateActor: Actor<AnyStateMachine> | null;
  readonly xstateBridge: XStateBridge | null;
  readonly currentState: unknown;

  // DOM integration
  readonly element: HTMLElement | null;
  readonly template: TemplateFunction | null;
  readonly isMounted: boolean;

  // Actor system integration
  readonly dependencies: Record<string, ActorRef>;
  readonly messageCount: number;
  readonly renderCount: number;
  readonly lastRender: number;

  // Component lifecycle
  readonly mountTime: number;
  readonly isDestroyed: boolean;
}

/**
 * Component Actor Configuration
 */
export interface ComponentActorConfig {
  machine: AnyStateMachine;
  template: TemplateFunction;
  dependencies?: ComponentDependencies;
  onMessage?: ComponentMessageHandler;
  mailbox?: {
    capacity: number;
    strategy: 'drop-oldest' | 'drop-newest' | 'suspend';
  };
  supervision?: {
    strategy: 'restart' | 'stop' | 'escalate' | 'resume';
    maxRestarts?: number;
    withinMs?: number;
  };
  transport?: 'local' | 'worker' | 'websocket';
}

/**
 * Component message handler enforcing fan-out as the standard approach
 * No emit callback - components must return domain events for automatic fan-out
 */
export type ComponentMessageHandler = (params: {
  message: ComponentActorMessage;
  context: ComponentActorContext;
  machine: ActorInstance;
  dependencies: Record<string, ActorRef>;
}) => Promise<FanOutResult<ComponentActorContext, never, unknown>>;

// ============================================================================
// XSTATE BRIDGE IMPLEMENTATION
// ============================================================================

/**
 * XState Bridge - Handles state change integration with the actor system
 * This class manages the connection between XState actors and the component actor
 */
class XStateBridge {
  private stateChangePending = false;
  private latestStateMessage: Message | null = null;

  constructor(private xstateActor: Actor<AnyStateMachine>) {
    this.setupStateChangeListener();
  }

  private setupStateChangeListener(): void {
    // Subscribe to XState state changes and convert to actor messages
    this.xstateActor.subscribe((state) => {
      const stateMessage = {
        type: 'STATE_CHANGED',
        value: state.value,
        context: state.context,
        tags: Array.from(state.tags || []),
        status: state.status,
        output: state.output,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Store the latest state change - the actor system will handle message processing
      this.latestStateMessage = stateMessage;
      this.stateChangePending = true;

      log.debug('XState state change captured by bridge', {
        value: state.value,
        stateChangePending: this.stateChangePending,
      });
    });
  }

  /**
   * Trigger the bridge to emit any pending state changes
   * This is called by the component actor when it needs to process state changes
   */
  triggerPendingEmission(): Message[] {
    const messages: Message[] = [];
    if (this.stateChangePending && this.latestStateMessage) {
      messages.push(this.latestStateMessage);
      this.stateChangePending = false;

      log.debug('XState bridge emitting pending state change', {
        type: this.latestStateMessage.type,
        value: 'value' in this.latestStateMessage ? this.latestStateMessage.value : undefined,
      });
    }
    return messages;
  }

  /**
   * Get pending state change message if available
   * This allows the actor system to retrieve state changes when processing messages
   */
  getPendingStateChange(): Message | null {
    if (this.stateChangePending && this.latestStateMessage) {
      this.stateChangePending = false;
      return this.latestStateMessage;
    }
    return null;
  }

  /**
   * Check if there are pending state changes
   */
  hasPendingStateChange(): boolean {
    return this.stateChangePending;
  }
}

// ============================================================================
// COMPONENT ACTOR BEHAVIOR IMPLEMENTATION
// ============================================================================

/**
 * Creates a Component Actor behavior from configuration
 */
export function createComponentActorBehavior(
  config: ComponentActorConfig
): ActorBehavior<ComponentActorMessage, ComponentActorContext> {
  // Define initial JSON-serializable context
  const initialContext = {
    messageCount: 0,
    renderCount: 0,
    lastRender: 0,
    mountTime: 0,
    isDestroyed: false,
    isMounted: false,
  };

  const behavior: ActorBehavior<ComponentActorMessage, ComponentActorContext> = {
    context: initialContext,
    async onMessage({ message, actor }) {
      const jsonContext = actor.getSnapshot().context as {
        messageCount?: number;
        renderCount?: number;
        lastRender?: number;
        mountTime?: number;
        isDestroyed?: boolean;
        isMounted?: boolean;
      };

      // Reconstruct full ComponentActorContext from JSON context + config
      const context: ComponentActorContext = {
        machine: config.machine, // Always use the machine from config
        xstateActor: null, // Will be set during mounting
        xstateBridge: null, // Will be set during mounting
        currentState: null, // Will be set during mounting
        element: null, // Will be set during mounting
        template: config.template, // From config
        dependencies: {}, // Will be updated via messages
        messageCount: jsonContext.messageCount || 0,
        renderCount: jsonContext.renderCount || 0,
        lastRender: jsonContext.lastRender || 0,
        mountTime: jsonContext.mountTime || 0,
        isDestroyed: jsonContext.isDestroyed || false,
        isMounted: jsonContext.isMounted || false,
      };

      if (context.isDestroyed) {
        log.warn('Message received by destroyed component actor', { type: message.type });
        return { context };
      }

      // Update message count and create new context
      const newContext: ComponentActorContext = {
        ...context,
        messageCount: context.messageCount + 1,
      };

      log.debug('Component actor received message', {
        type: message.type,
        messageCount: newContext.messageCount,
      });

      switch (message.type) {
        case 'MOUNT_COMPONENT':
          return await handleMountComponent(message, newContext);

        case 'UNMOUNT_COMPONENT':
          return await handleUnmountComponent(newContext);

        case 'DOM_EVENT':
          return await handleDOMEvent(message, newContext, config.onMessage);

        case 'RENDER':
          return await handleRender(newContext);

        case 'XSTATE_TRANSITION':
          return await handleXStateTransition(message, newContext);

        case 'STATE_CHANGED':
          return await handleStateChanged(message, newContext);

        case 'UPDATE_DEPENDENCIES':
          return await handleUpdateDependencies(message, newContext);

        default:
          log.warn('Unknown message type received by component actor', {
            type: (message as { type: string }).type,
          });
          return { context: newContext };
      }
    },

    // Component actors can be restarted if they fail
    supervisionStrategy: {
      onFailure: () =>
        config.supervision?.strategy === 'restart'
          ? SupervisionDirective.RESTART
          : SupervisionDirective.ESCALATE,
      maxRetries: config.supervision?.maxRestarts || 3,
      retryDelay: config.supervision?.withinMs || 5000,
    },
  };

  return behavior;
}

// ============================================================================
// RUNTIME FAN-OUT INTEGRATION (STANDARD APPROACH)
// ============================================================================

/**
 * Process fan-out results from component message handlers
 * Simplified for fan-out-only approach
 */
async function processFanOutResult(
  fanOutResult: FanOutResult<ComponentActorContext, never, unknown>,
  originalContext: ComponentActorContext,
  xstateActor: Actor<AnyStateMachine>
): Promise<{ context: ComponentActorContext; emit: Message[] }> {
  // Detect fan-out events using our robust type system
  const {
    context: resultContext,
    emit: traditionalEmit,
    fanOutEvents,
  } = detectFanOutEvents(fanOutResult, originalContext);

  // Prepare emit messages array
  const emitMessages: Message[] = [];

  // Process fan-out events (the standard approach)
  for (const fanOutEvent of fanOutEvents) {
    log.debug('Processing fan-out event', {
      eventType: fanOutEvent.type,
      hasXStateActor: !!xstateActor,
    });

    // 🎯 Fan-out to XState machine (automatic machine.send())
    if (xstateActor) {
      try {
        xstateActor.send(fanOutEvent);
        log.debug('Fan-out event sent to XState machine', { eventType: fanOutEvent.type });
      } catch (error) {
        log.error('Failed to send fan-out event to XState machine', {
          eventType: fanOutEvent.type,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // 🎯 Fan-out to actor system (automatic emit())
    emitMessages.push(fanOutEvent);

    log.debug('Fan-out event added to emit queue', { eventType: fanOutEvent.type });
  }

  // Handle any traditional emit from enhanced results (rare edge case)
  if (traditionalEmit) {
    const emitArray = Array.isArray(traditionalEmit) ? traditionalEmit : [traditionalEmit];
    for (const event of emitArray) {
      if (typeof event === 'object' && event !== null && 'type' in event) {
        emitMessages.push(event);
      }
    }
  }

  // Log fan-out statistics for observability
  if (fanOutEvents.length > 0) {
    log.info('Runtime fan-out processed', {
      fanOutEventCount: fanOutEvents.length,
      totalEmits: emitMessages.length,
    });
  }

  return {
    context: resultContext as ComponentActorContext,
    emit: emitMessages,
  };
}

// ============================================================================
// MESSAGE HANDLERS - PURE FUNCTIONS
// ============================================================================

/**
 * Handle component mounting
 */
async function handleMountComponent(
  message: MountComponentMessage,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: Message[] }> {
  log.info('Mounting component actor');

  // Create and start XState actor
  const xstateActor = createActor(context.machine);

  // ✅ PROPER XState Bridge Implementation
  // Create a bridge that handles XState state changes and converts them to actor messages
  const xstateBridge = new XStateBridge(xstateActor);

  xstateActor.start();

  // Get initial state for first render and trigger bridge emission
  const initialState = xstateActor.getSnapshot();
  const _initialBridgeMessages = xstateBridge.triggerPendingEmission();

  // Resolve dependencies
  const resolvedDependencies: Record<string, ActorRef> = {};
  if (message.dependencies) {
    // TODO: Implement dependency resolution via ActorSystem lookup
    // For now, dependencies will be updated via UPDATE_DEPENDENCIES message
  }

  // Create new context with XState integration
  const newContext: ComponentActorContext = {
    ...context,
    xstateActor,
    xstateBridge, // Store bridge for state change handling
    currentState: initialState.value, // Set initial state immediately
    element: null, // Element will be set separately
    template: context.template, // Template from config
    dependencies: resolvedDependencies,
    isMounted: true,
    mountTime: Date.now(),
  };

  // Emit initial STATE_CHANGED for first render
  const initialStateMessage = {
    type: 'STATE_CHANGED',
    value: initialState.value,
    context: initialState.context,
    tags: Array.from(initialState.tags || []),
    status: initialState.status,
    output: initialState.output,
  };

  // Trigger any pending state changes from the bridge after startup
  const pendingBridgeMessages = xstateBridge.triggerPendingEmission();

  return {
    context: newContext,
    emit: [
      {
        type: 'COMPONENT_MOUNTED',
        elementId: message.elementId,
        machineId: context.machine.id,
        mountTime: newContext.mountTime,
      },
      initialStateMessage, // Emit initial state for render
      ...pendingBridgeMessages, // Include any bridge-generated state changes
    ],
  };
}

/**
 * Handle component unmounting
 */
async function handleUnmountComponent(
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: Message[] }> {
  log.info('Unmounting component actor');

  // Stop XState actor
  if (context.xstateActor) {
    context.xstateActor.stop();
  }

  // Clean up DOM event listeners
  if (context.element) {
    cleanupDOMEventListeners(context.element);
  }

  const newContext: ComponentActorContext = {
    ...context,
    xstateActor: null,
    element: null,
    isMounted: false,
    isDestroyed: true,
  };

  return {
    context: newContext,
    emit: [
      {
        type: 'COMPONENT_UNMOUNTED',
        machineId: context.machine.id,
        uptime: Date.now() - context.mountTime,
      },
    ],
  };
}

/**
 * Handle DOM events from user interactions
 */
async function handleDOMEvent(
  message: DOMEventMessage,
  context: ComponentActorContext,
  customHandler?: ComponentMessageHandler
): Promise<{ context: ComponentActorContext; emit?: Message[] }> {
  if (!context.xstateActor || !context.isMounted) {
    log.warn('DOM event received but component not mounted');
    return { context };
  }

  log.debug('Processing DOM event', {
    eventType: message.eventType,
    domEventType: message.domEventType,
  });

  // Convert DOM event to XState event
  const xstateEvent = {
    type: message.eventType,
    ...(message.formData || {}),
  };

  // Send event to XState machine
  context.xstateActor.send(xstateEvent);

  // Wait for XState state change to propagate and then get bridge emissions
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

  const stateChangeMessages: Message[] = [];
  if (context.xstateBridge) {
    stateChangeMessages.push(...context.xstateBridge.triggerPendingEmission());
  }

  // Update context with new state if available
  const latestStateChange = stateChangeMessages[stateChangeMessages.length - 1];
  const newContext: ComponentActorContext = {
    ...context,
    currentState: latestStateChange
      ? 'value' in latestStateChange
        ? latestStateChange.value
        : undefined
      : context.currentState,
  };

  // Call custom handler if provided with fan-out processing
  let fanOutResult: { context: ComponentActorContext; emit: Message[] } = {
    context: newContext,
    emit: [],
  };

  if (customHandler) {
    log.debug('Calling custom handler for DOM event', { eventType: message.eventType });

    // 🎯 Call the enhanced custom handler (supports fan-out return types)
    const handlerResult = await customHandler({
      message,
      context: newContext,
      machine: xstateToActorInstance(context.xstateActor),
      dependencies: context.dependencies,
    });

    // 🚀 Process fan-out result using our Day 2 runtime logic
    fanOutResult = await processFanOutResult(handlerResult, newContext, context.xstateActor);

    log.debug('Fan-out processing complete for DOM event', {
      eventType: message.eventType,
      emitCount: fanOutResult.emit.length,
      contextUpdated: fanOutResult.context !== newContext,
    });
  }

  // Trigger render after state change
  const renderResult = await handleRender(fanOutResult.context);

  // Collect all messages to emit
  const emitMessages = [
    ...(fanOutResult.emit || []),
    ...(renderResult.emit || []),
    ...stateChangeMessages,
  ];

  return {
    context: renderResult.context,
    emit: emitMessages,
  };
}

/**
 * Handle rendering the component
 */
async function handleRender(
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: Message[] }> {
  if (!context.element || !context.template || !context.isMounted) {
    return { context };
  }

  try {
    // Generate HTML from template
    const html = context.template(context.currentState);

    // Update DOM efficiently (simple innerHTML for now, can be optimized)
    context.element.innerHTML = html;

    // Re-attach event listeners after DOM update
    setupDOMEventListeners(context.element, async (message) => {
      // This is a placeholder for the actual message sending mechanism
      // In a real implementation, this would involve a transport layer
      // For now, we just log the message
      log.debug('DOM event received by component actor', { type: message.type });
    });

    const newContext: ComponentActorContext = {
      ...context,
      renderCount: context.renderCount + 1,
      lastRender: Date.now(),
    };

    log.debug('Component rendered', {
      renderCount: newContext.renderCount,
      machineId: context.machine.id,
    });

    return {
      context: newContext,
      emit: [
        {
          type: 'COMPONENT_RENDERED',
          machineId: context.machine.id,
          renderCount: newContext.renderCount,
          renderTime: newContext.lastRender,
        },
      ],
    };
  } catch (error) {
    log.error('Error during component render', {
      error: error instanceof Error ? error.message : 'Unknown error',
      machineId: context.machine.id,
    });

    return {
      context,
      emit: [
        {
          type: 'COMPONENT_RENDER_ERROR',
          machineId: context.machine.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
    };
  }
}

/**
 * Handle XState machine transitions
 */
async function handleXStateTransition(
  message: XStateTransitionMessage,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: Message[] }> {
  log.debug('XState transition', { from: message.from, to: message.to });

  const newContext: ComponentActorContext = {
    ...context,
    currentState: null, // State updates come via messages, not direct access
  };

  // Automatically trigger render on state change
  return await handleRender(newContext);
}

/**
 * Handle STATE_CHANGED messages from XState actor
 */
async function handleStateChanged(
  message: StateChangedMessage,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: Message[] }> {
  log.debug('XState state changed', { value: message.value, context: message.context });

  const newContext: ComponentActorContext = {
    ...context,
    currentState: message.value,
  };

  // Automatically trigger render on state change
  return await handleRender(newContext);
}

/**
 * Handle dependency updates
 */
async function handleUpdateDependencies(
  message: UpdateDependenciesMessage,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: Message[] }> {
  log.info('Updating component dependencies', {
    dependencyCount: Object.keys(message.dependencies).length,
  });

  const newContext: ComponentActorContext = {
    ...context,
    dependencies: message.dependencies,
  };

  return { context: newContext };
}

// ============================================================================
// DOM INTEGRATION HELPERS
// ============================================================================

/**
 * Set up XState integration for component actor
 * FIXED: Now sends messages to component actor instead of direct calls
 */
function _setupXStateIntegration(
  xstateActor: Actor<AnyStateMachine>,
  componentActorSend: (message: Message) => Promise<void>
): void {
  // Listen for state transitions and convert to actor messages
  xstateActor.subscribe((state) => {
    // Send STATE_CHANGED message to component actor (pure actor model)
    componentActorSend({
      type: 'STATE_CHANGED',
      value: state.value,
      context: state.context,
      tags: Array.from(state.tags || []),
      // Only include basic state information that exists on XState snapshot
      status: state.status,
      output: state.output,
    }).catch((error) => {
      log.error('Failed to send STATE_CHANGED message', error);
    });
  });
}

/**
 * Set up DOM event listeners for send attributes
 */
function setupDOMEventListeners(
  element: HTMLElement,
  sendToActor: (message: Message) => Promise<void>
): void {
  // Find all elements with send attributes
  const sendElements = element.querySelectorAll('[send], [data-send]');

  sendElements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const sendType = htmlEl.getAttribute('send') || htmlEl.getAttribute('data-send');

    if (!sendType) return;

    // Determine event type based on element
    const eventType = getEventTypeForElement(htmlEl);

    // Remove existing listeners to avoid duplicates
    const existingListener = (htmlEl as unknown as Record<symbol, unknown>)[
      ComponentSymbols.EVENT_LISTENER
    ] as EventListener | undefined;
    if (existingListener) {
      htmlEl.removeEventListener(eventType, existingListener);
    }

    // Create and attach new listener
    const listener = (event: Event) => {
      event.preventDefault();

      // Extract attributes and form data
      const attributes = extractAttributes(htmlEl);
      const formData = extractFormData(event);

      // 🎯 FIXED: Send DOM_EVENT message to component actor with flat structure
      const message = {
        type: 'DOM_EVENT',
        eventType: sendType,
        domEventType: eventType,
        attributes,
        formData,
        target: {
          tagName: htmlEl.tagName,
          id: htmlEl.id,
          className: htmlEl.className,
        },
      };

      sendToActor(message).catch((error) => {
        log.error('Failed to send DOM event to component actor', {
          error: error instanceof Error ? error.message : 'Unknown error',
          eventType: sendType,
        });
      });
    };

    htmlEl.addEventListener(eventType, listener);
    // Store listener reference for cleanup using symbol-based approach
    Object.defineProperty(htmlEl, ComponentSymbols.EVENT_LISTENER, {
      value: listener,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  });
}

/**
 * Clean up DOM event listeners
 */
function cleanupDOMEventListeners(element: HTMLElement): void {
  const sendElements = element.querySelectorAll('[send], [data-send]');

  sendElements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const listener = (htmlEl as unknown as Record<symbol, unknown>)[
      ComponentSymbols.EVENT_LISTENER
    ] as EventListener | undefined;

    if (listener) {
      const eventType = getEventTypeForElement(htmlEl);
      htmlEl.removeEventListener(eventType, listener);
      delete (htmlEl as unknown as Record<symbol, unknown>)[ComponentSymbols.EVENT_LISTENER];
    }
  });
}

/**
 * Get appropriate event type for element
 */
function getEventTypeForElement(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();

  switch (tagName) {
    case 'form':
      return 'submit';
    case 'input':
    case 'textarea':
    case 'select':
      return element.getAttribute('type') === 'submit' ? 'click' : 'input';
    case 'button':
      return 'click';
    default:
      return 'click';
  }
}

/**
 * Extract attributes from element for flat message
 */
function extractAttributes(element: HTMLElement): Record<string, string> {
  const attributes: Record<string, string> = {};

  // Extract all data attributes and special attributes
  for (const attr of Array.from(element.attributes)) {
    if (
      attr.name.startsWith('data-') ||
      ['user-id', 'item-id', 'role', 'count', 'payload'].includes(attr.name)
    ) {
      const key = attr.name
        .replace(/^data-/, '')
        .replace(/-([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
      attributes[key] = attr.value;
    }
  }

  return attributes;
}

/**
 * Extract form data if event is from a form
 */
function extractFormData(event: Event): Record<string, string> | undefined {
  const target = event.target as HTMLElement;
  const form = target.tagName === 'FORM' ? target : target.closest('form');

  if (!form) return undefined;

  const formData = new FormData(form as HTMLFormElement);
  const data: Record<string, string> = {};

  formData.forEach((value, key) => {
    data[key] = value.toString();
  });

  return data;
}
