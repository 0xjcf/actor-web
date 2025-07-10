/**
 * Framework-Integrated ARIA Management System
 * Automatically manages ARIA attributes based on state changes and component configuration
 */

import type { AnyStateMachine, SnapshotFrom } from 'xstate';
import {
  type AnnouncementConfig,
  type AriaAttributes,
  isValidAriaAttribute,
  kebabCase,
} from './accessibility-utilities.js';

/**
 * ARIA Configuration for Components
 * Declarative ARIA configuration that integrates with the framework
 */

export interface AriaConfig {
  // Static ARIA attributes
  role?: string;
  label?: string;
  description?: string;

  // Dynamic ARIA attributes based on state
  stateMapping?: {
    [stateName: string]: Partial<AriaAttributes>;
  };

  // Context-based ARIA attributes
  contextMapping?: {
    [contextKey: string]: (value: unknown) => Partial<AriaAttributes>;
  };

  // Automatic announcements
  announcements?: {
    [stateName: string]: AnnouncementConfig;
  };

  // Live region configuration
  liveRegion?: {
    politeness?: 'polite' | 'assertive';
    atomic?: boolean;
    relevant?: string;
  };

  // Keyboard navigation configuration
  keyboardNavigation?: {
    orientation?: 'horizontal' | 'vertical' | 'both';
    activateOnFocus?: boolean;
    wrap?: boolean;
    roving?: boolean;
  };

  // Focus management
  focusManagement?: {
    trap?: boolean;
    restoreOnExit?: boolean;
    initialFocus?: string; // selector or 'first' | 'last'
  };
}

/**
 * ARIA State Manager
 * Manages ARIA attributes reactively based on state changes
 */

export class AriaStateManager {
  private componentElement: HTMLElement;
  private ariaConfig: AriaConfig;
  private currentState: SnapshotFrom<AnyStateMachine>;
  private managedAttributes: Set<string> = new Set();
  private announcements: Map<string, number> = new Map();
  private liveRegionElement: HTMLElement | null = null;

  constructor(
    componentElement: HTMLElement,
    ariaConfig: AriaConfig,
    initialState: SnapshotFrom<AnyStateMachine>
  ) {
    this.componentElement = componentElement;
    this.ariaConfig = ariaConfig;
    this.currentState = initialState;

    this.initializeStaticAttributes();
    this.initializeLiveRegion();
    this.updateAriaAttributes();
  }

  /**
   * Update ARIA attributes based on new state
   */
  updateState(newState: SnapshotFrom<AnyStateMachine>): void {
    const previousState = this.currentState;
    this.currentState = newState;

    this.updateAriaAttributes();
    this.handleStateAnnouncements(previousState, newState);
  }

  /**
   * Get ARIA attributes as template string
   * For use in templates without DOM manipulation
   */
  getAriaAttributeString(): string {
    const attributes: AriaAttributes = {};

    // Apply static configuration
    if (this.ariaConfig.role) attributes.role = this.ariaConfig.role;
    if (this.ariaConfig.label) attributes.label = this.ariaConfig.label;

    // Apply state-based attributes
    if (this.ariaConfig.stateMapping) {
      for (const [stateName, attrs] of Object.entries(this.ariaConfig.stateMapping)) {
        if (this.currentState.matches(stateName)) {
          Object.assign(attributes, attrs);
        }
      }
    }

    // Apply context-based attributes
    if (this.ariaConfig.contextMapping) {
      for (const [contextKey, mapper] of Object.entries(this.ariaConfig.contextMapping)) {
        const value = this.currentState.context[contextKey];
        if (value !== undefined) {
          const contextAttrs = mapper(value);
          Object.assign(attributes, contextAttrs);
        }
      }
    }

    // Apply automatic attributes based on conventions
    this.applyConventionalAttributes(attributes);

    return this.createAriaAttributeString(attributes);
  }

  /**
   * Generate template attributes for specific elements
   */
  getElementAttributes(elementRole?: string): string {
    const attributes: AriaAttributes = {};

    // Element-specific attributes
    if (elementRole) {
      attributes.role = elementRole;
    }

    // State-based element attributes
    if (this.currentState.matches('loading')) {
      attributes.busy = true;
    }

    if (this.currentState.matches('disabled')) {
      attributes.disabled = true;
    }

    return this.createAriaAttributeString(attributes);
  }

  /**
   * Create announcement for state changes
   */
  announceStateChange(stateName: string, customMessage?: string): void {
    const config = this.ariaConfig.announcements?.[stateName];
    if (!config && !customMessage) return;

    const message = customMessage || config?.message || `State changed to ${stateName}`;
    const priority = config?.priority || 'polite';

    this.announce(message, priority);
  }

