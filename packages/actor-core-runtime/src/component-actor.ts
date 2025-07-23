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
import type { ActorBehavior, ActorMessage, ActorPID, JsonValue } from './actor-system.js';
import { SupervisionDirective } from './actor-system.js';
import { Logger } from './logger.js';
import type { FanOutResult } from './runtime-fanout.js';
// Import fan-out detection and types
import { detectFanOutEvents } from './runtime-fanout.js';

const log = Logger.namespace('COMPONENT_ACTOR');

// ============================================================================
// COMPONENT ACTOR TYPES
// ============================================================================

/**
 * Component Actor Messages - All messages a component actor can receive
 */
export type ComponentActorMessage =
  | { type: 'DOM_EVENT'; payload: DOMEventPayload }
  | { type: 'RENDER'; payload: null }
  | { type: 'XSTATE_TRANSITION'; payload: XStateTransitionPayload }
  | { type: 'STATE_CHANGED'; payload: StateChangedPayload }
  | { type: 'EXTERNAL_MESSAGE'; payload: JsonValue }
  | { type: 'MOUNT_COMPONENT'; payload: MountPayload }
  | { type: 'UNMOUNT_COMPONENT'; payload: null }
  | { type: 'UPDATE_DEPENDENCIES'; payload: DependenciesPayload };

/**
 * DOM Event payload from user interactions
 */
export interface DOMEventPayload {
  eventType: string;
  domEventType: string; // 'click', 'input', 'submit', etc.
  attributes: Record<string, string>;
  formData?: Record<string, string>;
  target?: {
    tagName: string;
    id: string;
    className: string;
  };
}

/**
 * Convert DOMEventPayload to JsonValue for message compatibility
 */
function _domEventPayloadToJson(payload: DOMEventPayload): JsonValue {
  return {
    eventType: payload.eventType,
    domEventType: payload.domEventType,
    attributes: payload.attributes,
    formData: payload.formData || null,
    target: payload.target || null,
  };
}

/**
 * XState machine transition payload
 */
export interface XStateTransitionPayload {
  from: string;
  to: string;
  event: JsonValue;
  context: JsonValue;
}

/**
 * Component mount payload (JSON-serializable)
 */
export interface MountPayload {
  elementId: string;
  hasTemplate: boolean;
  dependencies?: ActorDependencies;
}

/**
 * Actor dependencies configuration
 */
export interface ActorDependencies {
  [key: string]: string; // actor://path/to/actor
}

/**
 * Dependencies update payload
 */
export interface DependenciesPayload {
  dependencies: Record<string, ActorPID>;
}

/**
 * Template function type
 */
export type TemplateFunction = (state: unknown) => string;

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
  readonly dependencies: Record<string, ActorPID>;
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
  dependencies?: ActorDependencies;
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
  machine: Actor<AnyStateMachine>;
  dependencies: Record<string, ActorPID>;
}) => Promise<FanOutResult<ComponentActorContext, never, unknown>>;

/**
 * State Changed payload from XState transitions
 */
export interface StateChangedPayload {
  value: JsonValue; // XState state value
  context: JsonValue; // XState context
  tags: string[]; // State tags
  status: string; // State status
  output: JsonValue; // State output
}

// ============================================================================
// XSTATE BRIDGE IMPLEMENTATION
// ============================================================================

/**
 * XState Bridge - Handles state change integration with the actor system
 * This class manages the connection between XState actors and the component actor
 */
class XStateBridge {
  private stateChangePending = false;
  private latestStateMessage: ActorMessage | null = null;

  constructor(private xstateActor: Actor<AnyStateMachine>) {
    this.setupStateChangeListener();
  }

