/**
 * AriaObserver - Automatic ARIA attribute synchronization
 *
 * Watches for data-* attribute changes and automatically updates corresponding
 * ARIA attributes based on configurable mappings.
 *
 * @example
 * ```typescript
 * const observer = new AriaObserver(element, {
 *   'data-expanded': { 'aria-expanded': (value) => value },
 *   'data-state': {
 *     'aria-hidden': (value) => value === 'closed',
 *     'aria-expanded': (value) => value === 'open'
 *   }
 * });
 * ```
 */

export interface AriaMapping {
  [dataAttribute: string]: {
    [ariaAttribute: string]: (value: string) => string | boolean | null;
  };
}

export interface AriaObserverOptions {
  /** Custom attribute mappings */
  mappings?: AriaMapping;
  /** Whether to use default mappings */
  useDefaults?: boolean;
  /** Attributes to observe (defaults to all data-* attributes) */
  attributeFilter?: string[];
  /** Debug mode for logging */
  debug?: boolean;
}

export class AriaObserver {
  private static defaultMappings: AriaMapping = {
    // State mappings
    'data-state': {
      'aria-hidden': (value) => value === 'closed' || value === 'hidden',
      'aria-expanded': (value) => value === 'open' || value === 'expanded',
      'aria-busy': (value) => value === 'loading' || value === 'pending',
      'aria-disabled': (value) => value === 'disabled',
      'aria-invalid': (value) => value === 'error',
      'aria-selected': (value) => value === 'selected',
      'aria-checked': (value) => value === 'checked',
    },

    // Loading state
    'data-loading': {
      'aria-busy': (value) => value === 'true',
      'aria-live': (value) => (value === 'true' ? 'polite' : null),
    },

    // Error state
    'data-error': {
      'aria-invalid': (value) => value === 'true',
      'aria-describedby': (value) => (value === 'true' ? 'error-message' : null),
    },

    // Interactive states
    'data-pressed': {
      'aria-pressed': (value) => value,
    },

    'data-expanded': {
      'aria-expanded': (value) => value,
    },

    'data-selected': {
      'aria-selected': (value) => value,
    },

    'data-checked': {
      'aria-checked': (value) => value,
    },

    // Navigation states
    'data-current': {
      'aria-current': (value) => (value === 'true' ? 'page' : null),
    },

    // Form states
    'data-required': {
      'aria-required': (value) => value,
    },

    'data-readonly': {
      'aria-readonly': (value) => value,
    },

    // Modal/Dialog states
    'data-modal': {
      'aria-modal': (value) => value,
      role: (value) => (value === 'true' ? 'dialog' : null),
    },

    // Visibility states
    'data-visible': {
      'aria-hidden': (value) => value === 'false',
    },
  };

  private mutationObserver: MutationObserver | null = null;
  private observedElements = new WeakSet<Element>();

  /**
   * State-to-ARIA mapping configuration
   * Maps data-state values to their corresponding ARIA attributes
   */
  private readonly stateToAriaMap: Record<
    string,
    {
      attribute: string;
      value: (state: string) => string;
      condition?: (state: string) => boolean;
    }
  > = {
    loading: {
      attribute: 'aria-busy',
      value: () => 'true',
      condition: (state) => state.includes('loading'),
    },
    submitting: {
      attribute: 'aria-busy',
      value: () => 'true',
      condition: (state) => state.includes('submitting'),
    },
    disabled: {
      attribute: 'aria-disabled',
      value: () => 'true',
      condition: (state) => state.includes('disabled'),
    },
    enabled: {
      attribute: 'aria-disabled',
      value: () => 'false',
      condition: (state) => state.includes('enabled'),
    },
    expanded: {
      attribute: 'aria-expanded',
      value: () => 'true',
      condition: (state) => state.includes('expanded'),
    },
    collapsed: {
      attribute: 'aria-expanded',
      value: () => 'false',
      condition: (state) => state.includes('collapsed'),
    },
    open: {
      attribute: 'aria-expanded',
      value: () => 'true',
      condition: (state) => state.includes('open') && !state.includes('opening'),
    },
    closed: {
      attribute: 'aria-expanded',
      value: () => 'false',
      condition: (state) => state.includes('closed') && !state.includes('closing'),
    },
    selected: {
      attribute: 'aria-selected',
      value: () => 'true',
      condition: (state) => state.includes('selected'),
    },
    unselected: {
      attribute: 'aria-selected',
      value: () => 'false',
      condition: (state) => state.includes('unselected'),
    },
    checked: {
      attribute: 'aria-checked',
      value: () => 'true',
      condition: (state) => state.includes('checked'),
    },
    unchecked: {
      attribute: 'aria-checked',
      value: () => 'false',
      condition: (state) => state.includes('unchecked'),
    },
    hidden: {
      attribute: 'aria-hidden',
      value: () => 'true',
      condition: (state) => state.includes('hidden'),
    },
    visible: {
      attribute: 'aria-hidden',
      value: () => 'false',
      condition: (state) => state.includes('visible'),
    },
    error: {
      attribute: 'aria-invalid',
      value: () => 'true',
      condition: (state) => state.includes('error') || state.includes('invalid'),
    },
    valid: {
      attribute: 'aria-invalid',
      value: () => 'false',
      condition: (state) => state.includes('valid'),
    },
    required: {
      attribute: 'aria-required',
      value: () => 'true',
      condition: (state) => state.includes('required'),
    },
    optional: {
      attribute: 'aria-required',
      value: () => 'false',
      condition: (state) => state.includes('optional'),
    },
    active: {
      attribute: 'aria-current',
      value: () => 'true',
      condition: (state) => state.includes('active'),
    },
    inactive: {
      attribute: 'aria-current',
      value: () => 'false',
      condition: (state) => state.includes('inactive'),
    },
  };

