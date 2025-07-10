/**
 * Reactive Keyboard Navigation System
 * XState-based keyboard navigation that integrates with focus management
 */

import { type Actor, assign, type SnapshotFrom, setup } from 'xstate';
import type { FocusManagementActor, FocusManagementSnapshot } from './focus-management.js';

/**
 * Keyboard Navigation Types
 */

export interface KeyboardNavigationContext {
  orientation: 'horizontal' | 'vertical' | 'both';
  wrap: boolean;
  activateOnFocus: boolean;
  preventDefaultKeys: string[];
  currentActiveElement: HTMLElement | null;
  keyHandlers: Map<string, (event: KeyboardEvent) => void>;
  container: HTMLElement | null;
  isEnabled: boolean;
  focusManagementActor: FocusManagementActor | null;
  rovingTabIndex: boolean;
  homeEndEnabled: boolean;
  typeaheadEnabled: boolean;
  typeaheadBuffer: string;
  typeaheadTimeout: number | null;
}

export type KeyboardNavigationEvent =
  | { type: 'ENABLE_NAVIGATION'; container: HTMLElement; focusActor?: FocusManagementActor }
  | { type: 'DISABLE_NAVIGATION' }
  | { type: 'SET_ORIENTATION'; orientation: 'horizontal' | 'vertical' | 'both' }
  | { type: 'SET_WRAP'; wrap: boolean }
  | { type: 'SET_ACTIVATE_ON_FOCUS'; activateOnFocus: boolean }
  | { type: 'SET_ROVING_TAB_INDEX'; enabled: boolean }
  | { type: 'SET_HOME_END_ENABLED'; enabled: boolean }
  | { type: 'SET_TYPEAHEAD_ENABLED'; enabled: boolean }
  | { type: 'HANDLE_KEYDOWN'; event: KeyboardEvent }
  | { type: 'HANDLE_ARROW_KEY'; direction: 'up' | 'down' | 'left' | 'right'; event: KeyboardEvent }
  | { type: 'HANDLE_HOME_END'; key: 'Home' | 'End'; event: KeyboardEvent }
  | { type: 'HANDLE_TYPEAHEAD'; character: string; event: KeyboardEvent }
  | { type: 'CLEAR_TYPEAHEAD' }
  | { type: 'ACTIVATE_CURRENT_ELEMENT' }
  | { type: 'UPDATE_ACTIVE_ELEMENT'; element: HTMLElement }
  | { type: 'ADD_KEY_HANDLER'; key: string; handler: (event: KeyboardEvent) => void }
  | { type: 'REMOVE_KEY_HANDLER'; key: string };

/**
 * Keyboard Navigation State Machine
 */