  private setupStateChangeListener(): void {
    // Subscribe to XState state changes and convert to actor messages
    this.xstateActor.subscribe((state) => {
      const stateMessage: ActorMessage = {
        type: 'STATE_CHANGED',
        payload: {
          value: state.value,
          context: state.context,
          tags: Array.from(state.tags || []),
          status: state.status,
          output: state.output,
        },
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
  triggerPendingEmission(): ActorMessage[] {
    const messages: ActorMessage[] = [];
    if (this.stateChangePending && this.latestStateMessage) {
      messages.push(this.latestStateMessage);
      this.stateChangePending = false;

      log.debug('XState bridge emitting pending state change', {
        type: this.latestStateMessage.type,
        value: (this.latestStateMessage.payload as { value: unknown }).value,
      });
    }
    return messages;
  }

  /**
   * Get pending state change message if available
   * This allows the actor system to retrieve state changes when processing messages
   */
  getPendingStateChange(): ActorMessage | null {
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
  const initialContext: ComponentActorContext = {
    machine: config.machine,
    xstateActor: null,
    xstateBridge: null,
    currentState: null,
    element: null,
    template: config.template,
    isMounted: false,
    dependencies: {},
    messageCount: 0,
    renderCount: 0,
    lastRender: 0,
    mountTime: 0,
    isDestroyed: false,
  };

  const behavior: ActorBehavior<ComponentActorMessage, ComponentActorContext> = {
    context: initialContext,

    async onMessage({ message, context }) {
      if (context.isDestroyed) {
        log.warn('Message received by destroyed component actor', { type: message.type });
        return { context };
      }

      const newContext = {
        ...context,
        messageCount: context.messageCount + 1,
      };

      log.debug('Component actor received message', {
        type: message.type,
        messageCount: newContext.messageCount,
      });

      switch (message.type) {
        case 'MOUNT_COMPONENT':
          return await handleMountComponent(message.payload, newContext);

        case 'UNMOUNT_COMPONENT':
          return await handleUnmountComponent(newContext);

        case 'DOM_EVENT':
          return await handleDOMEvent(message.payload, newContext, config.onMessage);

        case 'RENDER':
          return await handleRender(newContext);

        case 'XSTATE_TRANSITION':
          return await handleXStateTransition(message.payload, newContext);

        case 'STATE_CHANGED':
          return await handleStateChanged(message.payload, newContext);

        case 'EXTERNAL_MESSAGE':
          return await handleExternalMessage(message.payload, newContext, config.onMessage);

        case 'UPDATE_DEPENDENCIES':
          return await handleUpdateDependencies(message.payload, newContext);

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
 * Simplified for fan-out-only approach (no legacy compatibility)
 */
async function processFanOutResult(
  fanOutResult: FanOutResult<ComponentActorContext, never, unknown>,
  originalContext: ComponentActorContext,
  xstateActor: Actor<AnyStateMachine>
): Promise<{ context: ComponentActorContext; emit: ActorMessage[] }> {
  // Detect fan-out events using our robust type system
  const {
    context: resultContext,
    emit: traditionalEmit,
    fanOutEvents,
  } = detectFanOutEvents(fanOutResult, originalContext);

  // Prepare emit messages array
  const emitMessages: ActorMessage[] = [];

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
    emitMessages.push({
      type: fanOutEvent.type,
      payload: fanOutEvent,
      timestamp: Date.now(),
      version: '1.0.0',
    });

    log.debug('Fan-out event added to emit queue', { eventType: fanOutEvent.type });
  }

  // Handle any traditional emit from enhanced results (rare edge case)
  if (traditionalEmit) {
    const emitArray = Array.isArray(traditionalEmit) ? traditionalEmit : [traditionalEmit];
    for (const event of emitArray) {
      if (typeof event === 'object' && event !== null && 'type' in event) {
        emitMessages.push({
          type: (event as { type: string }).type,
          payload: event,
          timestamp: Date.now(),
          version: '1.0.0',
        });
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
  payload: MountPayload,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
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
  const resolvedDependencies: Record<string, ActorPID> = {};
  if (payload.dependencies) {
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
  const initialStateMessage: ActorMessage = {
    type: 'STATE_CHANGED',
    payload: {
      value: initialState.value,
      context: initialState.context,
      tags: Array.from(initialState.tags || []),
      status: initialState.status,
      output: initialState.output,
    },
    timestamp: Date.now(),
    version: '1.0.0',
  };

  // Trigger any pending state changes from the bridge after startup
  const pendingBridgeMessages = xstateBridge.triggerPendingEmission();

  return {
    context: newContext,
    emit: [
      {
        type: 'COMPONENT_MOUNTED',
        payload: {
          elementId: payload.elementId,
          machineId: context.machine.id,
          mountTime: newContext.mountTime,
        },
        timestamp: Date.now(),
        version: '1.0.0',
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
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
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
        payload: {
          machineId: context.machine.id,
          uptime: Date.now() - context.mountTime,
        },
        timestamp: Date.now(),
        version: '1.0.0',
      },
    ],
  };
}

/**
 * Handle DOM events from user interactions
 */
async function handleDOMEvent(
  payload: DOMEventPayload,
  context: ComponentActorContext,
  customHandler?: ComponentMessageHandler
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
  if (!context.xstateActor || !context.isMounted) {
    log.warn('DOM event received but component not mounted');
    return { context };
  }

  log.debug('Processing DOM event', {
    eventType: payload.eventType,
    domEventType: payload.domEventType,
  });

  // Convert DOM event to XState event
  const xstateEvent = {
    type: payload.eventType,
    ...payload.attributes,
    ...(payload.formData || {}),
  };

  // Send event to XState machine
  context.xstateActor.send(xstateEvent);

  // Wait for XState state change to propagate and then get bridge emissions
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

  const stateChangeMessages: ActorMessage[] = [];
  if (context.xstateBridge) {
    stateChangeMessages.push(...context.xstateBridge.triggerPendingEmission());
  }

  // Update context with new state if available
  const latestStateChange = stateChangeMessages[stateChangeMessages.length - 1];
  const newContext: ComponentActorContext = {
    ...context,
    currentState: latestStateChange
      ? (latestStateChange.payload as { value: unknown }).value
      : context.currentState,
  };

  // Call custom handler if provided with fan-out processing
  let fanOutResult: { context: ComponentActorContext; emit: ActorMessage[] } = {
    context: newContext,
    emit: [],
  };

  if (customHandler) {
    log.debug('Calling custom handler for DOM event', { eventType: payload.eventType });

    // 🎯 Call the enhanced custom handler (supports fan-out return types)
    const handlerResult = await customHandler({
      message: { type: 'DOM_EVENT', payload },
      context: newContext,
      machine: context.xstateActor,
      dependencies: context.dependencies,
    });

    // 🚀 Process fan-out result using our Day 2 runtime logic
    fanOutResult = await processFanOutResult(handlerResult, newContext, context.xstateActor);

    log.debug('Fan-out processing complete for DOM event', {
      eventType: payload.eventType,
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
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
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
          payload: {
            machineId: context.machine.id,
            renderCount: newContext.renderCount,
            renderTime: newContext.lastRender,
          },
          timestamp: Date.now(),
          version: '1.0.0',
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
          payload: {
            machineId: context.machine.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          timestamp: Date.now(),
          version: '1.0.0',
        },
      ],
    };
  }
}

/**
 * Handle XState machine transitions
 */
async function handleXStateTransition(
  payload: XStateTransitionPayload,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
  log.debug('XState transition', { from: payload.from, to: payload.to });

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
  payload: StateChangedPayload,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
  log.debug('XState state changed', { value: payload.value, context: payload.context });

  const newContext: ComponentActorContext = {
    ...context,
    currentState: payload.value,
  };

  // Automatically trigger render on state change
  return await handleRender(newContext);
}

/**
 * Handle external messages from other actors
 */
async function handleExternalMessage(
  payload: JsonValue,
  context: ComponentActorContext,
  customHandler?: ComponentMessageHandler
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
  log.debug('Processing external message', { payload });

  if (!customHandler || !context.xstateActor) {
    log.warn('Cannot process external message - no custom handler or XState actor not available');
    return { context };
  }

  log.debug('Calling custom handler for external message');

  // 🎯 Call the enhanced custom handler (supports fan-out return types)
  const handlerResult = await customHandler({
    message: { type: 'EXTERNAL_MESSAGE', payload },
    context,
    machine: context.xstateActor,
    dependencies: context.dependencies,
  });

  // 🚀 Process fan-out result using our Day 2 runtime logic
  const fanOutResult = await processFanOutResult(handlerResult, context, context.xstateActor);

  log.debug('Fan-out processing complete for external message', {
    emitCount: fanOutResult.emit.length,
    contextUpdated: fanOutResult.context !== context,
  });

  return {
    context: fanOutResult.context,
    emit: fanOutResult.emit,
  };
}

/**
 * Handle dependency updates
 */
async function handleUpdateDependencies(
  payload: DependenciesPayload,
  context: ComponentActorContext
): Promise<{ context: ComponentActorContext; emit?: ActorMessage[] }> {
  log.info('Updating component dependencies', {
    dependencyCount: Object.keys(payload.dependencies).length,
  });

  const newContext: ComponentActorContext = {
    ...context,
    dependencies: payload.dependencies,
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
  componentActorSend: (message: ActorMessage) => Promise<void>
): void {
  // Listen for state transitions and convert to actor messages
  xstateActor.subscribe((state) => {
    // Send STATE_CHANGED message to component actor (pure actor model)
    componentActorSend({
      type: 'STATE_CHANGED',
      payload: {
        value: state.value,
        context: state.context,
        tags: Array.from(state.tags || []),
        // Only include basic state information that exists on XState snapshot
        status: state.status,
        output: state.output,
      },
      timestamp: Date.now(),
      version: '1.0.0',
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
  sendToActor: (message: ActorMessage) => Promise<void>
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
    const existingListener = (htmlEl as HTMLElement & { __componentEventListener?: EventListener })
      .__componentEventListener;
    if (existingListener) {
      htmlEl.removeEventListener(eventType, existingListener);
    }

    // Create and attach new listener
    const listener = (event: Event) => {
      event.preventDefault();

      // Extract attributes and form data
      const attributes = extractAttributes(htmlEl);
      const formData = extractFormData(event);

      const payload: DOMEventPayload = {
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

      // 🎯 FIXED: Send DOM_EVENT message to component actor
      const message: ActorMessage = {
        type: 'DOM_EVENT',
        payload: _domEventPayloadToJson(payload),
        timestamp: Date.now(),
        version: '1.0.0',
      };

      sendToActor(message).catch((error) => {
        log.error('Failed to send DOM event to component actor', {
          error: error instanceof Error ? error.message : 'Unknown error',
          eventType: sendType,
        });
      });
    };

    htmlEl.addEventListener(eventType, listener);
    (
      htmlEl as HTMLElement & { __componentEventListener?: EventListener }
    ).__componentEventListener = listener;
  });
}

/**
 * Clean up DOM event listeners
 */
function cleanupDOMEventListeners(element: HTMLElement): void {
  const sendElements = element.querySelectorAll('[send], [data-send]');

  sendElements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const listener = (htmlEl as HTMLElement & { __componentEventListener?: EventListener })
      .__componentEventListener;

    if (listener) {
      const eventType = getEventTypeForElement(htmlEl);
      htmlEl.removeEventListener(eventType, listener);
      delete (htmlEl as HTMLElement & { __componentEventListener?: EventListener })
        .__componentEventListener;
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
 * Extract attributes from element for message payload
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
