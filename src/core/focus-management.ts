/**
 * Reactive Focus Management System
 * XState-based focus management that follows reactive patterns
 */

import { type Actor, assign, type SnapshotFrom, setup } from 'xstate';
import type { FocusOptions } from './accessibility-utilities.js';

/**
 * Focus Management Types
 */

export interface FocusContext {
  currentFocusElement: HTMLElement | null;
  focusHistory: HTMLElement[];
  trapContainer: HTMLElement | null;
  focusableElements: HTMLElement[];
  rovingTabIndex: number;
  restoreTarget: HTMLElement | null;
  isTrapped: boolean;
  skipRestoration: boolean;
}

export type FocusEvent =
  | { type: 'FOCUS_ELEMENT'; element: HTMLElement; options?: FocusOptions }
  | { type: 'TRAP_FOCUS'; container: HTMLElement }
  | { type: 'RELEASE_TRAP' }
  | { type: 'RESTORE_FOCUS' }
  | { type: 'MOVE_TO_NEXT' }
  | { type: 'MOVE_TO_PREVIOUS' }
  | { type: 'MOVE_TO_FIRST' }
  | { type: 'MOVE_TO_LAST' }
  | { type: 'UPDATE_FOCUSABLE_ELEMENTS' }
  | { type: 'ROVING_TAB_NEXT' }
  | { type: 'ROVING_TAB_PREVIOUS' }
  | { type: 'KEYBOARD_NAVIGATION'; key: string; shiftKey: boolean };

/**
 * Focus Management State Machine
 */

