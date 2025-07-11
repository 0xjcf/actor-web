/**
 * Global Event Delegation System for Actor-SPA Framework
 *
 * Provides a unified, framework-level API for global event handling that integrates
 * with existing ReactiveEventBus and component systems. Based on patterns from the
 * mobile nav event service but generalized for any component.
 */

import { type SnapshotFrom, assign, createActor, setup } from 'xstate';

// Type definitions
export interface GlobalEventListener {
  id: string;
  eventType:
    | 'keydown'
    | 'keyup'
    | 'resize'
    | 'scroll'
    | 'click'
    | 'touchstart'
    | 'touchmove'
    | 'touchend'
    | 'beforeunload'
    | 'focus'
    | 'blur'
    | 'DOMContentLoaded';
  target: 'document' | 'window' | 'body';
  action: string; // The action/event type to send to component
  componentId?: string; // Optional: scope to specific component
  enabled?: boolean;
  conditions?: EventCondition[];
  debounce?: number;
  throttle?: number;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface EventCondition {
  type: 'key' | 'modifier' | 'target' | 'custom' | 'state';
  value: string | ((event: Event) => boolean);
  negate?: boolean; // Allow negative conditions
}

export interface GlobalEventContext {
  listeners: Map<string, GlobalEventListener>;
  activeSubscriptions: Map<string, AbortController>;
  componentCallbacks: Map<string, (action: string, event: Event) => void>;
  performanceConfig: {
    enableDebouncing: boolean;
    enableThrottling: boolean;
    defaultDebounceMs: number;
    defaultThrottleMs: number;
  };
  debugMode: boolean;
}

export type GlobalEventEvent =
  | {
      type: 'REGISTER_LISTENER';
      listener: GlobalEventListener;
      callback?: (action: string, event: Event) => void;
    }
  | { type: 'UNREGISTER_LISTENER'; id: string }
  | { type: 'UNREGISTER_COMPONENT'; componentId: string }
  | { type: 'GLOBAL_EVENT_TRIGGERED'; listener: GlobalEventListener; originalEvent: Event }
  | { type: 'ENABLE_LISTENER'; id: string }
  | { type: 'DISABLE_LISTENER'; id: string }
  | { type: 'UPDATE_PERFORMANCE_CONFIG'; config: Partial<GlobalEventContext['performanceConfig']> }
  | { type: 'TOGGLE_DEBUG_MODE'; enabled?: boolean };

// Global Event Delegation Machine
export const globalEventMachine = setup({
  types: {
    context: {} as GlobalEventContext,
    events: {} as GlobalEventEvent,
  },
  guards: {
    isListenerEnabled: ({ event }) => {
      if (event.type !== 'GLOBAL_EVENT_TRIGGERED') return false;
      return event.listener.enabled !== false;
    },
    meetsConditions: ({ event }) => {
      if (event.type !== 'GLOBAL_EVENT_TRIGGERED') return true;

      const { listener, originalEvent } = event;
      if (!listener.conditions?.length) return true;

      return listener.conditions.every((condition) => {
        let result = false;

        switch (condition.type) {
          case 'key':
            result = (originalEvent as KeyboardEvent).key === condition.value;
            break;

          case 'modifier': {
            const modifierMap = {
              ctrl: (originalEvent as KeyboardEvent).ctrlKey,
              meta: (originalEvent as KeyboardEvent).metaKey,
              shift: (originalEvent as KeyboardEvent).shiftKey,
              alt: (originalEvent as KeyboardEvent).altKey,
            };
            result = modifierMap[condition.value as keyof typeof modifierMap] || false;
            break;
          }

          case 'target':
            result = (originalEvent.target as Element).matches(condition.value as string);
            break;

          case 'custom':
            result = typeof condition.value === 'function' ? condition.value(originalEvent) : false;
            break;

          case 'state':
            // Allow components to provide state-based conditions
            if (typeof condition.value === 'function') {
              result = condition.value(originalEvent);
            }
            break;

          default:
            result = true;
        }

        return condition.negate ? !result : result;
      });
    },
    // Combined guard for XState v5 migration - combines isListenerEnabled and meetsConditions
    canHandleGlobalEvent: ({ event }) => {
      if (event.type !== 'GLOBAL_EVENT_TRIGGERED') return false;

      // Check if listener is enabled
      const isEnabled = event.listener.enabled !== false;
      if (!isEnabled) return false;

      // Check if conditions are met
      const { listener, originalEvent } = event;
      if (!listener.conditions?.length) return true;

      return listener.conditions.every((condition) => {
        let result = false;

        switch (condition.type) {
          case 'key':
            result = (originalEvent as KeyboardEvent).key === condition.value;
            break;

          case 'modifier': {
            const modifierMap = {
              ctrl: (originalEvent as KeyboardEvent).ctrlKey,
              meta: (originalEvent as KeyboardEvent).metaKey,
              shift: (originalEvent as KeyboardEvent).shiftKey,
              alt: (originalEvent as KeyboardEvent).altKey,
            };
            result = modifierMap[condition.value as keyof typeof modifierMap] || false;
            break;
          }

          case 'target': {
            // Safely check if target is an Element and has matches method
            const target = originalEvent.target;
            if (
              target &&
              typeof target === 'object' &&
              'matches' in target &&
              typeof target.matches === 'function'
            ) {
              try {
                result = target.matches(condition.value as string);
              } catch {
                result = false;
              }
            } else {
              result = false;
            }
            break;
          }

          case 'custom':
            // Safely execute custom condition functions with error handling
            try {
              result =
                typeof condition.value === 'function' ? condition.value(originalEvent) : false;
            } catch {
              result = false;
            }
            break;

          case 'state':
            // Allow components to provide state-based conditions
            if (typeof condition.value === 'function') {
              result = condition.value(originalEvent);
            }
            break;

          default:
            result = true;
        }

        return condition.negate ? !result : result;
      });
    },
  },
  actions: {
    registerListener: assign({
      listeners: ({ context, event }) => {
        if (event.type !== 'REGISTER_LISTENER') return context.listeners;

        const newListeners = new Map(context.listeners);
        newListeners.set(event.listener.id, event.listener);
        return newListeners;
      },
      componentCallbacks: ({ context, event }) => {
        if (event.type !== 'REGISTER_LISTENER' || !event.callback)
          return context.componentCallbacks;

        const newCallbacks = new Map(context.componentCallbacks);
        if (event.listener.componentId) {
          newCallbacks.set(event.listener.componentId, event.callback);
        }
        return newCallbacks;
      },
    }),

    unregisterListener: assign({
      listeners: ({ context, event }) => {
        if (event.type !== 'UNREGISTER_LISTENER') return context.listeners;

        const newListeners = new Map(context.listeners);
        newListeners.delete(event.id);
        return newListeners;
      },
      activeSubscriptions: ({ context, event }) => {
        if (event.type !== 'UNREGISTER_LISTENER') return context.activeSubscriptions;

        const subscription = context.activeSubscriptions.get(event.id);
        if (subscription) {
          subscription.abort();
        }

        const newSubscriptions = new Map(context.activeSubscriptions);
        newSubscriptions.delete(event.id);
        return newSubscriptions;
      },
    }),

    unregisterComponentListeners: assign({
      listeners: ({ context, event }) => {
        if (event.type !== 'UNREGISTER_COMPONENT') return context.listeners;

        const newListeners = new Map(context.listeners);
        for (const [id, listener] of newListeners.entries()) {
          if (listener.componentId === event.componentId) {
            newListeners.delete(id);
          }
        }
        return newListeners;
      },
      componentCallbacks: ({ context, event }) => {
        if (event.type !== 'UNREGISTER_COMPONENT') return context.componentCallbacks;

        const newCallbacks = new Map(context.componentCallbacks);
        newCallbacks.delete(event.componentId);
        return newCallbacks;
      },
    }),

    enableListener: assign({
      listeners: ({ context, event }) => {
        if (event.type !== 'ENABLE_LISTENER') return context.listeners;

        const listener = context.listeners.get(event.id);
        if (!listener) return context.listeners;

        const newListeners = new Map(context.listeners);
        newListeners.set(event.id, { ...listener, enabled: true });
        return newListeners;
      },
    }),

    disableListener: assign({
      listeners: ({ context, event }) => {
        if (event.type !== 'DISABLE_LISTENER') return context.listeners;

        const listener = context.listeners.get(event.id);
        if (!listener) return context.listeners;

        const newListeners = new Map(context.listeners);
        newListeners.set(event.id, { ...listener, enabled: false });
        return newListeners;
      },
    }),

    updatePerformanceConfig: assign({
      performanceConfig: ({ context, event }) => {
        if (event.type !== 'UPDATE_PERFORMANCE_CONFIG') return context.performanceConfig;
        return { ...context.performanceConfig, ...event.config };
      },
    }),

    toggleDebugMode: assign({
      debugMode: ({ context, event }) => {
        if (event.type !== 'TOGGLE_DEBUG_MODE') return context.debugMode;
        return event.enabled ?? !context.debugMode;
      },
    }),

    handleGlobalEvent: ({ context, event }) => {
      if (event.type !== 'GLOBAL_EVENT_TRIGGERED') return;

      const { listener, originalEvent } = event;

      // Handle preventDefault and stopPropagation
      if (listener.preventDefault) originalEvent.preventDefault();
      if (listener.stopPropagation) originalEvent.stopPropagation();

      // Debug logging
      if (context.debugMode) {
        console.log('[GlobalEventDelegation]', {
          listenerId: listener.id,
          eventType: listener.eventType,
          action: listener.action,
          componentId: listener.componentId,
          originalEvent,
        });
      }

      // Send to component callback if available
      if (listener.componentId) {
        const callback = context.componentCallbacks.get(listener.componentId);
        if (callback) {
          callback(listener.action, originalEvent);
        }
      }

      // Send to global custom event system for components that don't use callbacks
      window.dispatchEvent(
        new CustomEvent('global-action', {
          detail: {
            action: listener.action,
            componentId: listener.componentId,
            listenerId: listener.id,
            originalEvent,
          },
          bubbles: true,
          composed: true,
        })
      );
    },
  },
}).createMachine({
  id: 'globalEventDelegation',
  initial: 'active',
  context: {
    listeners: new Map(),
    activeSubscriptions: new Map(),
    componentCallbacks: new Map(),
    performanceConfig: {
      enableDebouncing: true,
      enableThrottling: true,
      defaultDebounceMs: 100,
      defaultThrottleMs: 16,
    },
    debugMode: false,
  },
  states: {
    active: {
      on: {
        REGISTER_LISTENER: {
          actions: 'registerListener',
        },
        UNREGISTER_LISTENER: {
          actions: 'unregisterListener',
        },
        UNREGISTER_COMPONENT: {
          actions: 'unregisterComponentListeners',
        },
        GLOBAL_EVENT_TRIGGERED: {
          guard: 'canHandleGlobalEvent',
          actions: 'handleGlobalEvent',
        },
        ENABLE_LISTENER: {
          actions: 'enableListener',
        },
        DISABLE_LISTENER: {
          actions: 'disableListener',
        },
        UPDATE_PERFORMANCE_CONFIG: {
          actions: 'updatePerformanceConfig',
        },
        TOGGLE_DEBUG_MODE: {
          actions: 'toggleDebugMode',
        },
      },
    },
  },
});

// Global Event Delegation Service
export class GlobalEventDelegation {
  private static instance: GlobalEventDelegation | null = null;
  private actor = createActor(globalEventMachine);
  private setupComplete = false;
  private debounceMap = new Map<string, number>();
  private throttleMap = new Map<string, number>();

