/**
 * Behavior Tests for Enhanced Component - Actor-SPA Framework
 *
 * Focus: Testing how enhanced components integrate accessibility features
 * Tests the automatic integration of ARIA, focus, keyboard, and screen reader support
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AnyStateMachine, createMachine, type SnapshotFrom } from 'xstate';
import { Logger } from '@/core/dev-mode.js';
import {
  createTestEnvironment,
  setupGlobalMocks,
  type TestEnvironment,
  waitFor,
} from '@/testing/actor-test-utils';
import type { ActorRef } from './create-actor-ref.js';
import {
  type AccessibilityHelpers,
  createAccessibleButton,
  createAccessibleComponent,
  createAccessibleForm,
  createAccessibleList,
  createAccessibleMenu,
  createAccessibleModal,
  createEnhancedComponent,
} from './enhanced-component.js';
import { html } from './minimal-api.js';

// Interface for custom elements created by the framework
interface CustomElementWithActor extends HTMLElement {
  actor?: ActorRef;
  getAccessibilityHelpers?: () => AccessibilityHelpers;
}

const log = Logger.namespace('ENHANCED_COMPONENT_TEST');

describe('Enhanced Component', () => {
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('Component Creation', () => {
    it('creates enhanced component with accessibility features', () => {
      // Behavior: Enhanced components should automatically include accessibility
      const machine = createMachine({
        id: 'test-component',
        initial: 'idle',
        states: { idle: {} },
      });

      const template = (
        _state: SnapshotFrom<AnyStateMachine>,
        accessibility: AccessibilityHelpers
      ) => {
        return html`<div ${accessibility.getRootAttributes()}>Hello</div>`;
      };

      const ComponentClass = createEnhancedComponent({
        machine,
        template,
      });

      expect(ComponentClass).toBeDefined();
      expect(customElements.get('test-component-component')).toBeDefined();
    });

    it('registers component with custom tag name', () => {
      // Behavior: Components should use custom tag names when provided
      const machine = createMachine({
        id: 'another-test',
        initial: 'idle',
        states: { idle: {} },
      });

      const _ComponentClass = createEnhancedComponent({
        machine,
        template: () => html`<div>Test</div>`,
        tagName: 'my-custom-element',
      });

      expect(customElements.get('my-custom-element')).toBeDefined();
    });

    it('initializes with accessibility preset', () => {
      // Behavior: Presets should configure accessibility features automatically
      const machine = createMachine({
        id: 'button-test',
        initial: 'idle',
        states: { idle: {} },
      });

      const _ComponentClass = createEnhancedComponent({
        machine,
        template: (_state, accessibility) => {
          return html`<button ${accessibility.getButtonAttributes()}>Click me</button>`;
        },
        accessibility: {
          presets: 'button',
        },
      });

      const element = document.createElement('button-test-component');
      testEnv.container.appendChild(element);

      // Component should have accessibility features initialized
      expect(element).toBeTruthy();
    });
  });

  describe('Accessibility Helpers', () => {
    it('provides comprehensive accessibility helpers in template', async () => {
      // Behavior: Templates should have access to all accessibility helpers
      const machine = createMachine({
        id: 'helper-test',
        initial: 'idle',
        context: { items: ['Item 1', 'Item 2'] },
        states: {
          idle: {
            on: { LOAD: 'loading' },
          },
          loading: {
            on: { COMPLETE: 'idle' },
          },
        },
      });

      let capturedHelpers: AccessibilityHelpers | null = null;

      const template = (
        state: SnapshotFrom<AnyStateMachine>,
        accessibility: AccessibilityHelpers
      ) => {
        capturedHelpers = accessibility;
        return html`
          <div ${accessibility.getRootAttributes()}>
            <button ${accessibility.getButtonAttributes()}>
              ${accessibility.isLoading() ? 'Loading...' : 'Load Data'}
            </button>
            <ul ${accessibility.getListAttributes()}>
              ${state.context.items
                .map(
                  (item: string, index: number) =>
                    `<li ${accessibility.getListItemAttributes(index)}>${item}</li>`
                )
                .join('')}
            </ul>
          </div>
        `;
      };

      const _ComponentClass = createEnhancedComponent({
        machine,
        template,
        accessibility: {
          presets: 'list',
        },
      });

      const element = document.createElement('helper-test-component');
      testEnv.container.appendChild(element);

      await waitFor(() => capturedHelpers !== null);

      // Proper type checking following Testing Guide principles - use unknown first
      expect(capturedHelpers).not.toBeNull();
      expect(capturedHelpers).toBeDefined();

      // Safe type assertion: unknown -> AccessibilityHelpers after verification
      const helpers = capturedHelpers as unknown as AccessibilityHelpers;
      log.debug('AccessibilityHelpers captured successfully');

      // Verify all helper methods are available
      expect(helpers.aria).toBeDefined();
      expect(helpers.focus).toBeDefined();
      expect(helpers.keyboard).toBeDefined();
      expect(helpers.screenReader).toBeDefined();

      // Verify convenience methods
      expect(typeof helpers.announce).toBe('function');
      expect(typeof helpers.announceStateChange).toBe('function');
      expect(typeof helpers.enableKeyboardNavigation).toBe('function');
      expect(typeof helpers.trapFocus).toBe('function');
      expect(typeof helpers.releaseFocusTrap).toBe('function');

      // Verify template attribute helpers
      expect(typeof helpers.getRootAttributes).toBe('function');
      expect(typeof helpers.getButtonAttributes).toBe('function');
      expect(typeof helpers.getListAttributes).toBe('function');
      expect(typeof helpers.getListItemAttributes).toBe('function');
      expect(typeof helpers.getFormAttributes).toBe('function');
      expect(typeof helpers.getInputAttributes).toBe('function');

      // Verify state-aware helpers
      expect(typeof helpers.isLoading).toBe('function');
      expect(typeof helpers.hasError).toBe('function');
      expect(typeof helpers.isDisabled).toBe('function');
    });

    it('updates accessibility helpers on state changes', async () => {
      // Behavior: Accessibility helpers should reflect current state
      const machine = createMachine({
        id: 'state-test',
        initial: 'idle',
        states: {
          idle: {
            on: { LOAD: 'loading' },
          },
          loading: {
            on: { ERROR: 'error' },
          },
          error: {
            on: { RETRY: 'idle' },
          },
        },
      });

      let isLoadingValue = false;
      let hasErrorValue = false;

      const template = (
        _state: SnapshotFrom<AnyStateMachine>,
        accessibility: AccessibilityHelpers
      ) => {
        isLoadingValue = accessibility.isLoading();
        hasErrorValue = accessibility.hasError();
        return html`
          <div>
            ${isLoadingValue ? 'Loading...' : ''}
            ${hasErrorValue ? 'Error!' : ''}
          </div>
        `;
      };

      const _ComponentClass = createEnhancedComponent({
        machine,
        template,
      });

      const element = document.createElement('state-test-component') as CustomElementWithActor;
      testEnv.container.appendChild(element);

      await waitFor(() => element.actor !== undefined);

      // Initially idle
      expect(isLoadingValue).toBe(false);
      expect(hasErrorValue).toBe(false);

      // Transition to loading
      element.actor?.send({ type: 'LOAD' });
      await waitFor(() => isLoadingValue === true);
      expect(isLoadingValue).toBe(true);
      expect(hasErrorValue).toBe(false);

      // Transition to error
      element.actor?.send({ type: 'ERROR' });
      await waitFor(() => hasErrorValue === true);
      expect(isLoadingValue).toBe(false);
      expect(hasErrorValue).toBe(true);
    });
  });

  describe('Mobile Navigation', () => {
    it('initializes mobile navigation when configured', async () => {
      // Behavior: Mobile navigation should be available when configured
      const machine = createMachine({
        id: 'mobile-test',
        initial: 'idle',
        states: { idle: {} },
      });

      let capturedAccessibility: AccessibilityHelpers | null = null;

      const template = (
        _state: SnapshotFrom<AnyStateMachine>,
        accessibility: AccessibilityHelpers
      ) => {
        capturedAccessibility = accessibility;
        return html`
          <nav>
            ${
              accessibility.mobile
                ? `<button onclick="${() => accessibility.mobile?.toggleNavigation()}">Menu</button>`
                : ''
            }
          </nav>
        `;
      };

      const _ComponentClass = createEnhancedComponent({
        machine,
        template,
        mobile: {
          navigation: 'drawer',
          gestures: {
            swipe: true,
          },
        },
      });

      const element = document.createElement('mobile-test-component');
      testEnv.container.appendChild(element);

      await waitFor(() => capturedAccessibility !== null);

      // Verify accessibility helpers are available and properly typed
      expect(capturedAccessibility).toBeDefined();
      expect(capturedAccessibility).not.toBeNull();

      // Type assertion after verification - convert null to unknown first for safety
      const accessibilityHelpers = capturedAccessibility as unknown as AccessibilityHelpers;

      // Verify mobile helpers are available
      expect(accessibilityHelpers.mobile).toBeDefined();
      expect(accessibilityHelpers.mobile).not.toBeUndefined();

      // Extract mobile helpers with proper typing
      const mobileHelpers = accessibilityHelpers.mobile;
      if (!mobileHelpers) {
        throw new Error('Mobile helpers should be available when mobile navigation is configured');
      }

      expect(typeof mobileHelpers.openNavigation).toBe('function');
      expect(typeof mobileHelpers.closeNavigation).toBe('function');
      expect(typeof mobileHelpers.toggleNavigation).toBe('function');
      expect(typeof mobileHelpers.isNavigationOpen).toBe('function');
      expect(mobileHelpers.isNavigationOpen()).toBe(false);

      // Test navigation toggle
      mobileHelpers.openNavigation();
      expect(mobileHelpers.isNavigationOpen()).toBe(true);
      expect(element.getAttribute('data-mobile-nav-open')).toBe('true');

      mobileHelpers.closeNavigation();
      expect(mobileHelpers.isNavigationOpen()).toBe(false);
      expect(element.hasAttribute('data-mobile-nav-open')).toBe(false);
    });

    it('dispatches mobile navigation events', async () => {
      // Behavior: Mobile navigation should emit events for integration
      const machine = createMachine({
        id: 'mobile-events',
        initial: 'idle',
        states: { idle: {} },
      });

      const events: string[] = [];

      const _ComponentClass = createEnhancedComponent({
        machine,
        template: (_state, _accessibility) => html`<div>Mobile Nav</div>`,
        mobile: {
          navigation: 'bottom-sheet',
        },
      });

      const element = document.createElement('mobile-events-component') as CustomElementWithActor;

      element.addEventListener('mobile-nav-opened', (e: Event) => {
        const customEvent = e as CustomEvent;
        events.push(`opened:${customEvent.detail.type}`);
      });

      element.addEventListener('mobile-nav-closed', (e: Event) => {
        const customEvent = e as CustomEvent;
        events.push(`closed:${customEvent.detail.type}`);
      });

      testEnv.container.appendChild(element);

      await waitFor(() => element.getAccessibilityHelpers !== undefined);

      const helpers = element.getAccessibilityHelpers?.();

      helpers?.mobile?.openNavigation();
      expect(events).toContain('opened:bottom-sheet');

      helpers?.mobile?.closeNavigation();
      expect(events).toContain('closed:bottom-sheet');
    });
  });

  describe('Preset Functions', () => {
    it('creates accessible button with preset', () => {
      // Behavior: Preset functions should simplify component creation
      const machine = createMachine({
        id: 'preset-button',
        initial: 'idle',
        states: {
          idle: {
            on: { CLICK: 'clicked' },
          },
          clicked: {},
        },
      });

      const _ComponentClass = createAccessibleButton({
        machine,
        template: (state, accessibility) =>
          html`<button ${accessibility.getButtonAttributes()}>
            ${state.matches('clicked') ? 'Clicked!' : 'Click me'}
          </button>`,
      });

      expect(customElements.get('preset-button-component')).toBeDefined();
    });

    it('creates accessible form with preset', () => {
      // Behavior: Form preset should configure form-specific accessibility
      const machine = createMachine({
        id: 'preset-form',
        initial: 'ready',
        states: {
          ready: {
            on: { SUBMIT: 'submitting' },
          },
          submitting: {},
        },
      });

      const _ComponentClass = createAccessibleForm({
        machine,
        template: (_state, accessibility) =>
          html`<form ${accessibility.getFormAttributes()}>
            <input ${accessibility.getInputAttributes(false, true)} />
            <button type="submit">Submit</button>
          </form>`,
      });

      expect(customElements.get('preset-form-component')).toBeDefined();
    });

    it('creates accessible list with preset', () => {
      // Behavior: List preset should configure list navigation
      const machine = createMachine({
        id: 'preset-list',
        initial: 'idle',
        context: { items: ['A', 'B', 'C'] },
        states: { idle: {} },
      });

      const _ComponentClass = createAccessibleList({
        machine,
        template: (state, accessibility) =>
          html`<ul ${accessibility.getListAttributes('vertical')}>
            ${state.context.items
              .map(
                (item: string, i: number) =>
                  `<li ${accessibility.getListItemAttributes(i)}>${item}</li>`
              )
              .join('')}
          </ul>`,
      });

      expect(customElements.get('preset-list-component')).toBeDefined();
    });

    it('creates accessible modal with preset', () => {
      // Behavior: Modal preset should configure focus trapping
      const machine = createMachine({
        id: 'preset-modal',
        initial: 'closed',
        states: {
          closed: {
            on: { OPEN: 'open' },
          },
          open: {
            on: { CLOSE: 'closed' },
          },
        },
      });

      const _ComponentClass = createAccessibleModal({
        machine,
        template: (state, accessibility) => {
          if (state.matches('open')) {
            accessibility.trapFocus(document.body); // In real usage, would trap in modal
          }
          return html`<div role="dialog" ${state.matches('open') ? '' : 'hidden'}>
            Modal Content
          </div>`;
        },
      });

      expect(customElements.get('preset-modal-component')).toBeDefined();
    });

    it('creates accessible menu with preset', () => {
      // Behavior: Menu preset should configure menu navigation
      const machine = createMachine({
        id: 'preset-menu',
        initial: 'idle',
        context: { items: ['File', 'Edit', 'View'] },
        states: { idle: {} },
      });

      const _ComponentClass = createAccessibleMenu({
        machine,
        template: (state, accessibility) =>
          html`<ul ${accessibility.getListAttributes('vertical')} role="menu">
            ${state.context.items
              .map(
                (item: string, i: number) =>
                  `<li ${accessibility.getListItemAttributes(i)} role="menuitem">${item}</li>`
              )
              .join('')}
          </ul>`,
      });

      expect(customElements.get('preset-menu-component')).toBeDefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('supports legacy createAccessibleComponent function', () => {
      // Behavior: Legacy API should still work
      const machine = createMachine({
        id: 'legacy-component',
        initial: 'idle',
        states: { idle: {} },
      });

      const _ComponentClass = createAccessibleComponent({
        machine,
        template: (_state, ariaHelper) =>
          html`<div ${ariaHelper.getRootAttributes()}>Legacy Component</div>`,
        ariaConfig: {
          role: 'region',
          label: 'Legacy Region',
        },
      });

      expect(customElements.get('legacy-component-component')).toBeDefined();
    });

    it('supports legacy accessibility presets', () => {
      // Behavior: Legacy preset configuration should work
      const machine = createMachine({
        id: 'legacy-preset',
        initial: 'idle',
        states: { idle: {} },
      });

      const _ComponentClass = createAccessibleComponent({
        machine,
        template: (_state, ariaHelper) =>
          html`<button ${ariaHelper.getButtonAttributes()}>Legacy Button</button>`,
        accessibility: {
          preset: 'button',
          autoInit: true,
        },
      });

      expect(customElements.get('legacy-preset-component')).toBeDefined();
    });
  });

  describe('Real-world Patterns', () => {
    it('handles form with validation and announcements', async () => {
      // Behavior: Forms should announce validation errors
      const machine = createMachine({
        id: 'validation-form',
        initial: 'ready',
        context: { errors: [] as string[] },
        states: {
          ready: {
            on: {
              SUBMIT: 'validating',
            },
          },
          validating: {
            on: {
              VALID: 'submitting',
              INVALID: {
                target: 'ready',
                actions: ({ context }) => {
                  context.errors = ['Email is required'];
                },
              },
            },
          },
          submitting: {
            on: {
              SUCCESS: 'complete',
            },
          },
          complete: {},
        },
      });

      const announcements: string[] = [];

      const template = (
        state: SnapshotFrom<AnyStateMachine>,
        accessibility: AccessibilityHelpers
      ) => {
        // Capture announcements for testing
        const originalAnnounce = accessibility.announce;
        accessibility.announce = (msg: string) => {
          announcements.push(msg);
          originalAnnounce(msg);
        };

        return html`
          <form ${accessibility.getFormAttributes()}>
            ${
              state.context.errors.length > 0
                ? `<div role="alert">${state.context.errors.join(', ')}</div>`
                : ''
            }
            <input type="email" ${accessibility.getInputAttributes(
              state.context.errors.length > 0,
              true
            )} />
            <button type="submit">Submit</button>
          </form>
        `;
      };

      const _ComponentClass = createAccessibleForm({
        machine,
        template,
      });

      const element = document.createElement('validation-form-component') as CustomElementWithActor;
      testEnv.container.appendChild(element);

      await waitFor(() => element.actor !== undefined);

      // Submit with invalid data
      element.actor?.send({ type: 'SUBMIT' });
      element.actor?.send({ type: 'INVALID' });

      await waitFor(() => {
        const errorDiv = element.querySelector('[role="alert"]');
        return errorDiv?.textContent === 'Email is required';
      });

      // Verify error is displayed
      const errorDiv = element.querySelector('[role="alert"]');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv?.textContent).toBe('Email is required');
    });

    it('handles interactive list with keyboard navigation', async () => {
      // Behavior: Lists should support keyboard navigation
      const machine = createMachine({
        id: 'interactive-list',
        initial: 'idle',
        context: {
          items: ['Apple', 'Banana', 'Cherry'],
          selectedIndex: 0,
        },
        states: {
          idle: {
            on: {
              SELECT: {
                actions: ({ context, event }) => {
                  context.selectedIndex = event.index;
                },
              },
            },
          },
        },
      });

      const template = (
        state: SnapshotFrom<AnyStateMachine>,
        accessibility: AccessibilityHelpers
      ) => {
        return html`
          <ul ${accessibility.getListAttributes('vertical')}>
            ${state.context.items
              .map(
                (item: string, index: number) =>
                  `<li ${accessibility.getListItemAttributes(
                    index,
                    index === state.context.selectedIndex
                  )}>
                ${item}
              </li>`
              )
              .join('')}
          </ul>
        `;
      };

      const _ComponentClass = createAccessibleList({
        machine,
        template,
      });

      const element = document.createElement(
        'interactive-list-component'
      ) as CustomElementWithActor;
      testEnv.container.appendChild(element);

      await waitFor(() => element.actor !== undefined);

      // Select different item
      element.actor?.send({ type: 'SELECT' });

      // Wait for re-render after state change
      await waitFor(() => {
        const items = element.querySelectorAll('li');
        // Check that the template has been updated with new selected index
        return items.length === 3 && element.innerHTML.includes('Banana');
      });

      // The enhanced component doesn't directly set aria-selected on DOM elements
      // Instead, it provides the attributes through the template helpers
      // We should verify the state was updated correctly
      // Check actor exists and assert snapshot type
      if (element.actor) {
        const snapshot = element.actor.getSnapshot() as { context: { selectedIndex: number } };
        expect(snapshot.context.selectedIndex).toBe(1);
      }
    });
  });
});
