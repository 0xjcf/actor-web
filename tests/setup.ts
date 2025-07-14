/**
 * @module tests/setup
 * @description Test setup for vitest with comprehensive cleanup
 * @author Agent C - 2025-07-10
 */

import { afterEach, beforeEach, vi } from 'vitest';

// Global cleanup to prevent test hangs and memory leaks

const activeDOMNodes = new Set<Element>();
let originalAppendChild: typeof Element.prototype.appendChild;

beforeEach(() => {
  // Store and wrap appendChild to track DOM nodes
  originalAppendChild = Element.prototype.appendChild;
  Element.prototype.appendChild = function <T extends Node>(node: T): T {
    if (node instanceof Element) {
      activeDOMNodes.add(node);
    }
    return originalAppendChild.call(this, node);
  };
});

afterEach(() => {
  // Clean up DOM nodes
  activeDOMNodes.forEach((node) => {
    try {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    } catch (_e) {
      // Node might already be removed
    }
  });
  activeDOMNodes.clear();

  // Clean up document.body completely
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }

  // Force cleanup of any remaining Vitest timers
  try {
    vi.runOnlyPendingTimers();
  } catch (_e) {
    // Ignore if not using fake timers
  }

  // Reset Element.prototype.appendChild to original
  Element.prototype.appendChild = originalAppendChild;
});