  private constructor() {
    this.actor.start();
    this.setupGlobalListeners();
  }

  static getInstance(): GlobalEventDelegation {
    if (!GlobalEventDelegation.instance) {
      GlobalEventDelegation.instance = new GlobalEventDelegation();
    }
    return GlobalEventDelegation.instance;
  }

  /**
   * Register a global event listener
   */
  subscribe(
    listener: GlobalEventListener,
    callback?: (action: string, event: Event) => void
  ): string {
    this.actor.send({
      type: 'REGISTER_LISTENER',
      listener: { ...listener, enabled: listener.enabled ?? true },
      callback,
    });

    return listener.id;
  }

  /**
   * Unregister a specific listener
   */
  unsubscribe(id: string): void {
    this.actor.send({ type: 'UNREGISTER_LISTENER', id });
  }

  /**
   * Unregister all listeners for a component
   */
  unsubscribeComponent(componentId: string): void {
    this.actor.send({ type: 'UNREGISTER_COMPONENT', componentId });
  }

  /**
   * Enable/disable a listener
   */
  setListenerEnabled(id: string, enabled: boolean): void {
    this.actor.send({ type: enabled ? 'ENABLE_LISTENER' : 'DISABLE_LISTENER', id });
  }

  /**
   * Update performance configuration
   */
  updateConfig(config: Partial<GlobalEventContext['performanceConfig']>): void {
    this.actor.send({ type: 'UPDATE_PERFORMANCE_CONFIG', config });
  }