export const keyboardNavigationMachine = setup({
  types: {
    context: {} as KeyboardNavigationContext,
    events: {} as KeyboardNavigationEvent,
  },
  guards: {
    isEnabled: ({ context }) => context.isEnabled,
    hasContainer: ({ context }) => context.container !== null,
    hasFocusActor: ({ context }) => context.focusManagementActor !== null,
    shouldWrap: ({ context }) => context.wrap,
    isHorizontalEnabled: ({ context }) =>
      context.orientation === 'horizontal' || context.orientation === 'both',
    isVerticalEnabled: ({ context }) =>
      context.orientation === 'vertical' || context.orientation === 'both',
    isHomeEndEnabled: ({ context }) => context.homeEndEnabled,
    isTypeaheadEnabled: ({ context }) => context.typeaheadEnabled,
    shouldActivateOnFocus: ({ context }) => context.activateOnFocus,
    shouldPreventDefault: ({ context, event }) => {
      if (event.type !== 'HANDLE_KEYDOWN') return false;
      return context.preventDefaultKeys.includes(event.event.key);
    },
  },
  actions: {
    enableNavigationAction: assign({
      isEnabled: true,
      container: ({ event }) => {
        if (event.type !== 'ENABLE_NAVIGATION') return null;
        return event.container;
      },
      focusManagementActor: ({ event }) => {
        if (event.type !== 'ENABLE_NAVIGATION') return null;
        return event.focusActor || null;
      },
    }),

    disableNavigationAction: assign({
      isEnabled: false,
      container: null,
      focusManagementActor: null,
      currentActiveElement: null,
    }),

    setOrientationAction: assign({
      orientation: ({ event }) => {
        if (event.type !== 'SET_ORIENTATION') return 'vertical';
        return event.orientation;
      },
    }),

    setWrapAction: assign({
      wrap: ({ event }) => {
        if (event.type !== 'SET_WRAP') return false;
        return event.wrap;
      },
    }),

    setActivateOnFocusAction: assign({
      activateOnFocus: ({ event }) => {
        if (event.type !== 'SET_ACTIVATE_ON_FOCUS') return false;
        return event.activateOnFocus;
      },
    }),

    setRovingTabIndexAction: assign({
      rovingTabIndex: ({ event }) => {
        if (event.type !== 'SET_ROVING_TAB_INDEX') return false;
        return event.enabled;
      },
    }),

    setHomeEndEnabledAction: assign({
      homeEndEnabled: ({ event }) => {
        if (event.type !== 'SET_HOME_END_ENABLED') return false;
        return event.enabled;
      },
    }),

    setTypeaheadEnabledAction: assign({
      typeaheadEnabled: ({ event }) => {
        if (event.type !== 'SET_TYPEAHEAD_ENABLED') return false;
        return event.enabled;
      },
    }),

    handleArrowKeyAction: assign({
      currentActiveElement: ({ event, context }) => {
        if (event.type !== 'HANDLE_ARROW_KEY') return context.currentActiveElement;

        const { direction } = event;
        const { focusManagementActor, orientation } = context;

        if (!focusManagementActor) return context.currentActiveElement;

        // Send appropriate navigation event to focus management
        switch (direction) {
          case 'up':
            if (orientation === 'vertical' || orientation === 'both') {
              focusManagementActor.send({ type: 'MOVE_TO_PREVIOUS' });
            }
            break;
          case 'down':
            if (orientation === 'vertical' || orientation === 'both') {
              focusManagementActor.send({ type: 'MOVE_TO_NEXT' });
            }
            break;
          case 'left':
            if (orientation === 'horizontal' || orientation === 'both') {
              focusManagementActor.send({ type: 'MOVE_TO_PREVIOUS' });
            }
            break;
          case 'right':
            if (orientation === 'horizontal' || orientation === 'both') {
              focusManagementActor.send({ type: 'MOVE_TO_NEXT' });
            }
            break;
        }

        return context.currentActiveElement;
      },
    }),

    handleHomeEndAction: assign({
      currentActiveElement: ({ event, context }) => {
        if (event.type !== 'HANDLE_HOME_END') return context.currentActiveElement;

        const { key } = event;
        const { focusManagementActor } = context;

        if (!focusManagementActor) return context.currentActiveElement;

        switch (key) {
          case 'Home':
            focusManagementActor.send({ type: 'MOVE_TO_FIRST' });
            break;
          case 'End':
            focusManagementActor.send({ type: 'MOVE_TO_LAST' });
            break;
        }

        return context.currentActiveElement;
      },
    }),

    handleTypeaheadAction: assign({
      typeaheadBuffer: ({ event, context }) => {
        if (event.type !== 'HANDLE_TYPEAHEAD') return context.typeaheadBuffer;

        const { character } = event;
        return context.typeaheadBuffer + character.toLowerCase();
      },
      typeaheadTimeout: ({ event, context }) => {
        if (event.type !== 'HANDLE_TYPEAHEAD') return context.typeaheadTimeout;

        // Clear existing timeout
        if (context.typeaheadTimeout) {
          clearTimeout(context.typeaheadTimeout);
        }

        // Set new timeout to clear buffer
        return window.setTimeout(() => {
          // This would be handled by the machine's context update
        }, 1000);
      },
    }),

    clearTypeaheadAction: assign({
      typeaheadBuffer: '',
      typeaheadTimeout: ({ context }) => {
        if (context.typeaheadTimeout) {
          clearTimeout(context.typeaheadTimeout);
        }
        return null;
      },
    }),

    activateCurrentElementAction: ({ context }) => {
      if (context.currentActiveElement && context.activateOnFocus) {
        // Trigger click event on current element
        context.currentActiveElement.click();
      }
    },

    updateActiveElementAction: assign({
      currentActiveElement: ({ event }) => {
        if (event.type !== 'UPDATE_ACTIVE_ELEMENT') return null;
        return event.element;
      },
    }),

    addKeyHandlerAction: assign({
      keyHandlers: ({ event, context }) => {
        if (event.type !== 'ADD_KEY_HANDLER') return context.keyHandlers;

        const newHandlers = new Map(context.keyHandlers);
        newHandlers.set(event.key, event.handler);
        return newHandlers;
      },
    }),

    removeKeyHandlerAction: assign({
      keyHandlers: ({ event, context }) => {
        if (event.type !== 'REMOVE_KEY_HANDLER') return context.keyHandlers;

        const newHandlers = new Map(context.keyHandlers);
        newHandlers.delete(event.key);
        return newHandlers;
      },
    }),

    preventDefaultAction: ({ event }) => {
      if (event.type === 'HANDLE_KEYDOWN') {
        event.event.preventDefault();
      }
    },
  },
}).createMachine({
  id: 'keyboardNavigation',
  initial: 'disabled',
  context: {
    orientation: 'vertical',
    wrap: true,
    activateOnFocus: false,
    preventDefaultKeys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'],
    currentActiveElement: null,
    keyHandlers: new Map(),
    container: null,
    isEnabled: false,
    focusManagementActor: null,
    rovingTabIndex: false,
    homeEndEnabled: true,
    typeaheadEnabled: false,
    typeaheadBuffer: '',
    typeaheadTimeout: null,
  },
  states: {
    disabled: {
      on: {
        ENABLE_NAVIGATION: {
          target: 'enabled',
          actions: 'enableNavigationAction',
        },
      },
    },
    enabled: {
      on: {
        DISABLE_NAVIGATION: {
          target: 'disabled',
          actions: 'disableNavigationAction',
        },
        SET_ORIENTATION: {
          actions: 'setOrientationAction',
        },
        SET_WRAP: {
          actions: 'setWrapAction',
        },
        SET_ACTIVATE_ON_FOCUS: {
          actions: 'setActivateOnFocusAction',
        },
        SET_ROVING_TAB_INDEX: {
          actions: 'setRovingTabIndexAction',
        },
        SET_HOME_END_ENABLED: {
          actions: 'setHomeEndEnabledAction',
        },
        SET_TYPEAHEAD_ENABLED: {
          actions: 'setTypeaheadEnabledAction',
        },
        HANDLE_KEYDOWN: [
          {
            guard: 'shouldPreventDefault',
            actions: 'preventDefaultAction',
          },
        ],
        HANDLE_ARROW_KEY: [
          {
            guard: 'hasFocusActor',
            actions: 'handleArrowKeyAction',
          },
        ],
        HANDLE_HOME_END: [
          {
            guard: 'isHomeEndEnabled',
            actions: 'handleHomeEndAction',
          },
        ],
        HANDLE_TYPEAHEAD: [
          {
            guard: 'isTypeaheadEnabled',
            actions: 'handleTypeaheadAction',
          },
        ],
        CLEAR_TYPEAHEAD: {
          actions: 'clearTypeaheadAction',
        },
        ACTIVATE_CURRENT_ELEMENT: {
          actions: 'activateCurrentElementAction',
        },
        UPDATE_ACTIVE_ELEMENT: {
          actions: 'updateActiveElementAction',
        },
        ADD_KEY_HANDLER: {
          actions: 'addKeyHandlerAction',
        },
        REMOVE_KEY_HANDLER: {
          actions: 'removeKeyHandlerAction',
        },
      },
    },
  },
});