export const focusManagementMachine = setup({
  types: {
    context: {} as FocusContext,
    events: {} as FocusEvent,
  },
  guards: {
    canFocusElement: ({ event }) => {
      if (event.type !== 'FOCUS_ELEMENT') return false;
      return isFocusable(event.element);
    },
    hasFocusHistory: ({ context }) => context.focusHistory.length > 0,
    isFocusTrapped: ({ context }) => context.isTrapped,
    hasFocusableElements: ({ context }) => context.focusableElements.length > 0,
    isValidTabIndex: ({ context }) => {
      return (
        context.rovingTabIndex >= 0 && context.rovingTabIndex < context.focusableElements.length
      );
    },
  },
  actions: {
    focusElementAction: assign({
      currentFocusElement: ({ event, context }) => {
        if (event.type !== 'FOCUS_ELEMENT') return context.currentFocusElement;

        const { element, options } = event;

        // Add to history if restoreFocus is enabled
        if (options?.restoreFocus && context.currentFocusElement) {
          context.focusHistory.push(context.currentFocusElement);
        }

        // Set restore target if not already set
        if (!context.restoreTarget && context.currentFocusElement) {
          return element;
        }

        return element;
      },
      restoreTarget: ({ event, context }) => {
        if (event.type !== 'FOCUS_ELEMENT') return context.restoreTarget;

        const { options } = event;

        if (options?.restoreFocus && context.currentFocusElement && !context.restoreTarget) {
          return context.currentFocusElement;
        }

        return context.restoreTarget;
      },
    }),

    trapFocusAction: assign({
      trapContainer: ({ event }) => {
        if (event.type !== 'TRAP_FOCUS') return null;
        return event.container;
      },
      focusableElements: ({ event }) => {
        if (event.type !== 'TRAP_FOCUS') return [];
        return getFocusableElements(event.container);
      },
      isTrapped: true,
      rovingTabIndex: 0,
    }),

    releaseTrapAction: assign({
      trapContainer: null,
      focusableElements: [],
      isTrapped: false,
      rovingTabIndex: -1,
    }),

    restoreFocusAction: assign({
      currentFocusElement: ({ context }) => {
        if (context.focusHistory.length > 0) {
          return context.focusHistory[context.focusHistory.length - 1];
        }
        return context.restoreTarget;
      },
      focusHistory: ({ context }) => {
        if (context.focusHistory.length > 0) {
          return context.focusHistory.slice(0, -1);
        }
        return context.focusHistory;
      },
      restoreTarget: ({ context }) => {
        if (context.focusHistory.length > 1) {
          return context.focusHistory[context.focusHistory.length - 2];
        }
        return null;
      },
    }),

    moveToNextAction: assign({
      rovingTabIndex: ({ context }) => {
        if (context.focusableElements.length === 0) return context.rovingTabIndex;

        const nextIndex = context.rovingTabIndex + 1;
        return nextIndex < context.focusableElements.length ? nextIndex : 0;
      },
      currentFocusElement: ({ context }) => {
        if (context.focusableElements.length === 0) return context.currentFocusElement;

        const nextIndex = context.rovingTabIndex + 1;
        const wrappedIndex = nextIndex < context.focusableElements.length ? nextIndex : 0;
        return context.focusableElements[wrappedIndex];
      },
    }),

    moveToPreviousAction: assign({
      rovingTabIndex: ({ context }) => {
        if (context.focusableElements.length === 0) return context.rovingTabIndex;

        const prevIndex = context.rovingTabIndex - 1;
        return prevIndex >= 0 ? prevIndex : context.focusableElements.length - 1;
      },
      currentFocusElement: ({ context }) => {
        if (context.focusableElements.length === 0) return context.currentFocusElement;

        const prevIndex = context.rovingTabIndex - 1;
        const wrappedIndex = prevIndex >= 0 ? prevIndex : context.focusableElements.length - 1;
        return context.focusableElements[wrappedIndex];
      },
    }),

    moveToFirstAction: assign({
      rovingTabIndex: 0,
      currentFocusElement: ({ context }) => {
        return context.focusableElements.length > 0
          ? context.focusableElements[0]
          : context.currentFocusElement;
      },
    }),

    moveToLastAction: assign({
      rovingTabIndex: ({ context }) => Math.max(0, context.focusableElements.length - 1),
      currentFocusElement: ({ context }) => {
        const lastIndex = context.focusableElements.length - 1;
        return lastIndex >= 0 ? context.focusableElements[lastIndex] : context.currentFocusElement;
      },
    }),

    updateFocusableElementsAction: assign({
      focusableElements: ({ context }) => {
        if (!context.trapContainer) return context.focusableElements;
        return getFocusableElements(context.trapContainer);
      },
    }),

    handleKeyboardNavigationAction: assign({
      rovingTabIndex: ({ event, context }) => {
        if (event.type !== 'KEYBOARD_NAVIGATION') return context.rovingTabIndex;

        const { key, shiftKey } = event;

        switch (key) {
          case 'ArrowDown':
          case 'ArrowRight':
            return (context.rovingTabIndex + 1) % context.focusableElements.length;
          case 'ArrowUp':
          case 'ArrowLeft':
            return context.rovingTabIndex === 0
              ? context.focusableElements.length - 1
              : context.rovingTabIndex - 1;
          case 'Home':
            return 0;
          case 'End':
            return context.focusableElements.length - 1;
          case 'Tab':
            if (shiftKey) {
              return context.rovingTabIndex === 0
                ? context.focusableElements.length - 1
                : context.rovingTabIndex - 1;
            }
            return (context.rovingTabIndex + 1) % context.focusableElements.length;
          default:
            return context.rovingTabIndex;
        }
      },
      currentFocusElement: ({ event, context }) => {
        if (event.type !== 'KEYBOARD_NAVIGATION') return context.currentFocusElement;

        const { key, shiftKey } = event;

        let newIndex = context.rovingTabIndex;

        switch (key) {
          case 'ArrowDown':
          case 'ArrowRight':
            newIndex = (context.rovingTabIndex + 1) % context.focusableElements.length;
            break;
          case 'ArrowUp':
          case 'ArrowLeft':
            newIndex =
              context.rovingTabIndex === 0
                ? context.focusableElements.length - 1
                : context.rovingTabIndex - 1;
            break;
          case 'Home':
            newIndex = 0;
            break;
          case 'End':
            newIndex = context.focusableElements.length - 1;
            break;
          case 'Tab':
            if (shiftKey) {
              newIndex =
                context.rovingTabIndex === 0
                  ? context.focusableElements.length - 1
                  : context.rovingTabIndex - 1;
            } else {
              newIndex = (context.rovingTabIndex + 1) % context.focusableElements.length;
            }
            break;
        }

        return context.focusableElements[newIndex] || context.currentFocusElement;
      },
    }),
  },
}).createMachine({
  id: 'focusManagement',
  initial: 'idle',
  context: {
    currentFocusElement: null,
    focusHistory: [],
    trapContainer: null,
    focusableElements: [],
    rovingTabIndex: -1,
    restoreTarget: null,
    isTrapped: false,
    skipRestoration: false,
  },
  states: {
    idle: {
      on: {
        FOCUS_ELEMENT: [
          {
            guard: 'canFocusElement',
            target: 'focused',
            actions: 'focusElementAction',
          },
        ],
        TRAP_FOCUS: {
          target: 'trapped',
          actions: 'trapFocusAction',
        },
      },
    },
    focused: {
      on: {
        FOCUS_ELEMENT: [
          {
            guard: 'canFocusElement',
            actions: 'focusElementAction',
          },
        ],
        RESTORE_FOCUS: [
          {
            guard: 'hasFocusHistory',
            actions: 'restoreFocusAction',
          },
        ],
        TRAP_FOCUS: {
          target: 'trapped',
          actions: 'trapFocusAction',
        },
      },
    },
    trapped: {
      on: {
        RELEASE_TRAP: {
          target: 'focused',
          actions: 'releaseTrapAction',
        },
        MOVE_TO_NEXT: [
          {
            guard: 'hasFocusableElements',
            actions: 'moveToNextAction',
          },
        ],
        MOVE_TO_PREVIOUS: [
          {
            guard: 'hasFocusableElements',
            actions: 'moveToPreviousAction',
          },
        ],
        MOVE_TO_FIRST: [
          {
            guard: 'hasFocusableElements',
            actions: 'moveToFirstAction',
          },
        ],
        MOVE_TO_LAST: [
          {
            guard: 'hasFocusableElements',
            actions: 'moveToLastAction',
          },
        ],
        UPDATE_FOCUSABLE_ELEMENTS: {
          actions: 'updateFocusableElementsAction',
        },
        KEYBOARD_NAVIGATION: [
          {
            guard: 'hasFocusableElements',
            actions: 'handleKeyboardNavigationAction',
          },
        ],
      },
    },
  },
});