  /**
   * Cleanup managed attributes and event listeners
   */
  cleanup(): void {
    this.managedAttributes.clear();
    this.announcements.clear();

    if (this.liveRegionElement) {
      this.liveRegionElement.remove();
      this.liveRegionElement = null;
    }
  }

  private initializeStaticAttributes(): void {
    // Set static ARIA attributes that don't change
    if (this.ariaConfig.role) {
      this.managedAttributes.add('role');
    }

    if (this.ariaConfig.label) {
      this.managedAttributes.add('aria-label');
    }

    if (this.ariaConfig.description) {
      this.managedAttributes.add('aria-description');
    }
  }

  private initializeLiveRegion(): void {
    if (!this.ariaConfig.liveRegion) return;

    this.liveRegionElement = document.createElement('div');
    this.liveRegionElement.setAttribute(
      'aria-live',
      this.ariaConfig.liveRegion.politeness || 'polite'
    );
    this.liveRegionElement.setAttribute(
      'aria-atomic',
      String(this.ariaConfig.liveRegion.atomic || false)
    );

    if (this.ariaConfig.liveRegion.relevant) {
      this.liveRegionElement.setAttribute('aria-relevant', this.ariaConfig.liveRegion.relevant);
    }

    // Hide from visual presentation
    this.liveRegionElement.style.cssText = `
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    `;

    this.componentElement.appendChild(this.liveRegionElement);
  }

  private updateAriaAttributes(): void {
    // This would typically be handled by the framework's reactive updates
    // The actual DOM manipulation is done through template updates
  }

  private handleStateAnnouncements(
    previousState: SnapshotFrom<AnyStateMachine>,
    newState: SnapshotFrom<AnyStateMachine>
  ): void {
    if (!this.ariaConfig.announcements) return;

    // Check for state changes that should trigger announcements
    for (const [stateName, _config] of Object.entries(this.ariaConfig.announcements)) {
      if (newState.matches(stateName) && !previousState.matches(stateName)) {
        this.announceStateChange(stateName);
      }
    }
  }

  private applyConventionalAttributes(attributes: AriaAttributes): void {
    // Apply conventional attribute mappings based on context
    const context = this.currentState.context;

    // Boolean context mappings
    if (context.isLoading === true) attributes.busy = true;
    if (context.isExpanded !== undefined) attributes.expanded = context.isExpanded;
    if (context.isSelected !== undefined) attributes.selected = context.isSelected;
    if (context.isDisabled !== undefined) attributes.disabled = context.isDisabled;
    if (context.isChecked !== undefined) attributes.checked = context.isChecked;
    if (context.isHidden !== undefined) attributes.hidden = context.isHidden;
    if (context.isPressed !== undefined) attributes.pressed = context.isPressed;
    if (context.isRequired !== undefined) attributes.required = context.isRequired;
    if (context.isReadOnly !== undefined) attributes.readonly = context.isReadOnly;
    if (context.isInvalid !== undefined) attributes.invalid = context.isInvalid;

    // State-based conventional mappings
    if (this.currentState.matches('loading') || this.currentState.matches('submitting')) {
      attributes.busy = true;
    }

    if (this.currentState.matches('error') || this.currentState.matches('failed')) {
      attributes.invalid = true;
    }

    // Level and value mappings
    if (typeof context.level === 'number') attributes.level = context.level;
    if (typeof context.valueNow === 'number') attributes.valuenow = context.valueNow;
    if (typeof context.valueMin === 'number') attributes.valuemin = context.valueMin;
    if (typeof context.valueMax === 'number') attributes.valuemax = context.valueMax;
    if (typeof context.valueText === 'string') attributes.valuetext = context.valueText;
  }

  private announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    if (!this.liveRegionElement) return;

    // Debounce rapid announcements
    const announcementKey = `${message}-${priority}`;
    const existingTimeout = this.announcements.get(announcementKey);

    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    const timeoutId = window.setTimeout(() => {
      if (this.liveRegionElement) {
        this.liveRegionElement.setAttribute('aria-live', priority);
        this.liveRegionElement.textContent = message;
      }
      this.announcements.delete(announcementKey);
    }, 100);

    this.announcements.set(announcementKey, timeoutId);
  }

  private createAriaAttributeString(attributes: AriaAttributes): string {
    const validAttributes: string[] = [];

    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null && isValidAriaAttribute(key, value)) {
        const ariaKey = key === 'role' ? 'role' : `aria-${kebabCase(key)}`;
        validAttributes.push(`${ariaKey}="${String(value)}"`);
      }
    }

    return validAttributes.join(' ');
  }
}

/**
 * ARIA Template Helper
 * Provides template functions for ARIA integration
 */