/**
 * Keyboard Navigation State Machine Types
 */

export type KeyboardNavigationActor = Actor<typeof keyboardNavigationMachine>;
export type KeyboardNavigationSnapshot = SnapshotFrom<typeof keyboardNavigationMachine>;

/**
 * Keyboard Navigation Helper
 * Provides reactive keyboard navigation for templates
 */

export class KeyboardNavigationHelper {
  private actor: KeyboardNavigationActor;
  private snapshot: KeyboardNavigationSnapshot;
  private focusSnapshot: FocusManagementSnapshot | null;

  constructor(
    actor: KeyboardNavigationActor,
    snapshot: KeyboardNavigationSnapshot,
    focusSnapshot?: FocusManagementSnapshot
  ) {
    this.actor = actor;
    this.snapshot = snapshot;
    this.focusSnapshot = focusSnapshot || null;
  }

  /**
   * Check if keyboard navigation is enabled
   */
  isEnabled(): boolean {
    return this.snapshot.context.isEnabled;
  }

  /**
   * Get current orientation
   */
  getOrientation(): 'horizontal' | 'vertical' | 'both' {
    return this.snapshot.context.orientation;
  }

  /**
   * Get keyboard navigation attributes for template
   */
  getKeyboardAttributes(): string {
    const attributes: string[] = [];

    if (this.snapshot.context.isEnabled) {
      attributes.push('data-keyboard-navigation="enabled"');
      attributes.push(`data-orientation="${this.snapshot.context.orientation}"`);
      attributes.push(`data-wrap="${this.snapshot.context.wrap}"`);
      attributes.push(`data-activate-on-focus="${this.snapshot.context.activateOnFocus}"`);

      if (this.snapshot.context.rovingTabIndex) {
        attributes.push('data-roving-tabindex="true"');
      }

      if (this.snapshot.context.homeEndEnabled) {
        attributes.push('data-home-end="true"');
      }

      if (this.snapshot.context.typeaheadEnabled) {
        attributes.push('data-typeahead="true"');
      }
    }

    return attributes.join(' ');
  }