/**
 * Focus Management State Machine Type
 */

export type FocusManagementActor = Actor<typeof focusManagementMachine>;
export type FocusManagementSnapshot = SnapshotFrom<typeof focusManagementMachine>;

/**
 * Pure Focus Utility Functions
 * These functions don't violate reactive patterns
 */

export function isFocusable(element: HTMLElement): boolean {
  if (!element || element.offsetParent === null) return false;
  if (element.hasAttribute('disabled')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (element.tabIndex < 0) return false;

  const style = window.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;

  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    '[contenteditable="true"]',
  ].join(', ');

  return Array.from(container.querySelectorAll(focusableSelectors)).filter((element) =>
    isFocusable(element as HTMLElement)
  ) as HTMLElement[];
}

export function getFirstFocusableElement(container: HTMLElement): HTMLElement | null {
  const focusableElements = getFocusableElements(container);
  return focusableElements[0] || null;
}

export function getLastFocusableElement(container: HTMLElement): HTMLElement | null {
  const focusableElements = getFocusableElements(container);
  return focusableElements[focusableElements.length - 1] || null;
}

/**
 * Focus Management Template Helper
 * Provides reactive focus management for templates
 */

export class FocusManagementHelper {
  private actor: FocusManagementActor;
  private snapshot: FocusManagementSnapshot;

  constructor(actor: FocusManagementActor, snapshot: FocusManagementSnapshot) {
    this.actor = actor;
    this.snapshot = snapshot;
  }

  /**
   * Get current focus target element
   */
  getCurrentFocusTarget(): HTMLElement | null {
    return this.snapshot.context.currentFocusElement;
  }

  /**
   * Check if focus is trapped
   */
  isFocusTrapped(): boolean {
    return this.snapshot.context.isTrapped;
  }

  /**
   * Get focusable elements in current trap
   */
  getFocusableElements(): HTMLElement[] {
    return this.snapshot.context.focusableElements;
  }

  /**
   * Get current roving tab index
   */
  getRovingTabIndex(): number {
    return this.snapshot.context.rovingTabIndex;
  }

  /**
   * Get template attributes for focus management
   */
  getFocusAttributes(elementIndex?: number): string {
    const attributes: string[] = [];

    if (this.snapshot.context.isTrapped) {
      attributes.push('data-focus-trapped="true"');

      if (elementIndex !== undefined) {
        const isActive = elementIndex === this.snapshot.context.rovingTabIndex;
        attributes.push(`tabindex="${isActive ? '0' : '-1'}"`);
        attributes.push(`data-focus-index="${elementIndex}"`);

        if (isActive) {
          attributes.push('data-focus-active="true"');
        }
      }
    }

    return attributes.join(' ');
  }