  constructor() {
    this.setupMutationObserver();
  }

  /**
   * Start observing an element and its descendants
   */
  public observe(element: Element): void {
    if (!this.mutationObserver) {
      return;
    }

    // Initial setup for existing elements
    this.processElement(element);

    // Observe for future changes
    this.mutationObserver.observe(element, {
      attributes: true,
      attributeFilter: ['data-state'],
      subtree: true,
      childList: true,
    });
  }

  /**
   * Stop observing all elements
   */
  public disconnect(): void {
    this.mutationObserver?.disconnect();
    this.observedElements = new WeakSet();
  }

  /**
   * Setup the mutation observer
   */
  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          this.updateAriaAttributes(mutation.target);
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              this.processElement(node);
            }
          });
        }
      }
    });
  }

  /**
   * Process an element and its descendants
   */
  private processElement(element: Element): void {
    // Process the element itself
    if (element.hasAttribute('data-state')) {
      this.updateAriaAttributes(element);
      this.observedElements.add(element);
    }

    // Process all descendants with data-state
    element.querySelectorAll('[data-state]').forEach((child) => {
      this.updateAriaAttributes(child);
      this.observedElements.add(child);
    });
  }

  /**
   * Update ARIA attributes based on data-state value
   */
  private updateAriaAttributes(element: Element): void {
    const state = element.getAttribute('data-state');
    if (!state) {
      return;
    }

    // Track which ARIA attributes have been set
    const setAttributes = new Set<string>();

    // Apply all matching state mappings
    for (const [_key, mapping] of Object.entries(this.stateToAriaMap)) {
      if (mapping.condition?.(state)) {
        const value = mapping.value(state);
        element.setAttribute(mapping.attribute, value);
        setAttributes.add(mapping.attribute);
      }
    }

    // Special handling for form elements
    if (
      element.tagName === 'INPUT' ||
      element.tagName === 'SELECT' ||
      element.tagName === 'TEXTAREA'
    ) {
      this.handleFormElementStates(element, state);
    }

    // Special handling for navigation elements
    if (element.tagName === 'NAV' || element.getAttribute('role') === 'navigation') {
      this.handleNavigationStates(element, state);
    }

    // Special handling for dialog/modal elements
    if (element.getAttribute('role') === 'dialog' || element.classList.contains('modal')) {
      this.handleDialogStates(element, state);
    }

    // Log changes in development
    if (this.isDevelopment()) {
    }
  }

  /**
   * Handle form-specific ARIA states
   */
  private handleFormElementStates(element: Element, state: string): void {
    // Add form-specific ARIA handling
    if (state.includes('invalid') || state.includes('error')) {
      // Set error message association if available
      const errorId = element.getAttribute('data-error-id');
      if (errorId) {
        element.setAttribute('aria-describedby', errorId);
      }
    }

    // Handle readonly state
    if (state.includes('readonly')) {
      element.setAttribute('aria-readonly', 'true');
    }
  }

  /**
   * Handle navigation-specific ARIA states
   */
  private handleNavigationStates(element: Element, _state: string): void {
    // Ensure navigation has appropriate label
    if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) {
      element.setAttribute('aria-label', 'Main navigation');
    }
  }

  /**
   * Handle dialog/modal-specific ARIA states
   */
  private handleDialogStates(element: Element, state: string): void {
    if (state.includes('open') || state.includes('visible')) {
      element.setAttribute('aria-modal', 'true');
      // Ensure dialog has appropriate label
      if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) {
        const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
        if (heading?.id) {
          element.setAttribute('aria-labelledby', heading.id);
        }
      }
    }
  }

  /**
   * Check if we're in development mode
   */
  private isDevelopment(): boolean {
    return (
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    );
  }

  /**
   * Create a global singleton instance
   */
  public static createGlobal(): AriaObserver {
    if (typeof window !== 'undefined' && !window.ariaObserver) {
      window.ariaObserver = new AriaObserver();

      // Auto-start observing when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          window.ariaObserver.observe(document.body);
        });
      } else {
        window.ariaObserver.observe(document.body);
      }
    }

    return window.ariaObserver;
  }
}

// Type augmentation for global window object
declare global {
  interface Window {
    ariaObserver: AriaObserver;
  }
}