export class AriaTemplateHelper {
  private manager: AriaStateManager;

  constructor(manager: AriaStateManager) {
    this.manager = manager;
  }

  /**
   * Get ARIA attributes for the root component element
   */
  getRootAttributes(): string {
    return this.manager.getAriaAttributeString();
  }

  /**
   * Get ARIA attributes for specific element types
   */
  getButtonAttributes(pressed?: boolean): string {
    const attrs: AriaAttributes = { role: 'button' };
    if (pressed !== undefined) attrs.pressed = pressed;
    return this.manager.getElementAttributes('button');
  }

  getListAttributes(orientation: 'horizontal' | 'vertical' = 'vertical'): string {
    const _attrs: AriaAttributes = {
      role: 'list',
      orientation,
    };
    return this.manager.getElementAttributes('list');
  }

  getListItemAttributes(selected?: boolean, index?: number): string {
    const attrs: AriaAttributes = { role: 'listitem' };
    if (selected !== undefined) attrs.selected = selected;
    if (index !== undefined) attrs.setsize = index;
    return this.manager.getElementAttributes('listitem');
  }

  getFormAttributes(): string {
    return this.manager.getElementAttributes('form');
  }

  getInputAttributes(invalid?: boolean, required?: boolean): string {
    const attrs: AriaAttributes = {};
    if (invalid !== undefined) attrs.invalid = invalid;
    if (required !== undefined) attrs.required = required;
    return this.manager.getElementAttributes();
  }

  getAlertAttributes(): string {
    return this.manager.getElementAttributes('alert');
  }

  getStatusAttributes(): string {
    return this.manager.getElementAttributes('status');
  }

  getProgressAttributes(value?: number, min?: number, max?: number): string {
    const attrs: AriaAttributes = { role: 'progressbar' };
    if (value !== undefined) attrs.valuenow = value;
    if (min !== undefined) attrs.valuemin = min;
    if (max !== undefined) attrs.valuemax = max;
    return this.manager.getElementAttributes('progressbar');
  }
}

/**
 * Factory Functions
 * Create ARIA managers and helpers
 */

export function createAriaManager(
  componentElement: HTMLElement,
  ariaConfig: AriaConfig,
  initialState: SnapshotFrom<AnyStateMachine>
): AriaStateManager {
  return new AriaStateManager(componentElement, ariaConfig, initialState);
}

export function createAriaTemplateHelper(manager: AriaStateManager): AriaTemplateHelper {
  return new AriaTemplateHelper(manager);
}

/**
 * Enhanced Component Configuration
 * Extends the component configuration to include ARIA
 */

export interface ComponentConfigWithAria<TMachine extends AnyStateMachine> {
  machine: TMachine;
  template: (state: SnapshotFrom<TMachine>, aria: AriaTemplateHelper) => string;
  tagName?: string;
  styles?: string;
  ariaConfig?: AriaConfig;
}

/**
 * Default ARIA Configurations
 * Common ARIA configurations for different component types
 */

export const DefaultAriaConfigs = {
  button: {
    role: 'button',
    stateMapping: {
      disabled: { disabled: true },
      pressed: { pressed: true },
      loading: { busy: true },
    },
    announcements: {
      loading: { message: 'Loading...', priority: 'polite' as const },
      error: { message: 'Error occurred', priority: 'assertive' as const },
    },
  },

  form: {
    role: 'form',
    stateMapping: {
      submitting: { busy: true },
      invalid: { invalid: true },
    },
    announcements: {
      submitting: { message: 'Submitting form...', priority: 'polite' as const },
      error: { message: 'Form submission failed', priority: 'assertive' as const },
      success: { message: 'Form submitted successfully', priority: 'polite' as const },
    },
  },

  list: {
    role: 'list',
    keyboardNavigation: {
      orientation: 'vertical' as const,
      activateOnFocus: false,
      wrap: true,
      roving: true,
    },
    stateMapping: {
      loading: { busy: true },
    },
  },

  modal: {
    role: 'dialog',
    stateMapping: {
      open: { modal: true },
      closed: { hidden: true },
    },
    focusManagement: {
      trap: true,
      restoreOnExit: true,
      initialFocus: 'first',
    },
    announcements: {
      opened: { message: 'Modal opened', priority: 'assertive' as const },
      closed: { message: 'Modal closed', priority: 'polite' as const },
    },
  },

  alert: {
    role: 'alert',
    liveRegion: {
      politeness: 'assertive' as const,
      atomic: true,
    },
  },

  status: {
    role: 'status',
    liveRegion: {
      politeness: 'polite' as const,
      atomic: true,
    },
  },
} as const;

export type DefaultAriaConfigType = keyof typeof DefaultAriaConfigs;
