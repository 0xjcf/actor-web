/**
 * Minimal API for Creating Web Components with XState v5
 *
 * Research-backed design principles:
 * 1. Declarative over imperative (Research Article 1: "documented API approach")
 * 2. React-like patterns for adoption (Research Article 2: "familiar syntax")
 * 3. Automatic lifecycle management (eliminates manual wiring bugs)
 * 4. Type-safe throughout (avoids 'any' anti-patterns)
 * 5. SSR-ready architecture (template functions work server-side)
 * 6. Actor pattern integration (Controller layer for complex features)
 */

import {
  type Actor,
  type ActorOptions,
  type AnyMachineSnapshot,
  type AnyStateMachine,
  createActor,
  type SnapshotFrom,
  type Subscription,
} from 'xstate';
import { AriaObserver } from './aria-observer.js';
import { registerMachine } from './dev-mode.js';
import {
  type AccessibilityPreset,
  type EnhancedComponentConfig,
  EnhancedReactiveComponent,
} from './enhanced-component.js';
import { ReactiveEventBus } from './reactive-event-bus.js';
import type { RawCSS, TemplateFunction } from './template-renderer.js';

// Re-export development tools
export { enableDevMode, inspectTemplate } from './dev-mode.js';
// Re-export template functions for convenient usage
export { css, html } from './template-renderer.js';

/**
 * Type Safety for XState-Aligned Events
 * Runtime validation utilities for event attributes
 */

/**
 * Runtime template validation function
 *
 * Usage:
 * ```typescript
 * const template = validateTemplate(
 *   html`<button send="SAVE">Save</button>`,
 *   ['SAVE', 'CANCEL', 'RESET'] // Valid events for your machine
 * );
 * ```
 */