  /**
   * Get item attributes for keyboard navigation
   */
  getItemAttributes(index: number, isActive = false): string {
    const attributes: string[] = [];

    if (this.snapshot.context.isEnabled) {
      attributes.push(`data-keyboard-index="${index}"`);

      if (this.snapshot.context.rovingTabIndex) {
        attributes.push(`tabindex="${isActive ? '0' : '-1'}"`);
      }

      if (isActive) {
        attributes.push('data-keyboard-active="true"');
      }
    }

    return attributes.join(' ');
  }

  /**
   * Handle keyboard event
   */
  handleKeyboardEvent(event: KeyboardEvent): void {
    const { key, ctrlKey, altKey, metaKey } = event;

    // Check custom key handlers first
    const customHandler = this.snapshot.context.keyHandlers.get(key);
    if (customHandler) {
      customHandler(event);
      return;
    }

    // Handle standard navigation keys
    this.actor.send({ type: 'HANDLE_KEYDOWN', event });

    switch (key) {
      case 'ArrowUp':
        this.actor.send({ type: 'HANDLE_ARROW_KEY', direction: 'up', event });
        break;
      case 'ArrowDown':
        this.actor.send({ type: 'HANDLE_ARROW_KEY', direction: 'down', event });
        break;
      case 'ArrowLeft':
        this.actor.send({ type: 'HANDLE_ARROW_KEY', direction: 'left', event });
        break;
      case 'ArrowRight':
        this.actor.send({ type: 'HANDLE_ARROW_KEY', direction: 'right', event });
        break;
      case 'Home':
        this.actor.send({ type: 'HANDLE_HOME_END', key: 'Home', event });
        break;
      case 'End':
        this.actor.send({ type: 'HANDLE_HOME_END', key: 'End', event });
        break;
      case 'Enter':
      case ' ':
        this.actor.send({ type: 'ACTIVATE_CURRENT_ELEMENT' });
        break;
      default:
        // Handle typeahead for single character keys
        if (key.length === 1 && !ctrlKey && !altKey && !metaKey) {
          this.actor.send({ type: 'HANDLE_TYPEAHEAD', character: key, event });
        }
        break;
    }
  }

  /**
   * Configuration methods
   */
  enableNavigation(container: HTMLElement, focusActor?: FocusManagementActor): void {
    this.actor.send({ type: 'ENABLE_NAVIGATION', container, focusActor });
  }

  disableNavigation(): void {
    this.actor.send({ type: 'DISABLE_NAVIGATION' });
  }

  setOrientation(orientation: 'horizontal' | 'vertical' | 'both'): void {
    this.actor.send({ type: 'SET_ORIENTATION', orientation });
  }

  setWrap(wrap: boolean): void {
    this.actor.send({ type: 'SET_WRAP', wrap });
  }

  setActivateOnFocus(activateOnFocus: boolean): void {
    this.actor.send({ type: 'SET_ACTIVATE_ON_FOCUS', activateOnFocus });
  }

  setRovingTabIndex(enabled: boolean): void {
    this.actor.send({ type: 'SET_ROVING_TAB_INDEX', enabled });
  }

  setHomeEndEnabled(enabled: boolean): void {
    this.actor.send({ type: 'SET_HOME_END_ENABLED', enabled });
  }

  setTypeaheadEnabled(enabled: boolean): void {
    this.actor.send({ type: 'SET_TYPEAHEAD_ENABLED', enabled });
  }

  addKeyHandler(key: string, handler: (event: KeyboardEvent) => void): void {
    this.actor.send({ type: 'ADD_KEY_HANDLER', key, handler });
  }

