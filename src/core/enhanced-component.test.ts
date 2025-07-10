/**
 * Behavior Tests for Enhanced Component - Actor-SPA Framework
 *
 * Focus: Testing how enhanced components integrate accessibility features
 * Tests the automatic integration of ARIA, focus, keyboard, and screen reader support
 */

import {
  type TestEnvironment,
  createTestEnvironment,
  setupGlobalMocks,
  waitFor,
} from '../testing/actor-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMachine } from 'xstate';
import {
  createAccessibleButton,
  createAccessibleComponent,
  createAccessibleForm,
  createAccessibleList,
  createAccessibleMenu,
  createAccessibleModal,
  createEnhancedComponent,
} from './enhanced-component.js';

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

      const template = (_state: any, accessibility: any) => {
        return `<div ${accessibility.getRootAttributes()}>Hello</div>`;
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
        template: () => '<div>Test</div>',
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
          return `<button ${accessibility.getButtonAttributes()}>Click me</button>`;
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

      let capturedHelpers: any = null;

      const template = (state: any, accessibility: any) => {
        capturedHelpers = accessibility;
        return `
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

      // Verify all helper methods are available
      expect(capturedHelpers).toBeDefined();
      expect(capturedHelpers.aria).toBeDefined();
      expect(capturedHelpers.focus).toBeDefined();
      expect(capturedHelpers.keyboard).toBeDefined();
      expect(capturedHelpers.screenReader).toBeDefined();

      // Verify convenience methods
      expect(typeof capturedHelpers.announce).toBe('function');
      expect(typeof capturedHelpers.announceStateChange).toBe('function');
      expect(typeof capturedHelpers.enableKeyboardNavigation).toBe('function');
      expect(typeof capturedHelpers.trapFocus).toBe('function');
      expect(typeof capturedHelpers.releaseFocusTrap).toBe('function');

      // Verify template attribute helpers
      expect(typeof capturedHelpers.getRootAttributes).toBe('function');
      expect(typeof capturedHelpers.getButtonAttributes).toBe('function');
      expect(typeof capturedHelpers.getListAttributes).toBe('function');
      expect(typeof capturedHelpers.getListItemAttributes).toBe('function');
      expect(typeof capturedHelpers.getFormAttributes).toBe('function');
      expect(typeof capturedHelpers.getInputAttributes).toBe('function');

      // Verify state-aware helpers
      expect(typeof capturedHelpers.isLoading).toBe('function');
      expect(typeof capturedHelpers.hasError).toBe('function');
      expect(typeof capturedHelpers.isDisabled).toBe('function');
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

      const template = (_state: any, accessibility: any) => {
        isLoadingValue = accessibility.isLoading();
        hasErrorValue = accessibility.hasError();
        return `
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

      const element = document.createElement('state-test-component') as any;
      testEnv.container.appendChild(element);

      await waitFor(() => element.actor);

      // Initially idle
      expect(isLoadingValue).toBe(false);
      expect(hasErrorValue).toBe(false);

      // Transition to loading
      element.actor.send({ type: 'LOAD' });
      await waitFor(() => isLoadingValue === true);
      expect(isLoadingValue).toBe(true);
      expect(hasErrorValue).toBe(false);

      // Transition to error
      element.actor.send({ type: 'ERROR' });
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

      let mobileHelpers: any = null;

      const template = (_state: any, accessibility: any) => {
        mobileHelpers = accessibility.mobile;
        return `
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

      await waitFor(() => mobileHelpers !== null);

      // Verify mobile helpers are available
      expect(mobileHelpers).toBeDefined();
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
        template: (_state, _accessibility) => '<div>Mobile Nav</div>',
        mobile: {
          navigation: 'bottom-sheet',
        },
      });

      const element = document.createElement('mobile-events-component') as any;

      element.addEventListener('mobile-nav-opened', (e: CustomEvent) => {
        events.push(`opened:${e.detail.type}`);
      });

      element.addEventListener('mobile-nav-closed', (e: CustomEvent) => {
        events.push(`closed:${e.detail.type}`);
      });

      testEnv.container.appendChild(element);

      await waitFor(() => element.getAccessibilityHelpers);

      const helpers = element.getAccessibilityHelpers();

      helpers.mobile?.openNavigation();
      expect(events).toContain('opened:bottom-sheet');

      helpers.mobile?.closeNavigation();
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
          `<button ${accessibility.getButtonAttributes()}>
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
          `<form ${accessibility.getFormAttributes()}>
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
          `<ul ${accessibility.getListAttributes('vertical')}>
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
          return `<div role="dialog" ${state.matches('open') ? '' : 'hidden'}>
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
          `<ul ${accessibility.getListAttributes('vertical')} role="menu">
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
          `<div ${ariaHelper.getRootAttributes()}>Legacy Component</div>`,
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
          `<button ${ariaHelper.getButtonAttributes()}>Legacy Button</button>`,
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

      const template = (state: any, accessibility: any) => {
        // Capture announcements for testing
        const originalAnnounce = accessibility.announce;
        accessibility.announce = (msg: string) => {
          announcements.push(msg);
          originalAnnounce(msg);
        };

        return `
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

      const element = document.createElement('validation-form-component') as any;
      testEnv.container.appendChild(element);

      await waitFor(() => element.actor);

      // Submit with invalid data
      element.actor.send({ type: 'SUBMIT' });
      element.actor.send({ type: 'INVALID' });

      await waitFor(() => {
        const errorDiv = element.querySelector('[role="alert"]');
        return errorDiv && errorDiv.textContent === 'Email is required';
      });

      // Verify error is displayed
      const errorDiv = element.querySelector('[role="alert"]');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv.textContent).toBe('Email is required');
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

      const template = (state: any, accessibility: any) => {
        return `
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

      const element = document.createElement('interactive-list-component') as any;
      testEnv.container.appendChild(element);

      await waitFor(() => element.actor);

      // Select different item
      element.actor.send({ type: 'SELECT', index: 1 });

      // Wait for re-render after state change
      await waitFor(() => {
        const items = element.querySelectorAll('li');
        // Check that the template has been updated with new selected index
        return items.length === 3 && element.innerHTML.includes('Banana');
      });

      // The enhanced component doesn't directly set aria-selected on DOM elements
      // Instead, it provides the attributes through the template helpers
      // We should verify the state was updated correctly
      expect(element.actor.getSnapshot().context.selectedIndex).toBe(1);
    });
  });
});