  /**
   * Get keyboard navigation attributes
   */
  getKeyboardNavigationAttributes(
    orientation: 'horizontal' | 'vertical' | 'both' = 'vertical'
  ): string {
    const attributes: string[] = [];

    attributes.push(`data-keyboard-orientation="${orientation}"`);

    if (this.snapshot.context.isTrapped) {
      attributes.push('data-keyboard-trapped="true"');
    }

    return attributes.join(' ');
  }

  /**
   * Send focus management events
   */
  focusElement(element: HTMLElement, options?: FocusOptions): void {
    this.actor.send({ type: 'FOCUS_ELEMENT', element, options });
  }

  trapFocus(container: HTMLElement): void {
    this.actor.send({ type: 'TRAP_FOCUS', container });
  }

  releaseFocusTrap(): void {
    this.actor.send({ type: 'RELEASE_TRAP' });
  }

  restoreFocus(): void {
    this.actor.send({ type: 'RESTORE_FOCUS' });
  }

  moveToNext(): void {
    this.actor.send({ type: 'MOVE_TO_NEXT' });
  }

  moveToPrevious(): void {
    this.actor.send({ type: 'MOVE_TO_PREVIOUS' });
  }

  moveToFirst(): void {
    this.actor.send({ type: 'MOVE_TO_FIRST' });
  }

  moveToLast(): void {
    this.actor.send({ type: 'MOVE_TO_LAST' });
  }

  handleKeyboardNavigation(key: string, shiftKey = false): void {
    this.actor.send({ type: 'KEYBOARD_NAVIGATION', key, shiftKey });
  }

  updateFocusableElements(): void {
    this.actor.send({ type: 'UPDATE_FOCUSABLE_ELEMENTS' });
  }
}

/**
 * Focus Management Configuration
 * Configuration for different focus management patterns
 */

export interface FocusManagementConfig {
  trapFocus?: boolean;
  restoreFocus?: boolean;
  rovingTabIndex?: boolean;
  keyboardNavigation?: {
    orientation?: 'horizontal' | 'vertical' | 'both';
    wrap?: boolean;
    activateOnFocus?: boolean;
  };
  initialFocus?: 'first' | 'last' | HTMLElement;
  skipRestoration?: boolean;
}

/**
 * Default Focus Management Configurations
 */

export const DefaultFocusConfigs = {
  modal: {
    trapFocus: true,
    restoreFocus: true,
    rovingTabIndex: false,
    keyboardNavigation: {
      orientation: 'vertical' as const,
      wrap: true,
      activateOnFocus: false,
    },
    initialFocus: 'first' as const,
    skipRestoration: false,
  },

  menu: {
    trapFocus: true,
    restoreFocus: true,
    rovingTabIndex: true,
    keyboardNavigation: {
      orientation: 'vertical' as const,
      wrap: true,
      activateOnFocus: true,
    },
    initialFocus: 'first' as const,
    skipRestoration: false,
  },

  tabs: {
    trapFocus: false,
    restoreFocus: false,
    rovingTabIndex: true,
    keyboardNavigation: {
      orientation: 'horizontal' as const,
      wrap: true,
      activateOnFocus: true,
    },
    initialFocus: 'first' as const,
    skipRestoration: false,
  },

  listbox: {
    trapFocus: true,
    restoreFocus: true,
    rovingTabIndex: true,
    keyboardNavigation: {
      orientation: 'vertical' as const,
      wrap: true,
      activateOnFocus: true,
    },
    initialFocus: 'first' as const,
    skipRestoration: false,
  },

  grid: {
    trapFocus: true,
    restoreFocus: true,
    rovingTabIndex: true,
    keyboardNavigation: {
      orientation: 'both' as const,
      wrap: false,
      activateOnFocus: false,
    },
    initialFocus: 'first' as const,
    skipRestoration: false,
  },
} as const;

export type DefaultFocusConfigType = keyof typeof DefaultFocusConfigs;

/**
 * Factory Function
 * Create focus management helper
 */

export function createFocusManagementHelper(
  actor: FocusManagementActor,
  snapshot: FocusManagementSnapshot
): FocusManagementHelper {
  return new FocusManagementHelper(actor, snapshot);
}
