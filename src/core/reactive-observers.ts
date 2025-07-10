/**
 * Reactive Observers - XState-based DOM observer utilities
 *
 * Wraps IntersectionObserver, ResizeObserver, and MutationObserver in XState services
 * that provide automatic cleanup, lifecycle management, and integration with actor patterns.
 *
 * Part of Phase 0.7 Reactive Infrastructure
 */

import type { AnyEventObject } from 'xstate';
import { fromCallback } from 'xstate';

// ===== TYPE DEFINITIONS =====

export interface IntersectionObserverOptions {
  /** The element that is used as the viewport for checking visibility */
  root?: Element | Document | null;
  /** Margin around the root */
  rootMargin?: string;
  /** Threshold values for triggering callbacks */
  threshold?: number | number[];
  /** Optional data to pass with events */
  data?: unknown;
}

export interface ResizeObserverOptions {
  /** The box model to observe */
  box?: ResizeObserverBoxOptions;
  /** Optional data to pass with events */
  data?: unknown;
}

export interface MutationObserverOptions {
  /** Watch for attribute changes */
  attributes?: boolean;
  /** Specific attributes to watch */
  attributeFilter?: string[];
  /** Include old attribute values */
  attributeOldValue?: boolean;
  /** Watch for text content changes */
  characterData?: boolean;
  /** Include old character data values */
  characterDataOldValue?: boolean;
  /** Watch for child node changes */
  childList?: boolean;
  /** Watch descendants recursively */
  subtree?: boolean;
  /** Optional data to pass with events */
  data?: unknown;
}

export interface ObserverTarget {
  /** The element to observe */
  element: Element;
  /** Optional identifier for this target */
  id?: string;
}

// ===== INTERSECTION OBSERVER SERVICE =====