  /**
   * Toggle debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.actor.send({ type: 'TOGGLE_DEBUG_MODE', enabled });
  }

  /**
   * Get current state snapshot
   */
  getSnapshot(): SnapshotFrom<typeof globalEventMachine> {
    return this.actor.getSnapshot();
  }

  /**
   * Create convenient subscription helpers for common patterns
   */
  subscribeKeyboard(options: {
    key: string;
    action: string;
    componentId?: string;
    modifiers?: ('ctrl' | 'meta' | 'shift' | 'alt')[];
    preventDefault?: boolean;
    callback?: (action: string, event: Event) => void;
  }): string {
    const conditions: EventCondition[] = [{ type: 'key', value: options.key }];

    if (options.modifiers?.length) {
      conditions.push(
        ...options.modifiers.map((mod) => ({ type: 'modifier' as const, value: mod }))
      );
    }

    return this.subscribe(
      {
        id: `keyboard-${options.componentId || 'global'}-${options.key}-${Date.now()}`,
        eventType: 'keydown',
        target: 'document',
        action: options.action,
        componentId: options.componentId,
        conditions,
        preventDefault: options.preventDefault,
      },
      options.callback
    );
  }

  subscribeResize(options: {
    action: string;
    componentId?: string;
    debounce?: number;
    callback?: (action: string, event: Event) => void;
  }): string {
    return this.subscribe(
      {
        id: `resize-${options.componentId || 'global'}-${Date.now()}`,
        eventType: 'resize',
        target: 'window',
        action: options.action,
        componentId: options.componentId,
        debounce: options.debounce ?? 100,
      },
      options.callback
    );
  }

