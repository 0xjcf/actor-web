/**
 * Enhanced Component Creation with Automatic Accessibility
 * Integrates ARIA management, focus management, keyboard navigation, and screen reader announcements
 */

import { type AnyStateMachine, createActor, type SnapshotFrom } from 'xstate';
import {
  type AriaConfig,
  type AriaStateManager,
  type AriaTemplateHelper,
  type ComponentConfigWithAria,
  createAriaManager,
  createAriaTemplateHelper,
  DefaultAriaConfigs,
  type DefaultAriaConfigType,
} from './aria-integration.js';
import {
  createFocusManagementHelper,
  DefaultFocusConfigs,
  type DefaultFocusConfigType,
  type FocusManagementConfig,
  type FocusManagementHelper,
  focusManagementMachine,
} from './focus-management.js';
import {
  createKeyboardNavigationHelper,
  DefaultKeyboardConfigs,
  type DefaultKeyboardConfigType,
  type KeyboardNavigationConfig,
  type KeyboardNavigationHelper,
  keyboardNavigationMachine,
} from './keyboard-navigation.js';
import {
  createScreenReaderAnnouncementHelper,
  DefaultScreenReaderConfigs,
  type DefaultScreenReaderConfigType,
  type ScreenReaderAnnouncementHelper,
  type ScreenReaderConfig,
  screenReaderAnnouncementMachine,
} from './screen-reader-announcements.js';
import type { RawCSS, RawHTML } from './template-renderer.js';

/**
 * Enhanced Component Configuration
 * Includes all accessibility configurations
 */

export interface EnhancedComponentConfig<TMachine extends AnyStateMachine> {
  machine: TMachine;
  template: (
    state: SnapshotFrom<TMachine>,
    accessibility: AccessibilityHelpers
  ) => string | RawHTML;
  tagName?: string;
  styles?: string | RawCSS;

  // Accessibility configurations
  accessibility?: {
    aria?: AriaConfig | DefaultAriaConfigType;
    focus?: FocusManagementConfig | DefaultFocusConfigType;
    keyboard?: KeyboardNavigationConfig | DefaultKeyboardConfigType;
    screenReader?: ScreenReaderConfig | DefaultScreenReaderConfigType;
    presets?: AccessibilityPreset;
    autoInit?: boolean;
  };

  // Mobile navigation configurations
  mobile?: {
    navigation?: 'drawer' | 'bottom-sheet' | 'tabs' | 'stack' | 'modal';
    gestures?: {
      swipe?: boolean;
      pinch?: boolean;
      drag?: boolean;
    };
    responsive?: {
      breakpoints?: {
        mobile?: number;
        tablet?: number;
      };
      adaptiveLayout?: boolean;
    };
  };
}

/**
 * Accessibility Helpers
 * Combined helpers for all accessibility systems
 */

export interface AccessibilityHelpers {
  aria: AriaTemplateHelper;
  focus: FocusManagementHelper;
  keyboard: KeyboardNavigationHelper;
  screenReader: ScreenReaderAnnouncementHelper;

  // Convenience methods
  announce(message: string, priority?: 'polite' | 'assertive'): void;
  announceStateChange(stateName: string, customMessage?: string): void;
  enableKeyboardNavigation(container: HTMLElement): void;
  trapFocus(container: HTMLElement): void;
  releaseFocusTrap(): void;

  // Template attribute helpers
  getRootAttributes(): string;
  getButtonAttributes(pressed?: boolean): string;
  getListAttributes(orientation?: 'horizontal' | 'vertical'): string;
  getListItemAttributes(index: number, isSelected?: boolean): string;
  getFormAttributes(): string;
  getInputAttributes(invalid?: boolean, required?: boolean): string;

  // State-aware helpers
  isLoading(): boolean;
  hasError(): boolean;
  isDisabled(): boolean;
  getLoadingMessage(): string;
  getErrorMessage(): string;

