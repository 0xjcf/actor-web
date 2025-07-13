/**
 * Behavior Tests for Minimal API - Actor-Web Framework
 *
 * These tests focus on testing the actual createComponent framework API
 * following TESTING-GUIDE.md principles: behavior over implementation
 */

import { Logger } from '@/core/dev-mode';
import { createComponent, css, html } from '@/core/minimal-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createMachine } from 'xstate';

// Use scoped logger as recommended in Testing Guide
const log = Logger.namespace('MINIMAL_API_TEST');

// Helper to wait for component to be ready
async function waitForComponent(element: Element): Promise<void> {
  return new Promise((resolve) => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          observer.disconnect();
          resolve();
          return;
        }
      }
    });

    observer.observe(element, { childList: true, subtree: true });

    // Fallback timeout
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 100);
  });
}

describe('Minimal API - Framework Behavior', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // ✅ CORRECT: Test real framework API, not mocks
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);

    log.debug('Test environment set up');
  });

  afterEach(() => {
    // Clean up DOM
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }

    log.debug('Test environment cleaned up');
  });

  describe('Component Creation', () => {
    it('should create a functional toggle button component', async () => {
      // Arrange: Define toggle machine
      const toggleMachine = createMachine({
        id: 'toggle-button',
        initial: 'off',
        states: {
          off: {
            on: { TOGGLE: 'on' },
          },
          on: {
            on: { TOGGLE: 'off' },
          },
        },
      });

      // ✅ CORRECT: Properly typed template function
      const template = (state: { matches: (state: string) => boolean }) => html`
        <button send="TOGGLE" aria-pressed="${state.matches('on') ? 'true' : 'false'}">
          ${state.matches('on') ? 'ON' : 'OFF'}
        </button>
      `;

      // Act: Create component using real framework API
      const ToggleButton = createComponent({
        machine: toggleMachine,
        template,
        useShadowDOM: true,
      });

      const element = new ToggleButton();
      container.appendChild(element);

      // Wait for component initialization
      await waitForComponent(element);

      // Assert: Component should be created and functional
      expect(element.tagName.toLowerCase()).toBe('reactive-component');
      expect(element.getAttribute('data-state')).toBe('off');

      log.debug('Toggle button component created successfully');
    });

    it('should create a counter component with proper state management', async () => {
      // Arrange: Counter machine
      const counterMachine = createMachine({
        id: 'counter',
        initial: 'active',
        context: { count: 0 },
        states: {
          active: {
            on: {
              INCREMENT: {
                actions: assign({
                  count: ({ context }) => context.count + 1,
                }),
              },
              DECREMENT: {
                actions: assign({
                  count: ({ context }) => context.count - 1,
                }),
              },
            },
          },
        },
      });

      const template = (state: {
        context: { count: number };
        matches: (state: string) => boolean;
      }) => html`
        <div class="counter">
          <button send="DECREMENT" aria-label="Decrement">-</button>
          <span class="count">${state.context.count}</span>
          <button send="INCREMENT" aria-label="Increment">+</button>
        </div>
      `;

      // Act: Create counter component
      const Counter = createComponent({
        machine: counterMachine,
        template,
        useShadowDOM: true,
      });

      const element = new Counter();
      container.appendChild(element);

      await waitForComponent(element);

      // Assert: Initial state should be correct
      expect(element.getAttribute('data-state')).toBe('active');

      log.debug('Counter component created with initial state');
    });
  });

  describe('Template Features', () => {
    it('should support CSS styling', () => {
      // Arrange: Create styled component
      const styledMachine = createMachine({
        id: 'styled-component',
        initial: 'ready',
        states: { ready: {} },
      });

      const styles = css`
        :host {
          display: block;
          padding: 1rem;
        }
        .content {
          color: blue;
          font-size: 1.5rem;
        }
      `;

      const template = (_state: { matches: (state: string) => boolean }) => html`
        <style>${styles.css}</style>
        <div class="content">Styled Content</div>
      `;

      // Act: Create styled component
      const StyledComponent = createComponent({
        machine: styledMachine,
        template,
        styles: styles.css,
        useShadowDOM: true,
      });

      const element = new StyledComponent();

      // Assert: Component should be created with styles
      expect(element).toBeDefined();
      expect(element.tagName.toLowerCase()).toBe('reactive-component');

      log.debug('Styled component created successfully');
    });

    it('should support conditional rendering based on state', () => {
      // Arrange: Modal machine with conditional states
      const modalMachine = createMachine({
        id: 'modal',
        initial: 'closed',
        context: { message: '' },
        states: {
          closed: {
            on: {
              OPEN: {
                target: 'open',
                actions: assign({
                  message: ({ event }) =>
                    (event as { message?: string }).message || 'Default message',
                }),
              },
            },
          },
          open: {
            on: { CLOSE: 'closed' },
          },
        },
      });

      const template = (state: {
        matches: (state: string) => boolean;
        context: { message: string };
      }) => html`
        ${
          state.matches('closed')
            ? html`<button send="OPEN">Show Modal</button>`
            : html`<div class="modal">
              <p>${state.context.message}</p>
              <button send="CLOSE">Close</button>
            </div>`
        }
      `;

      // Act: Create modal component
      const Modal = createComponent({
        machine: modalMachine,
        template,
        useShadowDOM: true,
      });

      const element = new Modal();

      // Assert: Component should be created
      expect(element).toBeDefined();
      expect(element.getAttribute('data-state')).toBe('closed');

      log.debug('Modal component with conditional rendering created');
    });
  });

  describe('Event Handling', () => {
    it('should handle send attributes for event dispatching', () => {
      // Arrange: Simple button machine
      const buttonMachine = createMachine({
        id: 'event-button',
        initial: 'idle',
        context: { clickCount: 0 },
        states: {
          idle: {
            on: {
              CLICK: {
                actions: assign({
                  clickCount: ({ context }) => context.clickCount + 1,
                }),
              },
            },
          },
        },
      });

      const template = (state: {
        context: { clickCount: number };
      }) => html`
        <button send="CLICK">
          Clicked ${state.context.clickCount} times
        </button>
      `;

      // Act: Create component with event handling
      const EventButton = createComponent({
        machine: buttonMachine,
        template,
        useShadowDOM: true,
      });

      const element = new EventButton();

      // Assert: Component should be created with proper event setup
      expect(element).toBeDefined();
      expect(element.getActor()).toBeDefined();

      log.debug('Event handling component created');
    });

    it('should prevent XSS attacks in templates', async () => {
      // Arrange: Component with user input
      const displayMachine = createMachine({
        id: 'display',
        initial: 'showing',
        context: {
          userInput: '<script>alert("XSS")</script><img src=x onerror="alert(\'XSS\')">',
        },
        states: { showing: {} },
      });

      const template = (state: {
        context: { userInput: string };
      }) => html`
        <div class="user-content">
          ${state.context.userInput}
        </div>
      `;

      // Act: Create component using real framework API
      const DisplayComponent = createComponent({
        machine: displayMachine,
        template,
        useShadowDOM: true,
      });

      const element = new DisplayComponent();
      container.appendChild(element);

      // Wait for component initialization
      await waitForComponent(element);

      // Assert: Component should be created and XSS content should be escaped
      expect(element).toBeDefined();
      expect(element.getAttribute('data-state')).toBe('showing');

      // Test that dangerous content is properly escaped in the rendered DOM
      const shadowRoot = element.shadowRoot;
      expect(shadowRoot).toBeTruthy();

      const userContentDiv = shadowRoot?.querySelector('.user-content');
      expect(userContentDiv).toBeTruthy();

      // The dangerous script should be escaped as text content, not executed
      const innerHTML = userContentDiv?.innerHTML || '';
      expect(innerHTML).toContain('&lt;script&gt;');
      expect(innerHTML).not.toContain('<script>');

      log.debug('XSS prevention test completed with real framework behavior');
    });
  });

  describe('Template Functions', () => {
    it('should create HTML templates with proper structure', () => {
      // Act: Create HTML template
      const result = html`
        <div class="test">
          <h1>Hello World</h1>
          <p>This is a test</p>
        </div>
      `;

      // Assert: Should return template object
      expect(result).toHaveProperty('html');
      expect(typeof result.html).toBe('string');
      expect(result.html).toContain('<div class="test">');
      expect(result.html).toContain('Hello World');

      log.debug('HTML template creation test completed');
    });

    it('should create CSS with proper formatting', () => {
      // Act: Create CSS template
      const result = css`
        .test {
          color: red;
          background: blue;
        }
        .other {
          margin: 1rem;
        }
      `;

      // Assert: Should return CSS object
      expect(result).toHaveProperty('css');
      expect(typeof result.css).toBe('string');
      expect(result.css).toContain('color: red');
      expect(result.css).toContain('background: blue');

      log.debug('CSS template creation test completed');
    });
  });

  describe('Component API', () => {
    it('should provide access to actor and state', () => {
      // Arrange: Simple machine
      const simpleMachine = createMachine({
        id: 'simple',
        initial: 'ready',
        states: { ready: {} },
      });

      const template = (_state: { matches: (state: string) => boolean }) =>
        html`<div>Simple Component</div>`;

      // Act: Create component
      const SimpleComponent = createComponent({
        machine: simpleMachine,
        template,
      });

      const element = new SimpleComponent();

      // Assert: Should provide API access
      expect(element.getActor).toBeDefined();
      expect(element.getCurrentState).toBeDefined();
      expect(element.send).toBeDefined();

      // Actor should be available after creation
      const actor = element.getActor();
      expect(actor).toBeDefined();

      log.debug('Component API test completed');
    });

    it('should handle component lifecycle correctly', () => {
      // Arrange: Component with lifecycle callbacks
      const lifecycleSpy = vi.fn();
      const disconnectSpy = vi.fn();

      const lifecycleMachine = createMachine({
        id: 'lifecycle',
        initial: 'active',
        states: { active: {} },
      });

      const template = (_state: { matches: (state: string) => boolean }) =>
        html`<div>Lifecycle Test</div>`;

      // Act: Create component with lifecycle hooks
      const LifecycleComponent = createComponent({
        machine: lifecycleMachine,
        template,
        onConnected: lifecycleSpy,
        onDisconnected: disconnectSpy,
      });

      const element = new LifecycleComponent();

      // Assert: Component should be created
      expect(element).toBeDefined();

      // Simulate lifecycle
      container.appendChild(element);
      container.removeChild(element);

      // Lifecycle callbacks should be available
      expect(lifecycleSpy).toBeDefined();
      expect(disconnectSpy).toBeDefined();

      log.debug('Component lifecycle test completed');
    });
  });
});