  subscribeClick(options: {
    action: string;
    componentId?: string;
    targetSelector?: string;
    callback?: (action: string, event: Event) => void;
  }): string {
    const conditions: EventCondition[] = [];

    if (options.targetSelector) {
      conditions.push({ type: 'target', value: options.targetSelector });
    }

    return this.subscribe(
      {
        id: `click-${options.componentId || 'global'}-${Date.now()}`,
        eventType: 'click',
        target: 'document',
        action: options.action,
        componentId: options.componentId,
        conditions: conditions.length > 0 ? conditions : undefined,
      },
      options.callback
    );
  }

  /**
   * Set up the actual DOM event listeners
   */
  private setupGlobalListeners(): void {
    if (this.setupComplete) return;

    const eventTypes: GlobalEventListener['eventType'][] = [
      'keydown',
      'keyup',
      'resize',
      'scroll',
      'click',
      'touchstart',
      'touchmove',
      'touchend',
      'beforeunload',
      'focus',
      'blur',
    ];

    for (const eventType of eventTypes) {
      this.setupEventType(eventType);
    }

    this.setupComplete = true;
  }

  private setupEventType(eventType: GlobalEventListener['eventType']): void {
    const handler = (originalEvent: Event) => {
      const context = this.actor.getSnapshot().context;

      // Find all listeners for this event type
      for (const [id, listener] of context.listeners.entries()) {
        if (listener.eventType !== eventType) continue;

        // Apply debouncing/throttling if configured
        if (this.shouldSkipDueToPerformance(id, listener)) continue;

        // Send to machine for processing
        this.actor.send({
          type: 'GLOBAL_EVENT_TRIGGERED',
          listener,
          originalEvent,
        });
      }
    };

    // Choose the right target
    const targets: Record<GlobalEventListener['target'], EventTarget> = {
      document: document,
      window: window,
      body: document.body,
    };

    // Add listeners to all potential targets for this event type
    for (const [targetName, target] of Object.entries(targets)) {
      if (this.isValidEventTarget(eventType, targetName as GlobalEventListener['target'])) {
        target.addEventListener(eventType, handler, {
          passive: ['touchstart', 'touchmove', 'scroll'].includes(eventType),
          capture: eventType === 'focus' || eventType === 'blur',
        });
      }
    }
  }

  private isValidEventTarget(eventType: string, target: string): boolean {
    const validCombinations = {
      resize: ['window'],
      scroll: ['window', 'document'],
      beforeunload: ['window'],
      keydown: ['document'],
      keyup: ['document'],
      click: ['document'],
      touchstart: ['document'],
      touchmove: ['document'],
      touchend: ['document'],
      focus: ['document'],
      blur: ['document'],
    };

    return (
      validCombinations[eventType as keyof typeof validCombinations]?.includes(target) || false
    );
  }

  private shouldSkipDueToPerformance(id: string, listener: GlobalEventListener): boolean {
    const now = performance.now();
    const config = this.actor.getSnapshot().context.performanceConfig;

    // Check debouncing
    if (listener.debounce && config.enableDebouncing) {
      const lastTime = this.debounceMap.get(id) || 0;
      if (now - lastTime < listener.debounce) return true;
      this.debounceMap.set(id, now);
    }

    // Check throttling
    if (listener.throttle && config.enableThrottling) {
      const lastTime = this.throttleMap.get(id) || 0;
      if (now - lastTime < listener.throttle) return true;
      this.throttleMap.set(id, now);
    }

    return false;
  }
}

// Helper function to generate unique IDs
export function generateEventListenerId(prefix: string, componentId?: string): string {
  return `${prefix}-${componentId || 'global'}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Export the singleton instance
export const globalEventDelegation = GlobalEventDelegation.getInstance();

// TypeScript module augmentation for global custom events
declare global {
  interface WindowEventMap {
    'global-action': CustomEvent<{
      action: string;
      componentId?: string;
      listenerId: string;
      originalEvent: Event;
    }>;
  }
}