/**
 * Create an IntersectionObserver service for state machines
 * Emits INTERSECTION_CHANGE events when elements enter/exit viewport
 *
 * @example
 * ```typescript
 * const intersectionService = createIntersectionObserverService();
 *
 * const machine = setup({
 *   actors: { intersection: intersectionService }
 * }).createMachine({
 *   states: {
 *     observing: {
 *       invoke: {
 *         src: 'intersection',
 *         input: {
 *           targets: [{ element: myElement, id: 'hero' }],
 *           options: { threshold: 0.5 }
 *         }
 *       },
 *       on: {
 *         INTERSECTION_CHANGE: { actions: 'handleVisibilityChange' }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createIntersectionObserverService = () => {
  return fromCallback<
    AnyEventObject,
    {
      targets: ObserverTarget[];
      options?: IntersectionObserverOptions;
    }
  >(({ sendBack, input, receive }) => {
    const { targets, options = {} } = input;

    if (!targets || targets.length === 0) {
      sendBack({ type: 'OBSERVER_ERROR', error: 'No targets provided' });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = targets.find((t) => t.element === entry.target);

          sendBack({
            type: 'INTERSECTION_CHANGE',
            targetId: target?.id || 'unknown',
            element: entry.target,
            isIntersecting: entry.isIntersecting,
            intersectionRatio: entry.intersectionRatio,
            boundingClientRect: entry.boundingClientRect,
            intersectionRect: entry.intersectionRect,
            rootBounds: entry.rootBounds,
            time: entry.time,
            data: options.data || null,
          });
        });
      },
      {
        root: options.root,
        rootMargin: options.rootMargin,
        threshold: options.threshold,
      }
    );

    // Start observing all targets
    targets.forEach((target) => {
      observer.observe(target.element);
    });

    // Handle dynamic target changes
    receive((event) => {
      if (event.type === 'ADD_TARGET') {
        const { element, id } = event as { type: 'ADD_TARGET'; element: Element; id?: string };
        observer.observe(element);
        sendBack({ type: 'TARGET_ADDED', element, id });
      } else if (event.type === 'REMOVE_TARGET') {
        const { element } = event as { type: 'REMOVE_TARGET'; element: Element };
        observer.unobserve(element);
        sendBack({ type: 'TARGET_REMOVED', element });
      } else if (event.type === 'DISCONNECT') {
        observer.disconnect();
        sendBack({ type: 'OBSERVER_DISCONNECTED' });
      }
    });

    // Cleanup function
    return () => {
      observer.disconnect();
    };
  });
};

// ===== RESIZE OBSERVER SERVICE =====

/**
 * Create a ResizeObserver service for state machines
 * Emits RESIZE_CHANGE events when elements change size
 *
 * @example
 * ```typescript
 * const resizeService = createResizeObserverService();
 *
 * const machine = setup({
 *   actors: { resize: resizeService }
 * }).createMachine({
 *   states: {
 *     observing: {
 *       invoke: {
 *         src: 'resize',
 *         input: {
 *           targets: [{ element: containerElement, id: 'container' }],
 *           options: { box: 'border-box' }
 *         }
 *       },
 *       on: {
 *         RESIZE_CHANGE: { actions: 'handleSizeChange' }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createResizeObserverService = () => {
  return fromCallback<
    AnyEventObject,
    {
      targets: ObserverTarget[];
      options?: ResizeObserverOptions;
    }
  >(({ sendBack, input, receive }) => {
    const { targets, options = {} } = input;

    if (!targets || targets.length === 0) {
      sendBack({ type: 'OBSERVER_ERROR', error: 'No targets provided' });
      return;
    }

    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const target = targets.find((t) => t.element === entry.target);

        sendBack({
          type: 'RESIZE_CHANGE',
          targetId: target?.id || 'unknown',
          element: entry.target,
          contentRect: entry.contentRect,
          borderBoxSize: entry.borderBoxSize,
          contentBoxSize: entry.contentBoxSize,
          devicePixelContentBoxSize: entry.devicePixelContentBoxSize,
          data: options.data || null,
        });
      });
    });

    // Start observing all targets
    targets.forEach((target) => {
      observer.observe(target.element, options.box ? { box: options.box } : undefined);
    });

    // Handle dynamic target changes
    receive((event) => {
      if (event.type === 'ADD_TARGET') {
        const { element, id } = event as { type: 'ADD_TARGET'; element: Element; id?: string };
        observer.observe(element, options.box ? { box: options.box } : undefined);
        sendBack({ type: 'TARGET_ADDED', element, id });
      } else if (event.type === 'REMOVE_TARGET') {
        const { element } = event as { type: 'REMOVE_TARGET'; element: Element };
        observer.unobserve(element);
        sendBack({ type: 'TARGET_REMOVED', element });
      } else if (event.type === 'DISCONNECT') {
        observer.disconnect();
        sendBack({ type: 'OBSERVER_DISCONNECTED' });
      }
    });

    // Cleanup function
    return () => {
      observer.disconnect();
    };
  });
};

// ===== MUTATION OBSERVER SERVICE =====

/**
 * Create a MutationObserver service for state machines
 * Emits MUTATION_CHANGE events when DOM changes occur
 *
 * @example
 * ```typescript
 * const mutationService = createMutationObserverService();
 *
 * const machine = setup({
 *   actors: { mutation: mutationService }
 * }).createMachine({
 *   states: {
 *     observing: {
 *       invoke: {
 *         src: 'mutation',
 *         input: {
 *           targets: [{ element: formElement, id: 'form' }],
 *           options: {
 *             attributes: true,
 *             attributeFilter: ['data-state'],
 *             childList: true
 *           }
 *         }
 *       },
 *       on: {
 *         MUTATION_CHANGE: { actions: 'handleDOMChange' }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createMutationObserverService = () => {
  return fromCallback<
    AnyEventObject,
    {
      targets: ObserverTarget[];
      options?: MutationObserverOptions;
    }
  >(({ sendBack, input, receive }) => {
    const { targets, options = {} } = input;

    if (!targets || targets.length === 0) {
      sendBack({ type: 'OBSERVER_ERROR', error: 'No targets provided' });
      return;
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const target = targets.find(
          (t) => t.element === mutation.target || t.element.contains(mutation.target as Element)
        );

        sendBack({
          type: 'MUTATION_CHANGE',
          targetId: target?.id || 'unknown',
          mutationType: mutation.type,
          target: mutation.target,
          addedNodes: Array.from(mutation.addedNodes),
          removedNodes: Array.from(mutation.removedNodes),
          attributeName: mutation.attributeName,
          attributeNamespace: mutation.attributeNamespace,
          oldValue: mutation.oldValue,
          nextSibling: mutation.nextSibling,
          previousSibling: mutation.previousSibling,
          data: options.data || null,
        });
      });
    });

    // Start observing all targets
    const observerOptions: MutationObserverInit = {
      attributes: options.attributes,
      attributeFilter: options.attributeFilter,
      attributeOldValue: options.attributeOldValue,
      characterData: options.characterData,
      characterDataOldValue: options.characterDataOldValue,
      childList: options.childList,
      subtree: options.subtree,
    };

    targets.forEach((target) => {
      observer.observe(target.element, observerOptions);
    });

    // Handle dynamic target changes
    receive((event) => {
      if (event.type === 'ADD_TARGET') {
        const { element, id } = event as { type: 'ADD_TARGET'; element: Element; id?: string };
        observer.observe(element, observerOptions);
        sendBack({ type: 'TARGET_ADDED', element, id });
      } else if (event.type === 'REMOVE_TARGET') {
        const { element } = event as { type: 'REMOVE_TARGET'; element: Element };
        // MutationObserver doesn't have unobserve, so we need to disconnect and re-observe others
        observer.disconnect();
        targets
          .filter((t) => t.element !== element)
          .forEach((target) => {
            observer.observe(target.element, observerOptions);
          });
        sendBack({ type: 'TARGET_REMOVED', element });
      } else if (event.type === 'DISCONNECT') {
        observer.disconnect();
        sendBack({ type: 'OBSERVER_DISCONNECTED' });
      }
    });

    // Cleanup function
    return () => {
      observer.disconnect();
    };
  });
};

// ===== VISIBILITY TRACKING SERVICE =====

/**
 * Enhanced visibility service that combines IntersectionObserver with additional logic
 * for tracking element visibility state with enter/exit events
 *
 * @example
 * ```typescript
 * const visibilityService = createVisibilityTrackingService();
 *
 * const machine = setup({
 *   actors: { visibility: visibilityService }
 * }).createMachine({
 *   context: { visibleElements: new Set() },
 *   states: {
 *     tracking: {
 *       invoke: {
 *         src: 'visibility',
 *         input: {
 *           targets: [{ element: sectionElement, id: 'hero-section' }],
 *           options: { threshold: [0, 0.5, 1] }
 *         }
 *       },
 *       on: {
 *         ELEMENT_ENTERED: { actions: 'trackElementEntry' },
 *         ELEMENT_EXITED: { actions: 'trackElementExit' },
 *         VISIBILITY_CHANGED: { actions: 'updateVisibility' }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createVisibilityTrackingService = () => {
  return fromCallback<
    AnyEventObject,
    {
      targets: ObserverTarget[];
      options?: IntersectionObserverOptions & {
        /** Minimum intersection ratio to consider "visible" */
        visibilityThreshold?: number;
      };
    }
  >(({ sendBack, input, receive }) => {
    const { targets, options = {} } = input;
    const { visibilityThreshold = 0 } = options;

    if (!targets || targets.length === 0) {
      sendBack({ type: 'OBSERVER_ERROR', error: 'No targets provided' });
      return;
    }

    // Track visibility state for each element
    const visibilityMap = new Map<Element, boolean>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = targets.find((t) => t.element === entry.target);
          const targetId = target?.id || 'unknown';
          const wasVisible = visibilityMap.get(entry.target) || false;
          const isNowVisible = entry.intersectionRatio > visibilityThreshold;

          // Update visibility state
          visibilityMap.set(entry.target, isNowVisible);

          // Send general visibility change event
          sendBack({
            type: 'VISIBILITY_CHANGED',
            targetId,
            element: entry.target,
            isVisible: isNowVisible,
            intersectionRatio: entry.intersectionRatio,
            boundingClientRect: entry.boundingClientRect,
            time: entry.time,
            data: options.data || null,
          });

          // Send specific enter/exit events
          if (!wasVisible && isNowVisible) {
            sendBack({
              type: 'ELEMENT_ENTERED',
              targetId,
              element: entry.target,
              intersectionRatio: entry.intersectionRatio,
              time: entry.time,
              data: options.data || null,
            });
          } else if (wasVisible && !isNowVisible) {
            sendBack({
              type: 'ELEMENT_EXITED',
              targetId,
              element: entry.target,
              intersectionRatio: entry.intersectionRatio,
              time: entry.time,
              data: options.data || null,
            });
          }
        });
      },
      {
        root: options.root,
        rootMargin: options.rootMargin,
        threshold: options.threshold,
      }
    );

    // Start observing all targets
    targets.forEach((target) => {
      observer.observe(target.element);
      visibilityMap.set(target.element, false); // Initialize as not visible
    });

    // Handle dynamic target changes
    receive((event) => {
      if (event.type === 'ADD_TARGET') {
        const { element, id } = event as { type: 'ADD_TARGET'; element: Element; id?: string };
        observer.observe(element);
        visibilityMap.set(element, false);
        sendBack({ type: 'TARGET_ADDED', element, id });
      } else if (event.type === 'REMOVE_TARGET') {
        const { element } = event as { type: 'REMOVE_TARGET'; element: Element };
        observer.unobserve(element);
        visibilityMap.delete(element);
        sendBack({ type: 'TARGET_REMOVED', element });
      } else if (event.type === 'DISCONNECT') {
        observer.disconnect();
        visibilityMap.clear();
        sendBack({ type: 'OBSERVER_DISCONNECTED' });
      }
    });

    // Cleanup function
    return () => {
      observer.disconnect();
      visibilityMap.clear();
    };
  });
};

// ===== EXPORT ALL SERVICES =====

/**
 * Pre-configured observer services for common use cases
 */
export const ObserverServices = {
  intersection: createIntersectionObserverService(),
  resize: createResizeObserverService(),
  mutation: createMutationObserverService(),
  visibility: createVisibilityTrackingService(),
} as const;

// ===== UTILITY FUNCTIONS =====

/**
 * Create multiple observer targets from a CSS selector
 */
export const createTargetsFromSelector = (
  selector: string,
  idPrefix = 'element'
): ObserverTarget[] => {
  const elements = document.querySelectorAll(selector);
  return Array.from(elements).map((element, index) => ({
    element: element as Element,
    id: `${idPrefix}-${index}`,
  }));
};

/**
 * Create a single observer target from an element
 */
export const createTarget = (element: Element, id?: string): ObserverTarget => ({
  element,
  id: id || `element-${Date.now()}`,
});

// ===== DEFAULT EXPORT =====

export default ObserverServices;