  removeKeyHandler(key: string): void {
    this.actor.send({ type: 'REMOVE_KEY_HANDLER', key });
  }

  updateActiveElement(element: HTMLElement): void {
    this.actor.send({ type: 'UPDATE_ACTIVE_ELEMENT', element });
  }
}

/**
 * Keyboard Navigation Configuration
 */

export interface KeyboardNavigationConfig {
  orientation?: 'horizontal' | 'vertical' | 'both';
  wrap?: boolean;
  activateOnFocus?: boolean;
  rovingTabIndex?: boolean;
  homeEndEnabled?: boolean;
  typeaheadEnabled?: boolean;
  preventDefaultKeys?: string[];
  customKeyHandlers?: Map<string, (event: KeyboardEvent) => void>;
}

/**
 * Default Keyboard Navigation Configurations
 */

export const DefaultKeyboardConfigs = {
  menu: {
    orientation: 'vertical' as const,
    wrap: true,
    activateOnFocus: true,
    rovingTabIndex: true,
    homeEndEnabled: true,
    typeaheadEnabled: true,
    preventDefaultKeys: ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '],
  },

  tabs: {
    orientation: 'horizontal' as const,
    wrap: true,
    activateOnFocus: true,
    rovingTabIndex: true,
    homeEndEnabled: true,
    typeaheadEnabled: false,
    preventDefaultKeys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'],
  },

  listbox: {
    orientation: 'vertical' as const,
    wrap: true,
    activateOnFocus: true,
    rovingTabIndex: true,
    homeEndEnabled: true,
    typeaheadEnabled: true,
    preventDefaultKeys: ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '],
  },

  grid: {
    orientation: 'both' as const,
    wrap: false,
    activateOnFocus: false,
    rovingTabIndex: true,
    homeEndEnabled: true,
    typeaheadEnabled: false,
    preventDefaultKeys: [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'Enter',
      ' ',
    ],
  },

  toolbar: {
    orientation: 'horizontal' as const,
    wrap: true,
    activateOnFocus: false,
    rovingTabIndex: true,
    homeEndEnabled: true,
    typeaheadEnabled: false,
    preventDefaultKeys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'],
  },

  breadcrumb: {
    orientation: 'horizontal' as const,
    wrap: false,
    activateOnFocus: true,
    rovingTabIndex: true,
    homeEndEnabled: true,
    typeaheadEnabled: false,
    preventDefaultKeys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'],
  },
} as const;

export type DefaultKeyboardConfigType = keyof typeof DefaultKeyboardConfigs;

/**
 * Factory Functions
 */

export function createKeyboardNavigationHelper(
  actor: KeyboardNavigationActor,
  snapshot: KeyboardNavigationSnapshot,
  focusSnapshot?: FocusManagementSnapshot
): KeyboardNavigationHelper {
  return new KeyboardNavigationHelper(actor, snapshot, focusSnapshot);
}

export function createKeyboardNavigationConfig(
  type: DefaultKeyboardConfigType,
  overrides?: Partial<KeyboardNavigationConfig>
): KeyboardNavigationConfig {
  const config = DefaultKeyboardConfigs[type];
  return {
    ...config,
    preventDefaultKeys: [...(config.preventDefaultKeys || [])],
    ...overrides,
  };
}

/**
 * Keyboard Event Handler Factory
 * Creates reactive keyboard event handlers for templates
 */

export function createKeyboardEventHandler(
  keyboardHelper: KeyboardNavigationHelper
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    keyboardHelper.handleKeyboardEvent(event);
  };
}

/**
 * Integration with Template System
 * Provides reactive keyboard navigation in templates
 */

export interface KeyboardNavigationTemplateHelpers {
  getContainerAttributes(): string;
  getItemAttributes(index: number, isActive?: boolean): string;
  handleKeydown(event: KeyboardEvent): void;
  isEnabled(): boolean;
  getOrientation(): 'horizontal' | 'vertical' | 'both';
}

export function createKeyboardNavigationTemplateHelpers(
  helper: KeyboardNavigationHelper
): KeyboardNavigationTemplateHelpers {
  return {
    getContainerAttributes: () => helper.getKeyboardAttributes(),
    getItemAttributes: (index: number, isActive?: boolean) =>
      helper.getItemAttributes(index, isActive),
    handleKeydown: (event: KeyboardEvent) => helper.handleKeyboardEvent(event),
    isEnabled: () => helper.isEnabled(),
    getOrientation: () => helper.getOrientation(),
  };
}