  // Mobile navigation helpers (available when mobile is enabled)
  mobile?: {
    openNavigation(): void;
    closeNavigation(): void;
    toggleNavigation(): void;
    isNavigationOpen(): boolean;
    setResponsiveBreakpoint(breakpoint: number): void;
    enableGestures(gestures: string[]): void;
  };
}

/**
 * Accessibility Presets
 * Pre-configured accessibility setups for common patterns
 */

export type AccessibilityPreset =
  | 'button'
  | 'form'
  | 'list'
  | 'modal'
  | 'menu'
  | 'tabs'
  | 'grid'
  | 'alert'
  | 'status'
  | 'none';

/**
 * Preset Configurations
 */

const AccessibilityPresets: Record<
  AccessibilityPreset,
  {
    aria: DefaultAriaConfigType | AriaConfig;
    focus: DefaultFocusConfigType | FocusManagementConfig;
    keyboard: DefaultKeyboardConfigType | KeyboardNavigationConfig;
    screenReader: DefaultScreenReaderConfigType | ScreenReaderConfig;
  }
> = {
  button: {
    aria: 'button',
    focus: 'modal', // Use modal focus for individual buttons
    keyboard: 'menu', // Simple keyboard handling
    screenReader: 'minimal',
  },
  form: {
    aria: 'form',
    focus: 'modal',
    keyboard: 'menu',
    screenReader: 'standard',
  },
  list: {
    aria: 'list',
    focus: 'listbox',
    keyboard: 'listbox',
    screenReader: 'standard',
  },
  modal: {
    aria: 'modal',
    focus: 'modal',
    keyboard: 'menu',
    screenReader: 'standard',
  },
  menu: {
    aria: 'list',
    focus: 'menu',
    keyboard: 'menu',
    screenReader: 'standard',
  },
  tabs: {
    aria: 'list',
    focus: 'tabs',
    keyboard: 'tabs',
    screenReader: 'minimal',
  },
  grid: {
    aria: 'list',
    focus: 'grid',
    keyboard: 'grid',
    screenReader: 'standard',
  },
  alert: {
    aria: 'alert',
    focus: 'modal',
    keyboard: 'menu',
    screenReader: 'verbose',
  },
  status: {
    aria: 'status',
    focus: 'modal',
    keyboard: 'menu',
    screenReader: 'standard',
  },
  none: {
    aria: {} as AriaConfig,
    focus: {} as FocusManagementConfig,
    keyboard: {} as KeyboardNavigationConfig,
    screenReader: { enabled: false } as ScreenReaderConfig,
  },
};

/**
 * Enhanced Component Class
 * Automatically includes all accessibility features
 */

export class EnhancedReactiveComponent<TMachine extends AnyStateMachine> extends HTMLElement {
  private machine: TMachine;
  private template: (
    state: SnapshotFrom<TMachine>,
    accessibility: AccessibilityHelpers
  ) => string | RawHTML;
  private actor: ReturnType<typeof createActor<TMachine>>;
  private ariaManager: AriaStateManager;
  private focusActor: ReturnType<typeof createActor<typeof focusManagementMachine>>;
  private keyboardActor: ReturnType<typeof createActor<typeof keyboardNavigationMachine>>;
  private screenReaderActor: ReturnType<typeof createActor<typeof screenReaderAnnouncementMachine>>;
  private accessibilityHelpers: AccessibilityHelpers;
  private styles?: string;
  private isInitialized = false;

  // Mobile navigation properties
  private mobileConfig?: EnhancedComponentConfig<TMachine>['mobile'];
  private mobileNavigation?: {
    isOpen: boolean;
    type: string;
    gestures: Record<string, boolean>;
  };

