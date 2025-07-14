/**
 * Behavior Tests for ARIA Observer - Actor-SPA Framework
 *
 * Focus: How ARIA attributes behave for accessibility
 * Updated to follow TESTING-GUIDE.md patterns with framework utilities
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  a11yTestUtils,
  createTestEnvironment,
  type TestEnvironment,
} from '@/testing/actor-test-utils';
import { AriaObserver } from './aria-observer.js';

describe('AriaObserver', () => {
  let observer: AriaObserver;
  let testElement: HTMLElement;
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    observer = new AriaObserver();
    testElement = document.createElement('div');
    testEnv.container.appendChild(testElement);
  });

  afterEach(() => {
    testEnv.cleanup();
    observer.disconnect();
  });

  describe('Observing elements', () => {
    it('starts observing an element', () => {
      // Behavior: Can observe an element without errors
      expect(() => observer.observe(testElement)).not.toThrow();
    });

    it('stops observing an element', () => {
      observer.observe(testElement);

      // Behavior: Observer can be disconnected without throwing
      expect(() => observer.disconnect()).not.toThrow();

      // Behavior: After disconnect, ARIA attributes still work but aren't automatically updated
      testElement.setAttribute('data-state', 'expanded');
      expect(testElement.getAttribute('data-state')).toBe('expanded');
    });

    it('disconnects from all observations', () => {
      observer.observe(testElement);
      // Behavior: Can disconnect without errors
      expect(() => observer.disconnect()).not.toThrow();
    });
  });

  describe('ARIA attribute management', () => {
    it('allows setting ARIA attributes', () => {
      observer.observe(testElement);

      // Behavior: ARIA attributes can be set on observed elements
      testElement.setAttribute('aria-label', 'Test label');

      // Use framework a11y utilities for validation
      a11yTestUtils.expectAccessible(testElement, {
        ariaLabel: 'Test label',
      });
    });

    it('preserves existing ARIA attributes', () => {
      testElement.setAttribute('aria-hidden', 'true');
      testElement.setAttribute('aria-label', 'Existing');

      observer.observe(testElement);

      // Behavior: Existing attributes remain unchanged
      a11yTestUtils.expectAccessible(testElement, {
        ariaHidden: 'true',
        ariaLabel: 'Existing',
      });
    });

    it('works with multiple ARIA attributes', () => {
      observer.observe(testElement);

      // Behavior: Multiple ARIA attributes work together
      testElement.setAttribute('role', 'button');
      testElement.setAttribute('aria-pressed', 'false');
      testElement.setAttribute('aria-label', 'Toggle');

      // Use framework a11y utilities for comprehensive validation
      a11yTestUtils.expectAccessible(testElement, {
        role: 'button',
        ariaPressed: 'false',
        ariaLabel: 'Toggle',
      });
    });
  });

  describe('Multiple elements', () => {
    it('observes multiple elements independently', () => {
      const element1 = document.createElement('button');
      const element2 = document.createElement('input');
      testEnv.container.appendChild(element1);
      testEnv.container.appendChild(element2);

      observer.observe(element1);
      observer.observe(element2);

      // Behavior: Each element maintains its own attributes
      element1.setAttribute('aria-pressed', 'true');
      element2.setAttribute('aria-invalid', 'false');

      // Validate each element independently
      a11yTestUtils.expectAccessible(element1, {
        ariaPressed: 'true',
      });
      // Note: ariaInvalid not yet in framework interface
      expect(element2.getAttribute('aria-invalid')).toBe('false');
    });
  });

  describe('Common ARIA patterns', () => {
    it('supports modal dialog pattern', () => {
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      testEnv.container.appendChild(modal);

      observer.observe(modal);

      // Behavior: Modal ARIA attributes work as expected
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'modal-title');

      // Use framework utilities for modal pattern validation
      a11yTestUtils.expectAccessible(modal, {
        role: 'dialog',
      });
      // Check aria-labelledby separately due to spelling difference
      expect(modal.getAttribute('aria-labelledby')).toBe('modal-title');
      // Note: ariaModal not yet in framework interface
      expect(modal.getAttribute('aria-modal')).toBe('true');
    });

    it('supports live region pattern', () => {
      const liveRegion = document.createElement('div');
      testEnv.container.appendChild(liveRegion);

      observer.observe(liveRegion);

      // Behavior: Live region attributes work for announcements
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');

      // Validate live region pattern
      a11yTestUtils.expectAccessible(liveRegion, {
        role: 'status',
        ariaLive: 'polite',
        ariaAtomic: 'true',
      });
    });

    it('supports form validation pattern', () => {
      const input = document.createElement('input');
      input.type = 'email';
      testEnv.container.appendChild(input);

      observer.observe(input);

      // Behavior: Form validation ARIA attributes
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', 'email-error');
      input.setAttribute('aria-required', 'true');

      // Validate form validation pattern
      // Check aria-describedby separately due to attribute naming
      expect(input.getAttribute('aria-describedby')).toBe('email-error');
      // Note: ariaInvalid and ariaRequired not yet in framework interface
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-required')).toBe('true');
    });

    it('supports navigation landmark pattern', () => {
      const nav = document.createElement('nav');
      testEnv.container.appendChild(nav);

      observer.observe(nav);

      // Behavior: Navigation landmarks
      nav.setAttribute('aria-label', 'Main navigation');

      // Validate navigation landmark
      a11yTestUtils.expectAccessible(nav, {
        ariaLabel: 'Main navigation',
      });
    });
  });

  describe('Dynamic updates', () => {
    it('handles attribute changes', () => {
      observer.observe(testElement);

      // Initial state
      testElement.setAttribute('aria-expanded', 'false');
      a11yTestUtils.expectAccessible(testElement, {
        ariaExpanded: 'false',
      });

      // Behavior: Attributes can be updated dynamically
      testElement.setAttribute('aria-expanded', 'true');
      a11yTestUtils.expectAccessible(testElement, {
        ariaExpanded: 'true',
      });
    });

    it('handles attribute removal', () => {
      observer.observe(testElement);

      testElement.setAttribute('aria-hidden', 'true');
      expect(testElement.hasAttribute('aria-hidden')).toBe(true);

      // Behavior: Attributes can be removed
      testElement.removeAttribute('aria-hidden');
      expect(testElement.hasAttribute('aria-hidden')).toBe(false);
    });

    it('handles role changes', () => {
      observer.observe(testElement);

      // Behavior: Role can be changed dynamically
      testElement.setAttribute('role', 'button');
      a11yTestUtils.expectAccessible(testElement, {
        role: 'button',
      });

      testElement.setAttribute('role', 'link');
      a11yTestUtils.expectAccessible(testElement, {
        role: 'link',
      });
    });
  });

  describe('Accessibility Best Practices', () => {
    it('maintains keyboard accessibility for interactive elements', () => {
      const button = document.createElement('button');
      testEnv.container.appendChild(button);
      observer.observe(button);

      button.setAttribute('aria-label', 'Interactive button');

      // Ensure keyboard accessibility
      a11yTestUtils.expectKeyboardAccessible(button);
      a11yTestUtils.expectAccessible(button, {
        ariaLabel: 'Interactive button',
      });
    });

    it('properly labels form inputs', () => {
      const input = document.createElement('input');
      const label = document.createElement('label');
      label.textContent = 'Email Address';
      label.setAttribute('for', 'email-input');
      input.setAttribute('id', 'email-input');

      testEnv.container.appendChild(label);
      testEnv.container.appendChild(input);
      observer.observe(input);

      // Ensure proper labeling
      a11yTestUtils.expectLabelled(input);
    });
  });
});