export function validateTemplate(
  templateResult: { html: string },
  validEvents: string[]
): {
  html: string;
  isValid: boolean;
  invalidEvents: string[];
} {
  const html = templateResult.html;

  // Extract event types from send attributes (works with any attribute name)
  const eventTypes =
    html
      .match(/(?:data-send|send)="([^"]+)"/g)
      ?.map((match) => match.replace(/(?:data-send|send)="/, '').replace('"', '')) || [];

  const invalidEvents = eventTypes.filter((event) => !validEvents.includes(event));

  return {
    html,
    isValid: invalidEvents.length === 0,
    invalidEvents,
  };
}

/**
 * ESLint Rule Configuration (for build-time validation)
 *
 * Add to your .eslintrc.js:
 * ```javascript
 * module.exports = {
 *   rules: {
 *     '@your-org/validate-xstate-events': ['error', {
 *       machineFiles: ['src/machines/*.ts'],
 *       templateFiles: ['src/components/*.ts']
 *     }]
 *   }
 * };
 * ```
 */

/**
 * Build-time Validation Utility
 * Run this in your build process to catch invalid events
 */
export interface EventValidationResult {
  file: string;
  line: number;
  column: number;
  eventType: string;
  machineId: string;
  valid: boolean;
  message: string;
}

export function validateEventAttributes(
  templateCode: string,
  machineEvents: string[],
  filePath: string
): EventValidationResult[] {
  const results: EventValidationResult[] = [];
  const lines = templateCode.split('\n');

  lines.forEach((line, lineIndex) => {
    const sendMatches = Array.from(line.matchAll(/data-send="([^"]+)"/g));

    for (const match of sendMatches) {
      const eventType = match[1];
      const column = match.index || 0;
      const valid = machineEvents.includes(eventType);

      results.push({
        file: filePath,
        line: lineIndex + 1,
        column: column + 1,
        eventType,
        machineId: 'detected', // Could be extracted from context
        valid,
        message: valid
          ? `✅ Event '${eventType}' is valid`
          : `❌ Event '${eventType}' not found in machine definition. Valid events: ${machineEvents.join(', ')}`,
      });
    }
  });

  return results;
}

/**
 * Event Handling Philosophy & Approaches
 *
 * Our framework uses Actor Model principles with smart DOM-to-Actor communication.
 *
 * ## 🎭 Actor Model Smart Extraction (Recommended)
 * Automatically gathers payload data from DOM elements - no manual JSON required!
 *
 * **🏆 Clean Syntax (Preferred):**
 * ```typescript
 * // ✨ CLEAN: No data- prefix needed! Flat event structure.
 * html`<button send="DELETE_ITEM" item-id=${item.id} item-name=${item.name}>Delete ${item.name}</button>`
 * // Becomes: send({ type: "DELETE_ITEM", itemId: "123", itemName: "John" })
 *
 * // ✨ CLEAN: Form data automatically extracted (flat structure)
 * html`<form send="SUBMIT_USER">
 *   <input name="email" value=${user.email} />
 *   <input name="role" value=${user.role} />
 *   <button type="submit">Save User</button>
 * </form>`
 * // Becomes: send({ type: "SUBMIT_USER", email: "john@example.com", role: "admin" })
 *
 * // ✨ CLEAN: Explicit payload when you want wrapped structure
 * html`<button send="COMPLEX_ACTION" payload='{"metadata": {"source": "web"}, "items": [1,2,3]}'>Complex</button>`
 * // Becomes: send({ type: "COMPLEX_ACTION", payload: { metadata: { source: "web" }, items: [1,2,3] } })
 * ```
 *
 * **🔄 Legacy Syntax (Backward Compatible):**
 * ```typescript
 * // Still works - flat structure unless explicit payload
 * html`<button data-send="DELETE_ITEM" data-item-id=${item.id}>Delete</button>`
 * // Becomes: send({ type: "DELETE_ITEM", itemId: "123" })
 *
 * // Explicit payload wrapping (legacy)
 * html`<button data-send="SAVE" data-send-payload='{"force": true}'>Save</button>`
 * // Becomes: send({ type: "SAVE", payload: { force: true } })
 * ```
 *
 * ## 🚀 Smart Extraction Rules (Priority Order)
 * 1. **Explicit Override**: `payload='{"custom": "data"}'` (for complex cases)
 * 2. **Form Data**: Automatically extracts all form fields
 * 3. **Custom Attributes**: All non-standard attributes become payload properties
 * 4. **Element State**: `value`, `checked`, etc. automatically included
 * 5. **Element Text**: Button/link text as fallback
 *
 * ## 🎯 Why Clean Attributes Are Better
 * - **Shorter**: `send="SAVE"` vs `data-send="SAVE"`
 * - **Cleaner**: `item-id="123"` vs `data-item-id="123"`
 * - **Framework-Specific**: Shows this is framework code, not generic HTML
 * - **Modern**: HTML5 allows custom attributes in frameworks
 * - **TypeScript-Friendly**: Better autocomplete and validation
 */

/**
 * Component Configuration - Enhanced with Actor pattern integration
 *
 * Type Safety Strategy:
 * - Developer API: Strongly typed to specific machine snapshot
 * - Internal API: Flexible to work with any snapshot while preserving type checking
 */
export interface ComponentConfig<TMachine extends AnyStateMachine = AnyStateMachine> {
  /** State machine definition - the "business logic" */
  machine: TMachine;

  /** Template function - the "presentation logic" using html`` tagged template
   * Developer gets full type safety for their specific machine's snapshot type */
  template: TemplateFunction<SnapshotFrom<TMachine>>;

  /** Optional: Custom tag name (defaults to kebab-case of machine id) */
  tagName?: string;

  /** Optional: Custom styles injected into shadow DOM - now supports css`` directly! */
  styles?: string | RawCSS;

  /** Optional: Custom event mappings (auto-inferred from data-action by default) */
  eventMappings?: Record<string, string>;

  /** Optional: Lifecycle hooks for advanced usage */
  onConnected?: () => void;
  onDisconnected?: () => void;

  /** Optional: Actor options for XState configuration */
  actorOptions?: ActorOptions<TMachine>;

  /** Optional: Enable shadow DOM encapsulation */
  useShadowDOM?: boolean;

  /** Optional: Accessibility features configuration */
  accessibility?: {
    /** Enable accessibility features (default: true) */
    enabled?: boolean;
    /** Accessibility preset for common patterns */
    preset?: 'button' | 'form' | 'list' | 'modal' | 'menu' | 'tabs' | 'grid' | 'alert' | 'status';
    /** Custom ARIA configuration */
    aria?: {
      /** Automatic ARIA attribute management (default: true) */
      enabled?: boolean;
      /** Custom ARIA mappings */
      mappings?: Record<string, string>;
    };
    /** Screen reader announcements configuration */
    screenReader?: {
      /** Enable screen reader announcements (default: true) */
      enabled?: boolean;
      /** Announcement style */
      style?: 'minimal' | 'standard' | 'verbose';
    };
  };

  /** Optional: Keyboard navigation configuration */
  keyboard?: {
    /** Enable keyboard navigation (default: true) */
    enabled?: boolean;
    /** Keyboard navigation preset */
    preset?: 'none' | 'menu' | 'listbox' | 'tabs' | 'grid' | 'modal';
    /** Custom keyboard mappings */
    mappings?: Record<string, string>;
    /** Focus management configuration */
    focus?: {
      /** Enable focus management (default: true) */
      enabled?: boolean;
      /** Focus trap for modal-like components */
      trap?: boolean;
      /** Focus restoration after interactions */
      restore?: boolean;
    };
  };

  /** Optional: Touch gesture configuration */
  gestures?: {
    /** Enable touch gestures (default: false) */
    enabled?: boolean;
    /** Gesture presets */
    preset?: 'none' | 'swipe' | 'drag' | 'pinch' | 'all';
    /** Custom gesture mappings */
    mappings?: Record<string, string>;
  };

  /** Optional: Mobile navigation configuration */
  mobile?: {
    /** Enable mobile navigation features (default: false) */
    enabled?: boolean;
    /** Mobile navigation type */
    navigation?: {
      /** Navigation type */
      type?: 'drawer' | 'bottom-sheet' | 'tabs' | 'stack' | 'modal';
      /** Enable touch gestures for navigation */
      gestures?: {
        /** Enable swipe gestures */
        swipe?: boolean;
        /** Enable pinch gestures */
        pinch?: boolean;
        /** Enable drag gestures */
        drag?: boolean;
      };
      /** Focus management for mobile */
      focus?: {
        /** Trap focus within navigation */
        trap?: boolean;
        /** Restore focus after navigation */
        restore?: boolean;
      };
    };
    /** Responsive breakpoints */
    responsive?: {
      /** Breakpoint definitions */
      breakpoints?: {
        /** Mobile breakpoint (default: 768px) */
        mobile?: number;
        /** Tablet breakpoint (default: 1024px) */
        tablet?: number;
      };
      /** Enable adaptive layout */
      adaptiveLayout?: boolean;
    };
  };

  /** Optional: Actor pattern integration options - Enhanced API */
  integration?: {
    /** Use ReactiveEventBus for declarative event handling (default: true) */
    useEventBus?: boolean;
    /** Use AriaObserver for automatic ARIA updates (default: true) */
    useAriaObserver?: boolean;
    /** Use Controller pattern for complex components (default: false for backward compatibility) */
    useController?: boolean;
    /** Component ID for event bus registration (auto-generated if not provided) */
    componentId?: string;
  };

  /**
   * Explicitly disable all framework integrations.
   * This is useful for components that are purely functional or
   * for which the framework's overhead is undesirable.
   */
  minimal?: boolean;
}

/**
 * Internal Controller for Actor Pattern Integration
 * Bridges the component with the framework's reactive infrastructure
 */
class ReactiveComponentController {
  private actor: Actor<AnyStateMachine>;
  private component: ReactiveComponent;
  private config: ComponentConfig<AnyStateMachine>;
  private eventBus: ReactiveEventBus | null = null;
  private ariaObserver: AriaObserver | null = null;
  private subscription: Subscription | null = null;
  private componentId: string;

  constructor(component: ReactiveComponent, config: ComponentConfig<AnyStateMachine>) {
    this.component = component;
    this.config = config;
    this.componentId = config.integration?.componentId || this.generateComponentId();

    // Initialize framework integrations
    this.initializeIntegrations();

    // Create actor
    this.actor = createActor(config.machine, config.actorOptions);

    // Setup reactive subscriptions
    this.setupSubscriptions();
  }

  private generateComponentId(): string {
    return `${this.config.machine.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private initializeIntegrations(): void {
    const integration = this.config.integration || {};

    // Set component ID for framework integrations
    this.component.setAttribute('data-component-id', this.componentId);

    // Initialize ReactiveEventBus if enabled
    if (integration.useEventBus !== false) {
      this.eventBus = ReactiveEventBus.getInstance();
    }

    // Initialize AriaObserver if enabled
    if (integration.useAriaObserver !== false) {
      this.ariaObserver = new AriaObserver();
      this.ariaObserver.observe(this.component);
    }
  }

  private setupSubscriptions(): void {
    this.subscription = this.actor.subscribe((state) => {
      // Update data-state attribute for CSS styling
      this.component.setAttribute('data-state', String(state.value));

      // Trigger component render
      this.component.renderWithState(state);

      // Setup event bindings after render
      this.setupEventBindings();
    });
  }

  private setupEventBindings(): void {
    if (!this.eventBus) {
      // Fallback to legacy event binding
      this.component.setupLegacyEventListeners();
      return;
    }

    // Use ReactiveEventBus for declarative event handling
    if (this.config.eventMappings) {
      this.eventBus.bindEvents(this.componentId, this.config.eventMappings);
    } else {
      // Auto-infer from data-action attributes
      this.inferAndBindEvents();
    }
  }

  private inferAndBindEvents(): void {
    if (!this.eventBus) {
      return;
    }

    // Look for both clean and legacy event attributes
    const cleanSendElements = this.component.querySelectorAll('[send]');
    const legacySendElements = this.component.querySelectorAll('[data-send]');
    const eventElements = this.component.querySelectorAll('[data-event]');
    const mappings: Record<string, string> = {};

    // Process clean send attributes (preferred syntax)
    for (const el of Array.from(cleanSendElements)) {
      const eventType = el.getAttribute('send');
      if (eventType) {
        const extractedData = this.extractSendContext(el);
        const htmlEventType = el.tagName === 'FORM' ? 'submit' : 'click';

        // Check if explicit payload attribute was used
        const hasExplicitPayload = el.hasAttribute('payload');

        let eventData: Record<string, unknown>;
        if (hasExplicitPayload) {
          // Explicit payload attribute - wrap in payload
          eventData = { type: eventType, payload: extractedData };
        } else if (Object.keys(extractedData).length > 0) {
          // Custom attributes - flatten into event
          eventData = { type: eventType, ...extractedData };
        } else {
          // No data - simple event
          eventData = { type: eventType };
        }

        mappings[`${htmlEventType} [send="${eventType}"]`] = JSON.stringify(eventData);
      }
    }

    // Process legacy data-send attributes (backward compatibility)
    for (const el of Array.from(legacySendElements)) {
      const eventType = el.getAttribute('data-send');
      if (eventType) {
        const extractedData = this.extractSendContext(el);
        const htmlEventType = el.tagName === 'FORM' ? 'submit' : 'click';

        // Check if explicit payload attribute was used
        const hasExplicitPayload = el.hasAttribute('data-send-payload');

        let eventData: Record<string, unknown>;
        if (hasExplicitPayload) {
          // Explicit payload attribute - wrap in payload
          eventData = { type: eventType, payload: extractedData };
        } else if (Object.keys(extractedData).length > 0) {
          // Custom attributes - flatten into event
          eventData = { type: eventType, ...extractedData };
        } else {
          // No data - simple event
          eventData = { type: eventType };
        }

        mappings[`${htmlEventType} [data-send="${eventType}"]`] = JSON.stringify(eventData);
      }
    }

    // Process data-event attributes (alternative syntax)
    for (const el of Array.from(eventElements)) {
      const eventType = el.getAttribute('data-event');
      if (eventType) {
        const contextData = this.extractEventContext(el);
        const htmlEventType = el.tagName === 'FORM' ? 'submit' : 'click';

        mappings[`${htmlEventType} [data-event="${eventType}"]`] = JSON.stringify({
          type: eventType,
          ...contextData,
        });
      }
    }

    if (Object.keys(mappings).length > 0) {
      this.eventBus.bindEvents(this.componentId, mappings);
    }
  }

  /**
   * Smart payload extraction from DOM element (Actor Model approach)
   * Supports both clean syntax and legacy data- attributes
   *
   * Extraction priorities:
   * 1. payload='...' or data-send-payload='...' (explicit JSON override)
   * 2. Form data (for form elements)
   * 3. Custom attributes (non-standard HTML attributes)
   * 4. data-* attributes (legacy support)
   * 5. Element value/checked state
   * 6. Element text content
   */
  private extractSendContext(element: Element): Record<string, unknown> {
    // ✅ SECURITY: Use prototype-free object to prevent pollution
    const payload = Object.create(null) as Record<string, unknown>;

    // Priority 1: Explicit JSON payload (clean or legacy syntax)
    const explicitPayload =
      element.getAttribute('payload') || element.getAttribute('data-send-payload');
    if (explicitPayload) {
      try {
        const parsed = JSON.parse(explicitPayload);
        // ✅ SECURITY: Validate parsed JSON structure
        if (this.isValidPayloadObject(parsed)) {
          return parsed;
        }
        return payload;
      } catch (_error) {
        return payload;
      }
    }

    // Priority 2: Form data extraction (automatic) with security validation
    if (element.tagName === 'FORM') {
      const formData = new FormData(element as HTMLFormElement);
      formData.forEach((value, key) => {
        // ✅ SECURITY: Validate field names to prevent prototype pollution
        if (this.isValidFieldName(key)) {
          payload[key] = this.sanitizeFieldValue(value);
        } else {
        }
      });
      return payload;
    }

    // Standard HTML attributes to ignore (not part of payload)
    const standardAttributes = new Set([
      'id',
      'class',
      'style',
      'title',
      'lang',
      'dir',
      'tabindex',
      'hidden',
      'draggable',
      'contenteditable',
      'spellcheck',
      'send',
      'payload',
      'data-send',
      'data-send-payload',
      'href',
      'src',
      'alt',
      'type',
      'name',
      'value',
      'checked',
      'disabled',
      'readonly',
      'required',
      'placeholder',
      'maxlength',
      'min',
      'max',
      'step',
      'pattern',
      'autocomplete',
      'autofocus',
    ]);

    // Priority 3: Custom attributes (clean syntax) and data-* attributes (legacy)
    for (const attr of Array.from(element.attributes)) {
      const attrName = attr.name.toLowerCase();

      // Skip standard HTML attributes
      if (standardAttributes.has(attrName)) {
        continue;
      }

      let key: string;
      if (attrName.startsWith('data-')) {
        // Legacy data-* attributes (skip data-send and data-send-payload)
        if (attrName === 'data-send' || attrName === 'data-send-payload') {
          continue;
        }
        // Convert data-item-id → itemId (same as clean attributes)
        key = attrName
          .replace('data-', '')
          .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      } else {
        // Clean custom attributes (convert kebab-case to camelCase)
        key = attrName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      }

      payload[key] = attr.value;
    }

    // Priority 4: Element value/state
    const htmlElement = element as HTMLElement;
    if ('value' in htmlElement && htmlElement.value && !payload.value) {
      payload.value = htmlElement.value;
    }
    if ('checked' in htmlElement && !('checked' in payload)) {
      payload.checked = (htmlElement as HTMLInputElement).checked;
    }

    // Priority 5: Element text content (for buttons/links without other data)
    if (Object.keys(payload).length === 0 && element.textContent?.trim()) {
      payload.text = element.textContent.trim();
    }

    return payload;
  }

  /**
   * Security validation methods
   */
  private isValidPayloadObject(obj: unknown): obj is Record<string, unknown> {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return false;
    }

    // ✅ SECURITY: Check for prototype pollution attempts (only own properties, not inherited)
    const dangerousKeys = ['__proto__', 'constructor', 'prototype', 'valueOf', 'toString'];
    // Use safer approach that avoids prototype builtin access
    return !dangerousKeys.some(
      (key) => key in obj && Object.getOwnPropertyDescriptor(obj, key) !== undefined
    );
  }

  private isValidFieldName(name: string): boolean {
    // Reject prototype pollution attempts and validate format
    const dangerous = ['__proto__', 'constructor', 'prototype', 'valueOf', 'toString'];
    return !dangerous.includes(name) && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
  }

  private sanitizeFieldValue(value: FormDataEntryValue): string {
    // Convert FormDataEntryValue to string and escape HTML
    const stringValue = typeof value === 'string' ? value : value.name || '';
    return this.escapeHtml(stringValue);
  }

  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Extract context data from data-event-* attributes
   * Example: data-event-to="/home" data-event-replace="true" → { to: "/home", replace: "true" }
   */
  private extractEventContext(element: Element): Record<string, string> {
    const context: Record<string, string> = {};

    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith('data-event-') && attr.name !== 'data-event') {
        const contextKey = attr.name.replace('data-event-', '');
        context[contextKey] = attr.value;
      }
    }

    return context;
  }

  public start(): void {
    this.actor.start();

    // Trigger initial render
    const initialState = this.actor.getSnapshot();
    this.component.setAttribute('data-state', String(initialState.value));
    this.component.renderWithState(initialState);
    this.setupEventBindings();
  }

  public stop(): void {
    this.subscription?.unsubscribe();
    this.actor?.stop();

    if (this.eventBus) {
      this.eventBus.unbindEvents(this.componentId);
    }

    this.ariaObserver?.disconnect();
  }

  public getActor(): Actor<AnyStateMachine> {
    return this.actor;
  }

  public getCurrentState(): AnyMachineSnapshot {
    return this.actor.getSnapshot();
  }

  public send(event: Parameters<typeof this.actor.send>[0]): void {
    this.actor.send(event);
  }

  /**
   * Receive events from ReactiveEventBus
   * Called by the event bus when declarative events are triggered
   */
  public receiveEvent(eventData: Record<string, unknown>): void {
    // Forward to the actor - preserve all event data including payload
    this.actor.send(eventData as Parameters<typeof this.actor.send>[0]);
  }
}

/**
 * Internal component class that implements the research-recommended patterns:
 * - Automatic lifecycle management
 * - Declarative event binding via Controller (when enabled)
 * - Template-based rendering
 * - Type-safe throughout
 * - Actor pattern integration (optional)
 *
 * Uses type-safe template wrapper to eliminate casting while preserving developer type safety
 */
class ReactiveComponent extends HTMLElement {
  private config: ComponentConfig<AnyStateMachine>;
  private controller!: ReactiveComponentController; // Always present now!
  private isComponentConnected = false;
  private internalTemplate: (state: AnyMachineSnapshot) => string;

  constructor(config: ComponentConfig<AnyStateMachine>) {
    super();
    this.config = config;

    // Create type-safe wrapper that preserves developer typing while enabling internal flexibility
    this.internalTemplate = (state: AnyMachineSnapshot) => {
      // The developer's template is strongly typed, but we safely call it with any snapshot
      // This is safe because AnyMachineSnapshot is compatible with specific machine snapshots
      const result = (
        this.config.template as unknown as (state: AnyMachineSnapshot) => { html: string }
      )(state);
      return result.html;
    };

    // Research Article 2: SSR support through shadow DOM - attach early
    if (config.useShadowDOM) {
      this.attachShadow({ mode: 'open' });
    }
  }

  connectedCallback(): void {
    if (this.isComponentConnected) {
      return;
    }

    this.isComponentConnected = true;

    // Always use controller integration - this is the whole point of the framework!
    this.initializeWithController();

    this.config.onConnected?.();
  }

  disconnectedCallback(): void {
    if (!this.isComponentConnected) {
      return;
    }

    this.isComponentConnected = false;
    this.cleanup();
    this.config.onDisconnected?.();
  }

  private initializeWithController(): void {
    // Use Actor pattern with Controller layer
    this.controller = new ReactiveComponentController(this, this.config);

    // Expose controller for ReactiveEventBus integration
    (this as unknown as { controller: ReactiveComponentController }).controller = this.controller;

    this.controller.start();
  }

  private initializeLegacy(): void {
    // Maintain backward compatibility with direct actor usage
    this.initializeActor();
    this.setupEventListeners();
  }

  private initializeActor(): void {}

  private setupEventListeners(): void {
    // Legacy event binding - kept for backward compatibility
    this.setupLegacyEventListeners();
  }

  public setupLegacyEventListeners(): void {
    // Research Article 1: "Declarative event binding"
    if (this.config.eventMappings) {
      // Use explicit event mappings
      for (const [selector, eventType] of Object.entries(this.config.eventMappings)) {
        this.bindEvent(selector, eventType);
      }
    } else {
      // Auto-infer from data-action attributes
      this.inferAndBindEvents();
    }
  }

  private inferAndBindEvents(): void {
    // Research Article 2: "Automatic conversion logic"
    // Support both legacy data-action and new XState-aligned data-send attributes

    // Legacy data-action support (backward compatibility)
    const actionElements = this.querySelectorAll('[data-action]');
    for (const el of Array.from(actionElements)) {
      const action = el.getAttribute('data-action');
      if (action) {
        // Default to click events for buttons, submit for forms
        const eventType = el.tagName === 'FORM' ? 'submit' : 'click';
        this.bindEvent(`${eventType} [data-action="${action}"]`, action);
      }
    }

    // New XState-aligned data-send support
    const sendElements = this.querySelectorAll('[data-send]');
    for (const el of Array.from(sendElements)) {
      const eventType = el.getAttribute('data-send');
      if (eventType) {
        // Extract context data from data-send-* attributes
        const contextData = this.extractSendContextForLegacy(el);
        const htmlEventType = el.tagName === 'FORM' ? 'submit' : 'click';

        // Bind event with context data
        this.bindEventWithContext(
          `${htmlEventType} [data-send="${eventType}"]`,
          eventType,
          contextData
        );
      }
    }
  }

  /**
   * Extract context data from data-send-payload for legacy components (simplified)
   */
  private extractSendContextForLegacy(element: Element): Record<string, unknown> {
    // Only look for data-send-payload (matches XState send() exactly)
    const payload = element.getAttribute('data-send-payload');
    if (!payload) {
      return {};
    }

    try {
      return JSON.parse(payload);
    } catch (_error) {
      return {};
    }
  }

  /**
   * Bind events with payload data for XState-aligned attributes (legacy version)
   */
  private bindEventWithContext(
    selector: string,
    eventType: string,
    extractedData: Record<string, unknown>
  ): void {
    const [event, targetSelector] = selector.split(' ', 2);

    const handler = (e: Event) => {
      if (targetSelector) {
        const target = e.target as Element;
        if (!target.matches(targetSelector)) {
          return;
        }
      }

      if (event === 'submit') {
        e.preventDefault();
      }

      // Check if this came from an explicit payload attribute
      const element = e.target as Element;
      const hasExplicitPayload =
        element.hasAttribute('payload') || element.hasAttribute('data-send-payload');

      // Create event with consistent structure
      let xstateEvent: Record<string, unknown>;
      if (hasExplicitPayload) {
        // Explicit payload attribute - wrap in payload
        xstateEvent = { type: eventType, payload: extractedData };
      } else if (Object.keys(extractedData).length > 0) {
        // Custom attributes - flatten into event
        xstateEvent = { type: eventType, ...extractedData };
      } else {
        // No data - simple event
        xstateEvent = { type: eventType };
      }

      this.controller.send(xstateEvent);
    };

    this.addEventListener(event, handler);
  }

  private bindEvent(selector: string, eventType: string): void {
    // Research: Type-safe event binding without any casts
    const [event, targetSelector] = selector.split(' ', 2);

    const handler = (e: Event) => {
      // Research Article 1: Event delegation pattern
      if (targetSelector) {
        const target = e.target as Element;
        if (!target.matches(targetSelector)) {
          return;
        }
      }

      // Research: Prevent default for forms automatically
      if (event === 'submit') {
        e.preventDefault();
      }

      // Send event to controller (always available now)
      this.controller.send({ type: eventType });
    };

    this.addEventListener(event, handler);
  }

  private render(state: AnyMachineSnapshot): void {
    // Research Article 1: "data-state attribute updates automatically"
    // Safe value access - all machine snapshots have a value property
    this.setAttribute('data-state', String(state.value));

    this.renderWithState(state);
  }

  public renderWithState(state: AnyMachineSnapshot): void {
    // Template-based rendering with type-safe wrapper
    const generatedHtml = this.internalTemplate(state);

    // Support both shadow DOM and light DOM
    const target = this.config.useShadowDOM && this.shadowRoot ? this.shadowRoot : this;

    // Inject styles if provided
    const styleTag = this.config.styles ? `<style>${this.config.styles}</style>` : '';

    target.innerHTML = styleTag + generatedHtml;

    // Controller handles event setup automatically - no legacy path needed!
  }

  private cleanup(): void {
    // Framework handles lifecycle automatically
    this.controller.stop();
  }

  // Public API for programmatic control
  public getActor(): Actor<AnyStateMachine> {
    return this.controller.getActor();
  }

  public getCurrentState(): AnyMachineSnapshot {
    return this.controller.getCurrentState();
  }

  public send(event: Record<string, unknown>): void {
    this.controller.send(event);
  }
}

/**
 * ✨ Minimal API - Just provide machine + template, everything else is automatic!
 *
 * Philosophy: Accessibility and declarative patterns should be the default.
 * Clean `send` syntax, automatic ARIA updates, and reactive event handling
 * are enabled by default for the best developer and user experience.
 */
export function createComponent<TMachine extends AnyStateMachine>(
  config: ComponentConfig<TMachine>
) {
  // Auto-generate tag name from machine id
  const tagName = config.tagName || `${config.machine.id}-component`;

  // Check if enhanced features are requested
  const needsEnhancedFeatures = Boolean(
    (config.accessibility?.enabled !== false &&
      (config.accessibility?.preset ||
        config.accessibility?.aria?.enabled !== false ||
        config.accessibility?.screenReader?.enabled !== false)) ||
      (config.keyboard?.enabled !== false &&
        ((config.keyboard?.preset && config.keyboard.preset !== 'none') ||
          config.keyboard?.mappings ||
          config.keyboard?.focus?.enabled !== false)) ||
      config.gestures?.enabled === true ||
      (config.mobile?.enabled === true &&
        (config.mobile?.navigation?.type ||
          config.mobile?.navigation?.gestures?.swipe ||
          config.mobile?.navigation?.gestures?.pinch ||
          config.mobile?.navigation?.gestures?.drag ||
          config.mobile?.responsive?.adaptiveLayout))
  );

  // Register machine for development-time validation
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    registerMachine(config.machine);
  }

  let ComponentClass: unknown;

  if (needsEnhancedFeatures) {
    // Create enhanced component with accessibility features
    const enhancedConfig: EnhancedComponentConfig<TMachine> = {
      machine: config.machine,
      // Template adapter - enhanced templates include accessibility helpers
      template: (state) => {
        const basicResult = config.template(state);
        return typeof basicResult === 'string' ? basicResult : basicResult.html;
      },
      tagName: config.tagName,
      // Convert RawCSS to string if needed
      styles:
        typeof config.styles === 'string'
          ? config.styles
          : config.styles
            ? String(config.styles)
            : undefined,
      accessibility: {
        presets: config.accessibility?.preset as AccessibilityPreset | undefined,
        autoInit: config.accessibility?.enabled !== false,
        // Only set aria if it matches known types, otherwise use default
        aria: config.accessibility?.aria?.enabled !== false ? 'button' : undefined,
        // Use safe default for focus management
        focus: config.keyboard?.focus?.enabled !== false ? 'menu' : undefined,
        // Use safe default for keyboard navigation
        keyboard: config.keyboard?.enabled !== false ? 'menu' : undefined,
        // Use safe default for screen reader
        screenReader:
          config.accessibility?.screenReader?.enabled !== false ? 'standard' : undefined,
      },
      mobile:
        config.mobile?.enabled === true
          ? {
              navigation: config.mobile.navigation?.type || 'drawer',
              gestures: {
                swipe: config.mobile.navigation?.gestures?.swipe ?? true,
                pinch: config.mobile.navigation?.gestures?.pinch ?? false,
                drag: config.mobile.navigation?.gestures?.drag ?? false,
              },
              responsive: {
                breakpoints: {
                  mobile: config.mobile.responsive?.breakpoints?.mobile ?? 768,
                  tablet: config.mobile.responsive?.breakpoints?.tablet ?? 1024,
                },
                adaptiveLayout: config.mobile.responsive?.adaptiveLayout ?? true,
              },
            }
          : undefined,
    };

    class EnhancedAutoComponent extends EnhancedReactiveComponent<TMachine> {
      constructor(configOverrides?: Record<string, unknown>) {
        // For enhanced components, use the original config with simple property override
        let mergedConfig = enhancedConfig;

        if (configOverrides && Object.keys(configOverrides).length > 0) {
          // Simple property merge for common overrides like styles, tagName, etc.
          mergedConfig = {
            ...enhancedConfig,
            ...(configOverrides as Partial<EnhancedComponentConfig<TMachine>>),
          };
        }

        super(mergedConfig);
      }
    }

    ComponentClass = EnhancedAutoComponent;
  } else {
    // Create regular component with basic integration
    const basicConfig: ComponentConfig<TMachine> = {
      ...config,
      integration: {
        useController: true, // ✅ Controller for clean syntax
        useEventBus: true, // ✅ ReactiveEventBus for declarative events
        useAriaObserver: true, // ✅ AriaObserver for accessibility
      },
    };

    class BasicAutoComponent extends ReactiveComponent {
      constructor(configOverrides?: Record<string, unknown>) {
        // Merge original config with any overrides
        let mergedConfig = basicConfig;

        if (configOverrides && Object.keys(configOverrides).length > 0) {
          mergedConfig = {
            ...basicConfig,
            ...(configOverrides as Partial<ComponentConfig<TMachine>>),
          };
        }

        super(mergedConfig as ComponentConfig<AnyStateMachine>);
      }
    }

    ComponentClass = BasicAutoComponent;
  }

  // Auto-register component
  if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
    if (!customElements.get(tagName)) {
      customElements.define(tagName, ComponentClass as CustomElementConstructor);
    }
  }

  return ComponentClass as new (
    configOverrides?: Record<string, unknown>
  ) => ReactiveComponent;
}

// 🎯 API simplified! Only one way to create components - with full integration by default.

/**
 * Research Article 2: "React Hooks Compatibility Layer"
 * Provides familiar patterns for React developers
 */
export function useStateMachine<TMachine extends AnyStateMachine>(
  machine: TMachine,
  options?: ActorOptions<TMachine>
) {
  const actor = createActor(machine, options);

  return {
    actor,
    state: actor.getSnapshot(),
    send: actor.send.bind(actor),
    start: actor.start.bind(actor),
    stop: actor.stop.bind(actor),
  };
}

/**
 * Research Article 2: "SSR Support with Declarative Shadow DOM"
 * Now without type casting - uses the same approach as the component
 */
export function renderToString<TMachine extends AnyStateMachine>(
  config: ComponentConfig<TMachine>,
  initialState?: AnyMachineSnapshot
): string {
  // For SSR: render template with initial state
  const actor = createActor(config.machine);
  const state = initialState || actor.getSnapshot();

  const tagName = config.tagName || `${config.machine.id}-component`;

  // Use the same type-safe wrapper pattern as the component
  const safeTemplate = config.template as unknown as (state: AnyMachineSnapshot) => {
    html: string;
  };
  const html = safeTemplate(state).html;
  const styles = config.styles ? `<style>${config.styles}</style>` : '';

  if (config.useShadowDOM) {
    return `
      <${tagName}>
        <template shadowrootmode="open">
          ${styles}${html}
        </template>
      </${tagName}>
    `;
  }

  // Safe value access - all snapshots have value property
  return `<${tagName} data-state="${String(state.value)}">${styles}${html}</${tagName}>`;
}

/**
 * Testing Utility - Creates component instance that works in jsdom/happy-dom
 *
 * This bypasses the HTMLElement constructor limitation in test environments
 * while preserving the exact same API for production use.
 */
export function createTestableComponent<TMachine extends AnyStateMachine>(
  config: ComponentConfig<TMachine>
): ReactiveComponent {
  // Create a real HTMLElement for better compatibility with happy-dom
  const element = document.createElement('div') as unknown as ReactiveComponent;

  // Manually add ReactiveComponent properties (cast to any to access private members)
  (element as unknown as { config: ComponentConfig<AnyStateMachine> }).config = config;
  (element as unknown as { isComponentConnected: boolean }).isComponentConnected = false;

  // Create the internal template wrapper
  (
    element as unknown as { internalTemplate: (state: AnyMachineSnapshot) => string }
  ).internalTemplate = (state: AnyMachineSnapshot) => {
    const result = (config.template as unknown as (state: AnyMachineSnapshot) => { html: string })(
      state
    );
    return result.html;
  };

  // Add ReactiveComponent methods by copying from prototype
  element.connectedCallback = ReactiveComponent.prototype.connectedCallback.bind(element);
  element.disconnectedCallback = ReactiveComponent.prototype.disconnectedCallback.bind(element);

  // Add private methods (TypeScript won't allow access, but they exist at runtime)
  (element as unknown as { initializeLegacy: () => void }).initializeLegacy = (
    ReactiveComponent.prototype as unknown as { initializeLegacy: () => void }
  ).initializeLegacy.bind(element);
  (element as unknown as { initializeWithController: () => void }).initializeWithController = (
    ReactiveComponent.prototype as unknown as { initializeWithController: () => void }
  ).initializeWithController.bind(element);
  (element as unknown as { initializeActor: () => void }).initializeActor = (
    ReactiveComponent.prototype as unknown as { initializeActor: () => void }
  ).initializeActor.bind(element);
  (element as unknown as { setupEventListeners: () => void }).setupEventListeners = (
    ReactiveComponent.prototype as unknown as { setupEventListeners: () => void }
  ).setupEventListeners.bind(element);
  (element as unknown as { setupLegacyEventListeners: () => void }).setupLegacyEventListeners = (
    ReactiveComponent.prototype as unknown as { setupLegacyEventListeners: () => void }
  ).setupLegacyEventListeners.bind(element);
  (element as unknown as { inferAndBindEvents: () => void }).inferAndBindEvents = (
    ReactiveComponent.prototype as unknown as { inferAndBindEvents: () => void }
  ).inferAndBindEvents.bind(element);
  (element as unknown as { bindEvent: (selector: string, eventType: string) => void }).bindEvent = (
    ReactiveComponent.prototype as unknown as {
      bindEvent: (selector: string, eventType: string) => void;
    }
  ).bindEvent.bind(element);
  (
    element as unknown as {
      bindEventWithContext: (
        selector: string,
        eventType: string,
        extractedData: Record<string, unknown>
      ) => void;
    }
  ).bindEventWithContext = (
    ReactiveComponent.prototype as unknown as {
      bindEventWithContext: (
        selector: string,
        eventType: string,
        extractedData: Record<string, unknown>
      ) => void;
    }
  ).bindEventWithContext.bind(element);
  (
    element as unknown as {
      extractSendContextForLegacy: (element: Element) => Record<string, unknown>;
    }
  ).extractSendContextForLegacy = (
    ReactiveComponent.prototype as unknown as {
      extractSendContextForLegacy: (element: Element) => Record<string, unknown>;
    }
  ).extractSendContextForLegacy.bind(element);

  // Add methods from ReactiveComponentController for enhanced components
  (
    element as unknown as { extractSendContext: (element: Element) => Record<string, unknown> }
  ).extractSendContext = (
    ReactiveComponentController.prototype as unknown as {
      extractSendContext: (element: Element) => Record<string, unknown>;
    }
  ).extractSendContext.bind(element);
  (
    element as unknown as { extractEventContext: (element: Element) => Record<string, string> }
  ).extractEventContext = (
    ReactiveComponentController.prototype as unknown as {
      extractEventContext: (element: Element) => Record<string, string>;
    }
  ).extractEventContext.bind(element);

  (element as unknown as { render: (state: AnyMachineSnapshot) => void }).render = (
    ReactiveComponent.prototype as unknown as { render: (state: AnyMachineSnapshot) => void }
  ).render.bind(element);
  (element as unknown as { renderWithState: (state: AnyMachineSnapshot) => void }).renderWithState =
    (
      ReactiveComponent.prototype as unknown as {
        renderWithState: (state: AnyMachineSnapshot) => void;
      }
    ).renderWithState.bind(element);
  (element as unknown as { cleanup: () => void }).cleanup = (
    ReactiveComponent.prototype as unknown as { cleanup: () => void }
  ).cleanup.bind(element);

  // Add public methods
  element.getActor = ReactiveComponent.prototype.getActor.bind(element);
  element.getCurrentState = ReactiveComponent.prototype.getCurrentState.bind(element);
  element.send = ReactiveComponent.prototype.send.bind(element);

  return element;
}