  constructor(config: EnhancedComponentConfig<TMachine>) {
    super();

    this.machine = config.machine;
    this.template = config.template;
    // Convert RawCSS to string if needed
    this.styles =
      typeof config.styles === 'string'
        ? config.styles
        : config.styles
          ? String(config.styles)
          : undefined;
    this.mobileConfig = config.mobile;

    // Initialize mobile navigation if enabled
    if (this.mobileConfig) {
      this.mobileNavigation = {
        isOpen: false,
        type: this.mobileConfig.navigation || 'drawer',
        gestures: {
          swipe: this.mobileConfig.gestures?.swipe ?? true,
          pinch: this.mobileConfig.gestures?.pinch ?? false,
          drag: this.mobileConfig.gestures?.drag ?? false,
        },
      };
    }

    // Initialize accessibility configurations
    const accessibilityConfig = this.resolveAccessibilityConfig(config.accessibility);

    // Create actors for all accessibility systems
    this.focusActor = createActor(focusManagementMachine);
    this.keyboardActor = createActor(keyboardNavigationMachine);
    this.screenReaderActor = createActor(screenReaderAnnouncementMachine);

    // Create main state machine actor
    this.actor = createActor(this.machine);

    // Initialize ARIA manager
    this.ariaManager = createAriaManager(this, accessibilityConfig.aria, this.actor.getSnapshot());

    // Create accessibility helpers
    this.accessibilityHelpers = this.createAccessibilityHelpers();

    // Initialize if auto-init is enabled
    if (config.accessibility?.autoInit !== false) {
      this.initializeAccessibility();
    }
  }

  connectedCallback() {
    if (!this.isInitialized) {
      this.initializeAccessibility();
    }

    // Start all actors
    this.actor.start();
    this.focusActor.start();
    this.keyboardActor.start();
    this.screenReaderActor.start();

    // Initialize screen reader system
    this.screenReaderActor.send({ type: 'INITIALIZE' });

    // Set up shadow DOM if styles are provided
    if (this.styles) {
      this.attachShadow({ mode: 'open' });
    }

    // Subscribe to state changes
    this.actor.subscribe((state: SnapshotFrom<TMachine>) => {
      this.updateComponent(state);
    });

    // Subscribe to accessibility state changes
    this.focusActor.subscribe(() => {
      this.updateAccessibilityHelpers();
    });

    this.keyboardActor.subscribe(() => {
      this.updateAccessibilityHelpers();
    });

    this.screenReaderActor.subscribe(() => {
      this.updateAccessibilityHelpers();
    });

    // Initial render
    this.updateComponent(this.actor.getSnapshot());
  }

  disconnectedCallback() {
    // Stop all actors
    this.actor.stop();
    this.focusActor.stop();
    this.keyboardActor.stop();

    // Cleanup screen reader system
    this.screenReaderActor.send({ type: 'CLEANUP' });
    this.screenReaderActor.stop();

    // Cleanup ARIA manager
    this.ariaManager.cleanup();
  }

  private resolveAccessibilityConfig(config?: EnhancedComponentConfig<TMachine>['accessibility']) {
    const defaultConfig = {
      aria: {} as AriaConfig,
      focus: {} as FocusManagementConfig,
      keyboard: {} as KeyboardNavigationConfig,
      screenReader: DefaultScreenReaderConfigs.standard,
    };

    if (!config) return defaultConfig;

    // Apply preset if specified
    if (config.presets) {
      const preset = AccessibilityPresets[config.presets];
      return {
        aria: typeof preset.aria === 'string' ? DefaultAriaConfigs[preset.aria] : preset.aria,
        focus: typeof preset.focus === 'string' ? DefaultFocusConfigs[preset.focus] : preset.focus,
        keyboard:
          typeof preset.keyboard === 'string'
            ? DefaultKeyboardConfigs[preset.keyboard]
            : preset.keyboard,
        screenReader:
          typeof preset.screenReader === 'string'
            ? DefaultScreenReaderConfigs[preset.screenReader]
            : preset.screenReader,
      };
    }

    // Apply individual configurations
    return {
      aria:
        typeof config.aria === 'string'
          ? DefaultAriaConfigs[config.aria]
          : config.aria || defaultConfig.aria,
      focus:
        typeof config.focus === 'string'
          ? DefaultFocusConfigs[config.focus]
          : config.focus || defaultConfig.focus,
      keyboard:
        typeof config.keyboard === 'string'
          ? DefaultKeyboardConfigs[config.keyboard]
          : config.keyboard || defaultConfig.keyboard,
      screenReader:
        typeof config.screenReader === 'string'
          ? DefaultScreenReaderConfigs[config.screenReader]
          : config.screenReader || defaultConfig.screenReader,
    };
  }

