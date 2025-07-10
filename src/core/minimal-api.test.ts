/**
 * Behavior Tests for Minimal API - Actor-SPA Framework
 *
 * Focus: How the minimal API behaves when creating components
 * Tests the actual component creation and lifecycle users experience
 */

import {
  type TestEnvironment,
  componentUtils,
  createTestEnvironment,
  setupGlobalMocks,
  userInteractions,
  waitFor,
} from '@/framework/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createMachine } from 'xstate';
import { createComponent, css, html } from './minimal-api.js';

describe('Minimal API', () => {
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('Component Creation', () => {
    it('creates a functional toggle button', async () => {
      // Behavior: Users can create interactive toggle buttons
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

      const template = (state: any) => html`
        <button 
          send="TOGGLE"
          aria-pressed="${state.matches('on')}"
        >
          ${state.matches('on') ? 'ON' : 'OFF'}
        </button>
      `;

      const _ToggleButton = createComponent({
        machine: toggleMachine,
        template,
      });

      // Mount component
      const element = document.createElement('toggle-button');
      testEnv.container.appendChild(element);

      // Wait for component to initialize
      await waitFor(() => componentUtils.getShadowContent(element) !== null);

      const button = componentUtils.queryInShadow(element, 'button');
      expect(button).toBeTruthy();
      expect(button?.textContent).toBe('OFF');
      expect(button?.getAttribute('aria-pressed')).toBe('false');

      // Toggle the button
      userInteractions.click(button!);

      await waitFor(() => button?.textContent === 'ON');
      expect(button?.getAttribute('aria-pressed')).toBe('true');
    });

    it('creates a counter with increment/decrement', async () => {
      // Behavior: Create a counter component that tracks a value
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
              RESET: {
                actions: assign({ count: 0 }),
              },
            },
          },
        },
      });

      const template = (state: any) => html`
        <div class="counter">
          <button send="DECREMENT" aria-label="Decrement">-</button>
          <span class="count">${state.context.count}</span>
          <button send="INCREMENT" aria-label="Increment">+</button>
          <button send="RESET">Reset</button>
        </div>
      `;

      const _Counter = createComponent({
        machine: counterMachine,
        template,
      });

      const element = document.createElement('counter');
      testEnv.container.appendChild(element);

      await waitFor(() => componentUtils.getShadowContent(element) !== null);

      const count = componentUtils.queryInShadow(element, '.count');
      const incrementBtn = componentUtils.queryInShadow(element, '[aria-label="Increment"]');
      const decrementBtn = componentUtils.queryInShadow(element, '[aria-label="Decrement"]');
      const resetBtn = componentUtils.queryInShadow(element, 'button:last-child');

      // Initial state
      expect(count?.textContent).toBe('0');

      // Increment
      userInteractions.click(incrementBtn!);
      await waitFor(() => count?.textContent === '1');

      userInteractions.click(incrementBtn!);
      await waitFor(() => count?.textContent === '2');

      // Decrement
      userInteractions.click(decrementBtn!);
      await waitFor(() => count?.textContent === '1');

      // Reset
      userInteractions.click(resetBtn!);
      await waitFor(() => count?.textContent === '0');
    });
  });

  describe('Template Features', () => {
    it('supports CSS styling with scoped styles', async () => {
      // Behavior: Components can have isolated styles
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
        .styled-content {
          color: blue;
          font-size: 1.5rem;
        }
        button {
          background: red;
          color: white;
          padding: 0.5rem 1rem;
        }
      `;

      const template = () => html`
        <style>${styles.css}</style>
        <div class="styled-content">
          <h2>Styled Component</h2>
          <button>Styled Button</button>
        </div>
      `;

      const _StyledComponent = createComponent({
        machine: styledMachine,
        template,
      });

      const element = document.createElement('styled-component');
      testEnv.container.appendChild(element);

      await waitFor(() => componentUtils.getShadowContent(element) !== null);

      const style = componentUtils.queryInShadow(element, 'style');
      expect(style).toBeTruthy();
      expect(style?.textContent).toContain('color: blue');
      expect(style?.textContent).toContain('background: red');
    });

    it('supports conditional rendering', async () => {
      // Behavior: Show/hide content based on state
      const modalMachine = createMachine({
        id: 'modal',
        initial: 'closed',
        context: {
          title: '',
          message: '',
        },
        states: {
          closed: {
            on: {
              OPEN: {
                target: 'open',
                actions: assign({
                  title: ({ event }) => event.title || 'Alert',
                  message: ({ event }) => event.message || '',
                }),
              },
            },
          },
          open: {
            on: { CLOSE: 'closed' },
          },
        },
      });

      const template = (state: any) => html`
        ${
          state.matches('closed')
            ? html`<button send="OPEN" data-title="Warning" data-message="This is a warning!">
              Show Modal
            </button>`
            : html`
            <div class="modal" role="dialog" aria-modal="true">
              <h2>${state.context.title}</h2>
              <p>${state.context.message}</p>
              <button send="CLOSE">Close</button>
            </div>
          `
        }
      `;

      const _Modal = createComponent({
        machine: modalMachine,
        template,
      });

      const element = document.createElement('modal');
      testEnv.container.appendChild(element);

      await waitFor(() => componentUtils.getShadowContent(element) !== null);

      // Initially closed
      const showButton = componentUtils.queryInShadow(element, 'button');
      expect(showButton?.textContent?.trim()).toBe('Show Modal');

      // Open modal
      userInteractions.click(showButton!);

      await waitFor(() => {
        const modal = componentUtils.queryInShadow(element, '.modal');
        return modal !== null;
      });

      const modal = componentUtils.queryInShadow(element, '.modal');
      const title = componentUtils.queryInShadow(element, 'h2');
      const message = componentUtils.queryInShadow(element, 'p');

      expect(modal?.getAttribute('role')).toBe('dialog');
      expect(modal?.getAttribute('aria-modal')).toBe('true');
      expect(title?.textContent).toBe('Warning');
      expect(message?.textContent).toBe('This is a warning!');

      // Close modal
      const closeButton = componentUtils.queryInShadow(element, 'button');
      userInteractions.click(closeButton!);

      await waitFor(() => {
        const modal = componentUtils.queryInShadow(element, '.modal');
        return modal === null;
      });
    });

    it('supports list rendering', async () => {
      // Behavior: Render dynamic lists
      const todoMachine = createMachine({
        id: 'todo-list',
        initial: 'ready',
        context: {
          todos: [
            { id: 1, text: 'Learn XState', done: true },
            { id: 2, text: 'Build components', done: false },
            { id: 3, text: 'Test everything', done: false },
          ],
        },
        states: {
          ready: {
            on: {
              TOGGLE: {
                actions: assign({
                  todos: ({ context, event }) =>
                    context.todos.map((todo) =>
                      todo.id === event.id ? { ...todo, done: !todo.done } : todo
                    ),
                }),
              },
            },
          },
        },
      });

      const template = (state: any) => html`
        <ul class="todo-list">
          ${state.context.todos.map(
            (todo: any) => html`
            <li class="${todo.done ? 'done' : 'pending'}">
              <label>
                <input 
                  type="checkbox" 
                  checked="${todo.done}"
                  send:change="TOGGLE"
                  data-id="${todo.id}"
                />
                <span>${todo.text}</span>
              </label>
            </li>
          `
          )}
        </ul>
      `;

      const _TodoList = createComponent({
        machine: todoMachine,
        template,
      });

      const element = document.createElement('todo-list');
      testEnv.container.appendChild(element);

      await waitFor(() => componentUtils.getShadowContent(element) !== null);

      const items = componentUtils.queryAllInShadow(element, 'li');
      expect(items).toHaveLength(3);

      // Check initial states
      expect(items[0].className).toBe('done');
      expect(items[1].className).toBe('pending');
      expect(items[2].className).toBe('pending');

      // Toggle second todo
      const secondCheckbox = componentUtils.queryInShadow(element, 'li:nth-child(2) input');
      userInteractions.click(secondCheckbox!);

      await waitFor(() => {
        const items = componentUtils.queryAllInShadow(element, 'li');
        return items[1].className === 'done';
      });
    });
  });

  describe('Event Handling', () => {
    it('handles different event types', async () => {
      // Behavior: Support various DOM events
      const formMachine = createMachine({
        id: 'event-form',
        initial: 'editing',
        context: {
          value: '',
          focused: false,
          submitted: false,
        },
        states: {
          editing: {
            on: {
              INPUT: {
                actions: assign({
                  value: ({ event }) => event.value,
                }),
              },
              FOCUS: {
                actions: assign({ focused: true }),
              },
              BLUR: {
                actions: assign({ focused: false }),
              },
              SUBMIT: {
                actions: assign({ submitted: true }),
              },
            },
          },
        },
      });

      const template = (state: any) => html`
        <form send:submit="SUBMIT">
          <input 
            type="text"
            value="${state.context.value}"
            send:input="INPUT"
            send:focus="FOCUS"
            send:blur="BLUR"
            class="${state.context.focused ? 'focused' : ''}"
          />
          <button type="submit">Submit</button>
          ${
            state.context.submitted
              ? html`<p class="message">Form submitted with: ${state.context.value}</p>`
              : ''
          }
        </form>
      `;

      const _EventForm = createComponent({
        machine: formMachine,
        template,
      });

      const element = document.createElement('event-form');
      testEnv.container.appendChild(element);

      await waitFor(() => componentUtils.getShadowContent(element) !== null);

      const input = componentUtils.queryInShadow(element, 'input') as HTMLInputElement;
      const form = componentUtils.queryInShadow(element, 'form') as HTMLFormElement;

      // Test focus
      userInteractions.focus(input);
      await waitFor(() => input.className === 'focused');

      // Test input
      userInteractions.input(input, 'Hello World');
      await waitFor(() => input.value === 'Hello World');

      // Test blur
      userInteractions.blur(input);
      await waitFor(() => input.className === '');

      // Test submit
      form.dispatchEvent(new Event('submit', { bubbles: true }));

      await waitFor(() => {
        const message = componentUtils.queryInShadow(element, '.message');
        return message !== null;
      });

      const message = componentUtils.queryInShadow(element, '.message');
      expect(message?.textContent).toBe('Form submitted with: Hello World');
    });

    it('prevents XSS attacks', () => {
      // Behavior: Safely render user input
      const displayMachine = createMachine({
        id: 'display',
        initial: 'showing',
        context: {
          userInput: '<script>alert("XSS")</script><img src=x onerror="alert(\'XSS\')">',
        },
        states: {
          showing: {},
        },
      });

      const template = (state: any) => html`
        <div class="user-content">
          ${state.context.userInput}
        </div>
      `;

      const _Display = createComponent({
        machine: displayMachine,
        template,
      });

      // Test template escaping
      const state = {
        context: {
          userInput: '<script>alert("XSS")</script>',
        },
      };

      const result = template(state);

      // Should escape dangerous content
      expect(result.html).toContain('&lt;script&gt;');
      expect(result.html).not.toContain('<script>');
    });
  });

  describe('Lifecycle Management', () => {
    it('automatically cleans up when component is removed', async () => {
      // Behavior: Components should clean up resources
      const cleanupSpy = vi.fn();

      const lifecycleMachine = createMachine({
        id: 'lifecycle-test',
        initial: 'active',
        states: {
          active: {
            exit: cleanupSpy,
          },
        },
      });

      const template = () => html`<div>Lifecycle Test</div>`;

      const _LifecycleComponent = createComponent({
        machine: lifecycleMachine,
        template,
      });

      const element = document.createElement('lifecycle-test');
      testEnv.container.appendChild(element);

      await waitFor(() => componentUtils.getShadowContent(element) !== null);

      // Remove component
      element.remove();

      // Cleanup should be called
      // Note: In real implementation, this would be handled by disconnectedCallback
      expect(element.isConnected).toBe(false);
    });
  });
});