  private initializeAccessibility() {
    // Enable keyboard navigation
    this.keyboardActor.send({
      type: 'ENABLE_NAVIGATION',
      container: this,
      focusActor: this.focusActor,
    });

    this.isInitialized = true;
  }

  private createAccessibilityHelpers(): AccessibilityHelpers {
    const ariaHelper = createAriaTemplateHelper(this.ariaManager);
    const focusHelper = createFocusManagementHelper(this.focusActor, this.focusActor.getSnapshot());
    const keyboardHelper = createKeyboardNavigationHelper(
      this.keyboardActor,
      this.keyboardActor.getSnapshot(),
      this.focusActor.getSnapshot()
    );
    const screenReaderHelper = createScreenReaderAnnouncementHelper(
      this.screenReaderActor,
      this.screenReaderActor.getSnapshot()
    );

    const helpers: AccessibilityHelpers = {
      aria: ariaHelper,
      focus: focusHelper,
      keyboard: keyboardHelper,
      screenReader: screenReaderHelper,

      // Convenience methods
      announce: (message: string, priority?: 'polite' | 'assertive') => {
        screenReaderHelper.announce(message, priority);
      },

      announceStateChange: (stateName: string, customMessage?: string) => {
        this.ariaManager.announceStateChange(stateName, customMessage);
      },

      enableKeyboardNavigation: (container: HTMLElement) => {
        keyboardHelper.enableNavigation(container, this.focusActor);
      },

      trapFocus: (container: HTMLElement) => {
        focusHelper.trapFocus(container);
      },

      releaseFocusTrap: () => {
        focusHelper.releaseFocusTrap();
      },

      // Template attribute helpers
      getRootAttributes: () => ariaHelper.getRootAttributes(),
      getButtonAttributes: (pressed?: boolean) => ariaHelper.getButtonAttributes(pressed),
      getListAttributes: (orientation?: 'horizontal' | 'vertical') =>
        ariaHelper.getListAttributes(orientation),
      getListItemAttributes: (index: number, isSelected?: boolean) =>
        ariaHelper.getListItemAttributes(isSelected, index),
      getFormAttributes: () => ariaHelper.getFormAttributes(),
      getInputAttributes: (invalid?: boolean, required?: boolean) =>
        ariaHelper.getInputAttributes(invalid, required),

      // State-aware helpers - simplified safe access
      isLoading: () => {
        const state = this.actor.getSnapshot() as Record<string, unknown>;
        return typeof state.matches === 'function' ? state.matches('loading') : false;
      },
      hasError: () => {
        const state = this.actor.getSnapshot() as Record<string, unknown>;
        return typeof state.matches === 'function' ? state.matches('error') : false;
      },
      isDisabled: () => {
        const state = this.actor.getSnapshot() as Record<string, unknown>;
        return typeof state.matches === 'function' ? state.matches('disabled') : false;
      },
      getLoadingMessage: () => 'Loading...',
      getErrorMessage: () => {
        const state = this.actor.getSnapshot() as Record<string, unknown>;
        const context = state.context as Record<string, unknown>;
        return (context?.error as string) || 'An error occurred';
      },
    };

    // Add mobile helpers if mobile navigation is enabled
    if (this.mobileConfig && this.mobileNavigation) {
      helpers.mobile = {
        openNavigation: () => {
          if (this.mobileNavigation) {
            this.mobileNavigation.isOpen = true;
            this.setAttribute('data-mobile-nav-open', 'true');
            this.dispatchEvent(
              new CustomEvent('mobile-nav-opened', {
                bubbles: true,
                detail: { type: this.mobileNavigation.type },
              })
            );
          }
        },

        closeNavigation: () => {
          if (this.mobileNavigation) {
            this.mobileNavigation.isOpen = false;
            this.removeAttribute('data-mobile-nav-open');
            this.dispatchEvent(
              new CustomEvent('mobile-nav-closed', {
                bubbles: true,
                detail: { type: this.mobileNavigation.type },
              })
            );
          }
        },

        toggleNavigation: () => {
          if (this.mobileNavigation?.isOpen) {
            helpers.mobile?.closeNavigation();
          } else {
            helpers.mobile?.openNavigation();
          }
        },

        isNavigationOpen: () => {
          return this.mobileNavigation?.isOpen ?? false;
        },

        setResponsiveBreakpoint: (breakpoint: number) => {
          if (this.mobileConfig?.responsive) {
            this.mobileConfig.responsive.breakpoints = {
              ...this.mobileConfig.responsive.breakpoints,
              mobile: breakpoint,
            };
          }
        },

        enableGestures: (gestures: string[]) => {
          const nav = this.mobileNavigation;
          if (nav) {
            for (const gesture of gestures) {
              if (gesture in nav.gestures) {
                nav.gestures[gesture] = true;
              }
            }
          }
        },
      };
    }

    return helpers;
  }

  private updateAccessibilityHelpers() {
    // Update all helpers with current snapshots
    this.accessibilityHelpers.focus = createFocusManagementHelper(
      this.focusActor,
      this.focusActor.getSnapshot()
    );

    this.accessibilityHelpers.keyboard = createKeyboardNavigationHelper(
      this.keyboardActor,
      this.keyboardActor.getSnapshot(),
      this.focusActor.getSnapshot()
    );

    this.accessibilityHelpers.screenReader = createScreenReaderAnnouncementHelper(
      this.screenReaderActor,
      this.screenReaderActor.getSnapshot()
    );
  }

  private updateComponent(state: SnapshotFrom<TMachine>) {
    // Update ARIA manager with new state
    this.ariaManager.updateState(state);

    // Render template with accessibility helpers
    const templateResult = this.template(state, this.accessibilityHelpers);

    // Convert to string - RawHTML objects are implicitly convertible to string
    const html = typeof templateResult === 'string' ? templateResult : String(templateResult);

    // Update DOM
    const container = this.shadowRoot || this;
    container.innerHTML = html;

    // Add styles if using shadow DOM
    if (this.shadowRoot && this.styles) {
      const style = document.createElement('style');
      style.textContent = this.styles;
      this.shadowRoot.insertBefore(style, this.shadowRoot.firstChild);
    }

    // Set data-state attribute for CSS styling - safer access
    const stateValue = (state as Record<string, unknown>).value || 'unknown';
    this.setAttribute('data-state', String(stateValue));

    // Apply ARIA attributes to root element
    const ariaAttributes = this.ariaManager.getAriaAttributeString();
    if (ariaAttributes) {
      for (const attr of ariaAttributes.split(' ')) {
        const [name, value] = attr.split('=');
        this.setAttribute(name, value.replace(/"/g, ''));
      }
    }
  }

  // Public API for interacting with accessibility features
  public getAccessibilityHelpers(): AccessibilityHelpers {
    return this.accessibilityHelpers;
  }

  public announceStateChange(stateName: string, message?: string) {
    this.ariaManager.announceStateChange(stateName, message);
  }

  public enableKeyboardNavigation() {
    this.keyboardActor.send({
      type: 'ENABLE_NAVIGATION',
      container: this,
      focusActor: this.focusActor,
    });
  }

  public disableKeyboardNavigation() {
    this.keyboardActor.send({ type: 'DISABLE_NAVIGATION' });
  }

  // State-aware helpers - improved type safety with type guards
  private getStateValue(state: SnapshotFrom<TMachine>): string {
    const stateObj = state as Record<string, unknown>;
    return 'value' in stateObj ? String(stateObj.value) : 'unknown';
  }

  private hasStateMatches(
    state: SnapshotFrom<TMachine>
  ): state is SnapshotFrom<TMachine> & { matches: (stateName: string) => boolean } {
    return (
      'matches' in state && typeof (state as unknown as { matches: unknown }).matches === 'function'
    );
  }

  private hasStateContext(
    state: SnapshotFrom<TMachine>
  ): state is SnapshotFrom<TMachine> & { context: { error?: string } } {
    const stateObj = state as Record<string, unknown>;
    return 'context' in stateObj && typeof stateObj.context === 'object';
  }
}

/**
 * Enhanced createComponent Function
 * Creates components with automatic accessibility features
 */

export function createEnhancedComponent<TMachine extends AnyStateMachine>(
  config: EnhancedComponentConfig<TMachine>
): typeof EnhancedReactiveComponent {
  // Generate tag name from machine ID if not provided
  const tagName = config.tagName || `${config.machine.id}-component`;

  // Create the enhanced component class
  class GeneratedComponent extends EnhancedReactiveComponent<TMachine> {
    constructor() {
      super(config);
    }
  }

  // Register the custom element
  if (!customElements.get(tagName)) {
    customElements.define(tagName, GeneratedComponent);
  }

  return GeneratedComponent as unknown as typeof EnhancedReactiveComponent;
}

/**
 * Backward Compatibility
 * Enhanced version of the original createComponent function
 */

export function createAccessibleComponent<TMachine extends AnyStateMachine>(
  config: ComponentConfigWithAria<TMachine> & {
    accessibility?: {
      preset?: AccessibilityPreset;
      autoInit?: boolean;
    };
  }
): typeof EnhancedReactiveComponent {
  // Convert to enhanced config format
  const enhancedConfig: EnhancedComponentConfig<TMachine> = {
    machine: config.machine,
    template: (state, accessibility): string | RawHTML => {
      // Provide aria helper for backward compatibility
      // Legacy templates can now return string | RawHTML directly
      return config.template(state, accessibility.aria);
    },
    tagName: config.tagName,
    styles: config.styles,
    accessibility: {
      aria: config.ariaConfig,
      presets: config.accessibility?.preset,
      autoInit: config.accessibility?.autoInit,
    },
  };

  return createEnhancedComponent(enhancedConfig);
}

/**
 * Quick Preset Functions
 * Convenient functions for common component types
 */

export function createAccessibleButton<TMachine extends AnyStateMachine>(
  config: Omit<EnhancedComponentConfig<TMachine>, 'accessibility'>
): typeof EnhancedReactiveComponent {
  return createEnhancedComponent({
    ...config,
    accessibility: { presets: 'button' },
  });
}

export function createAccessibleForm<TMachine extends AnyStateMachine>(
  config: Omit<EnhancedComponentConfig<TMachine>, 'accessibility'>
): typeof EnhancedReactiveComponent {
  return createEnhancedComponent({
    ...config,
    accessibility: { presets: 'form' },
  });
}

export function createAccessibleList<TMachine extends AnyStateMachine>(
  config: Omit<EnhancedComponentConfig<TMachine>, 'accessibility'>
): typeof EnhancedReactiveComponent {
  return createEnhancedComponent({
    ...config,
    accessibility: { presets: 'list' },
  });
}

export function createAccessibleModal<TMachine extends AnyStateMachine>(
  config: Omit<EnhancedComponentConfig<TMachine>, 'accessibility'>
): typeof EnhancedReactiveComponent {
  return createEnhancedComponent({
    ...config,
    accessibility: { presets: 'modal' },
  });
}

export function createAccessibleMenu<TMachine extends AnyStateMachine>(
  config: Omit<EnhancedComponentConfig<TMachine>, 'accessibility'>
): typeof EnhancedReactiveComponent {
  return createEnhancedComponent({
    ...config,
    accessibility: { presets: 'menu' },
  });
}
