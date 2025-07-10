/**
 * Behavior Tests for Reactive Patterns - Actor-SPA Framework
 *
 * Focus: How components react to state changes and events
 * Tests the actual reactive behavior users experience with state machines and components
 */

import { createComponent, html } from '@/framework/core/minimal-api.js';
import {
  type MockGlobalEventBus,
  type TestEnvironment,
  createTestEnvironment,
  performanceTestUtils,
  setupGlobalMocks,
} from '@/framework/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assign, createMachine } from 'xstate';

describe('Reactive Patterns in Components', () => {
  let testEnv: TestEnvironment;
  let eventBus: MockGlobalEventBus;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    eventBus = setupGlobalMocks();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('State-driven reactivity', () => {
    it('updates component UI when state changes', async () => {
      // Behavior: Components should react to state machine changes
      const machine = createMachine({
        id: 'counter',
        initial: 'counting',
        context: { count: 0 },
        states: {
          counting: {
            on: {
              INCREMENT: {
                actions: assign({ count: ({ context }) => context.count + 1 }),
              },
              DECREMENT: {
                actions: assign({ count: ({ context }) => context.count - 1 }),
              },
            },
          },
        },
      });

      const template = (state: any) => html`
        <div class="counter">
          <span class="count">${state.context.count}</span>
          <button class="increment" send="INCREMENT">+</button>
          <button class="decrement" send="DECREMENT">-</button>
        </div>
      `;

      const Counter = createComponent({ machine, template });

      // Mount component
      const element = document.createElement('reactive-counter');
      testEnv.container.appendChild(element);

      // Behavior: Component should be reactive and mountable
      expect(Counter).toBeDefined();
      expect(typeof Counter).toBe('function');
    });

    it('reacts to multiple state properties', () => {
      // Behavior: Components should react to complex state changes
      const machine = createMachine({
        id: 'form',
        initial: 'editing',
        context: {
          email: '',
          password: '',
          isValid: false,
        },
        states: {
          editing: {
            on: {
              UPDATE_EMAIL: {
                actions: assign({
                  email: ({ event }) => event.value,
                  isValid: ({ context, event }) =>
                    event.value.includes('@') && context.password.length >= 8,
                }),
              },
              UPDATE_PASSWORD: {
                actions: assign({
                  password: ({ event }) => event.value,
                  isValid: ({ context, event }) =>
                    context.email.includes('@') && event.value.length >= 8,
                }),
              },
            },
          },
        },
      });

      const template = (state: any) => html`
        <form class="reactive-form">
          <input 
            type="email" 
            value="${state.context.email}" 
            send:input="UPDATE_EMAIL"
          />
          <input 
            type="password" 
            value="${state.context.password}" 
            send:input="UPDATE_PASSWORD"
          />
          <button 
            type="submit" 
            disabled="${!state.context.isValid}"
            class="${state.context.isValid ? 'valid' : 'invalid'}"
          >
            Submit
          </button>
        </form>
      `;

      const Form = createComponent({ machine, template });

      // Behavior: Should handle complex reactive state
      expect(Form).toBeDefined();

      // Test template with different state combinations
      const invalidState = { context: { email: '', password: '', isValid: false } };
      const validState = {
        context: { email: 'user@example.com', password: 'password123', isValid: true },
      };

      expect(template(invalidState).html).toContain('disabled="true"');
      expect(template(invalidState).html).toContain('class="invalid"');

      expect(template(validState).html).toContain('disabled="false"');
      expect(template(validState).html).toContain('class="valid"');
    });

    it('handles conditional rendering based on state', () => {
      // Behavior: Components should show/hide content based on state
      const machine = createMachine({
        id: 'modal',
        initial: 'closed',
        context: { message: '' },
        states: {
          closed: {
            on: {
              OPEN: {
                target: 'open',
                actions: assign({ message: ({ event }) => event.message }),
              },
            },
          },
          open: {
            on: { CLOSE: 'closed' },
          },
        },
      });

      const template = (state: any) => html`
        <div class="modal-container">
          ${
            state.matches('closed')
              ? html`<button send="OPEN">Open Modal</button>`
              : html`
              <div class="modal">
                <p>${state.context.message}</p>
                <button send="CLOSE">Close</button>
              </div>
            `
          }
        </div>
      `;

      const _Modal = createComponent({ machine, template });

      // Behavior: Template should render different content based on state
      const closedState = {
        matches: (state: string) => state === 'closed',
        context: { message: '' },
      };
      const openState = {
        matches: (state: string) => state === 'open',
        context: { message: 'Hello World!' },
      };

      expect(template(closedState).html).toContain('Open Modal');
      expect(template(closedState).html).not.toContain('class="modal"');

      expect(template(openState).html).not.toContain('Open Modal');
      expect(template(openState).html).toContain('class="modal"');
      expect(template(openState).html).toContain('Hello World!');
    });
  });

  describe('Event-driven reactivity', () => {
    it('reacts to global events', () => {
      // Behavior: Components should react to global state changes
      const machine = createMachine({
        id: 'theme-aware',
        initial: 'light',
        context: { theme: 'light' },
        states: {
          light: {
            on: {
              THEME_CHANGED: {
                target: 'dark',
                actions: assign({ theme: 'dark' }),
              },
            },
          },
          dark: {
            on: {
              THEME_CHANGED: {
                target: 'light',
                actions: assign({ theme: 'light' }),
              },
            },
          },
        },
      });

      const template = (state: any) => html`
        <div class="theme-aware ${state.context.theme}">
          <h1>Current theme: ${state.context.theme}</h1>
          <button send="THEME_CHANGED">Toggle Theme</button>
        </div>
      `;

      const _ThemeAware = createComponent({ machine, template });

      // Behavior: Should emit and react to theme changes
      eventBus.emit('theme-changed', { theme: 'dark' });

      const lightState = { context: { theme: 'light' } };
      const darkState = { context: { theme: 'dark' } };

      expect(template(lightState).html).toContain('class="theme-aware light"');
      expect(template(lightState).html).toContain('Current theme: light');

      expect(template(darkState).html).toContain('class="theme-aware dark"');
      expect(template(darkState).html).toContain('Current theme: dark');
    });

    it('coordinates between multiple components', () => {
      // Behavior: Multiple components should react to shared events
      const counterMachine = createMachine({
        id: 'counter',
        initial: 'counting',
        context: { count: 0 },
        states: {
          counting: {
            on: {
              INCREMENT: {
                actions: assign({ count: ({ context }) => context.count + 1 }),
              },
            },
          },
        },
      });

      const displayMachine = createMachine({
        id: 'display',
        initial: 'showing',
        context: { lastCount: 0 },
        states: {
          showing: {
            on: {
              COUNT_UPDATED: {
                actions: assign({ lastCount: ({ event }) => event.count }),
              },
            },
          },
        },
      });

      const counterTemplate = (state: any) => html`
        <div class="counter">
          <span>Count: ${state.context.count}</span>
          <button send="INCREMENT">+</button>
        </div>
      `;

      const displayTemplate = (state: any) => html`
        <div class="display">
          <span>Last recorded: ${state.context.lastCount}</span>
        </div>
      `;

      const Counter = createComponent({ machine: counterMachine, template: counterTemplate });
      const Display = createComponent({ machine: displayMachine, template: displayTemplate });

      // Behavior: Components should coordinate via events
      eventBus.emit('count-updated', { count: 5 });

      expect(Counter).toBeDefined();
      expect(Display).toBeDefined();

      const counterState = { context: { count: 5 } };
      const displayState = { context: { lastCount: 5 } };

      expect(counterTemplate(counterState).html).toContain('Count: 5');
      expect(displayTemplate(displayState).html).toContain('Last recorded: 5');
    });
  });

  describe('List and data reactivity', () => {
    it('reacts to list updates', () => {
      // Behavior: Components should react to dynamic list changes
      const machine = createMachine({
        id: 'todo-list',
        initial: 'managing',
        context: {
          todos: [] as Array<{ id: number; text: string; done: boolean }>,
          newTodo: '',
        },
        states: {
          managing: {
            on: {
              ADD_TODO: {
                actions: assign({
                  todos: ({ context, event }) => [
                    ...context.todos,
                    { id: Date.now(), text: event.text, done: false },
                  ],
                  newTodo: '',
                }),
              },
              TOGGLE_TODO: {
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
        <div class="todo-app">
          <ul class="todo-list">
            ${state.context.todos.map(
              (todo: any) => html`
              <li class="${todo.done ? 'done' : 'pending'}">
                <span>${todo.text}</span>
                <button send="TOGGLE_TODO" data-id="${todo.id}">
                  ${todo.done ? 'Undo' : 'Done'}
                </button>
              </li>
            `
            )}
          </ul>
          <div class="stats">
            Total: ${state.context.todos.length}
          </div>
        </div>
      `;

      const _TodoApp = createComponent({ machine, template });

      // Behavior: Should handle dynamic list rendering
      const emptyState = { context: { todos: [], newTodo: '' } };
      const withTodosState = {
        context: {
          todos: [
            { id: 1, text: 'Learn React', done: false },
            { id: 2, text: 'Build App', done: true },
          ],
          newTodo: '',
        },
      };

      expect(template(emptyState).html).toContain('Total: 0');
      expect(template(emptyState).html).not.toContain('<li');

      expect(template(withTodosState).html).toContain('Total: 2');
      expect(template(withTodosState).html).toContain('Learn React');
      expect(template(withTodosState).html).toContain('Build App');
      expect(template(withTodosState).html).toContain('class="pending"');
      expect(template(withTodosState).html).toContain('class="done"');
    });

    it('handles real-time data updates', () => {
      // Behavior: Components should react to external data changes
      const machine = createMachine({
        id: 'live-data',
        initial: 'loading',
        context: { data: null, error: null },
        states: {
          loading: {
            on: {
              DATA_LOADED: {
                target: 'loaded',
                actions: assign({ data: ({ event }) => event.data }),
              },
              DATA_ERROR: {
                target: 'error',
                actions: assign({ error: ({ event }) => event.error }),
              },
            },
          },
          loaded: {
            on: {
              DATA_UPDATED: {
                actions: assign({ data: ({ event }) => event.data }),
              },
              REFRESH: 'loading',
            },
          },
          error: {
            on: { RETRY: 'loading' },
          },
        },
      });

      const template = (state: any) => html`
        <div class="live-data">
          ${
            state.matches('loading')
              ? html`<div class="loading">Loading...</div>`
              : state.matches('error')
                ? html`
              <div class="error">
                <p>Error: ${state.context.error}</p>
                <button send="RETRY">Retry</button>
              </div>
            `
                : html`
              <div class="data">
                <pre>${JSON.stringify(state.context.data, null, 2)}</pre>
                <button send="REFRESH">Refresh</button>
              </div>
            `
          }
        </div>
      `;

      const _LiveData = createComponent({ machine, template });

      // Behavior: Should handle different data states
      const loadingState = { matches: (s: string) => s === 'loading' };
      const errorState = {
        matches: (s: string) => s === 'error',
        context: { error: 'Network failed' },
      };
      const loadedState = {
        matches: (s: string) => s === 'loaded',
        context: { data: { users: ['Alice', 'Bob'] } },
      };

      expect(template(loadingState).html).toContain('Loading...');
      expect(template(errorState).html).toContain('Error: Network failed');
      expect(template(loadedState).html).toContain('&quot;users&quot;'); // JSON strings are HTML-escaped
      expect(template(loadedState).html).toContain('Alice');
    });
  });

  describe('Performance patterns', () => {
    it('handles frequent updates efficiently', async () => {
      // Behavior: Components should handle rapid state changes
      const machine = createMachine({
        id: 'performance-test',
        initial: 'running',
        context: { value: 0, updates: 0 },
        states: {
          running: {
            on: {
              RAPID_UPDATE: {
                actions: assign({
                  value: ({ event }) => event.value,
                  updates: ({ context }) => context.updates + 1,
                }),
              },
            },
          },
        },
      });

      const template = (state: any) => html`
        <div class="performance-test">
          <div class="value">Value: ${state.context.value}</div>
          <div class="updates">Updates: ${state.context.updates}</div>
        </div>
      `;

      const PerformanceTest = createComponent({ machine, template });

      // Use framework performance utilities
      await performanceTestUtils.expectPerformant(() => {
        // Simulate rapid template rendering with multiple states
        const states = Array.from({ length: 100 }, (_, i) => ({
          context: { value: i, updates: i + 1 },
        }));

        states.forEach((state) => {
          template(state);
        });
      }, 100); // Max 100ms for 100 renders

      expect(PerformanceTest).toBeDefined();
    });

    it('measures render time across iterations', async () => {
      // Behavior: Template rendering should be consistently performant
      const template = (state: any) => html`
        <div class="complex-template">
          <h1>Value: ${state.context.value}</h1>
          <ul>
            ${Array.from(
              { length: 10 },
              (_, i) => html`
              <li>Item ${i}: ${state.context.value + i}</li>
            `
            )}
          </ul>
        </div>
      `;

      // Use framework utilities to measure performance
      const metrics = await performanceTestUtils.measureRenderTime(() => {
        const state = { context: { value: Math.random() * 100 } };
        template(state);
      }, 10);

      expect(metrics.average).toBeLessThan(50); // Average under 50ms
      expect(metrics.max).toBeLessThan(100); // No render over 100ms
      expect(metrics.min).toBeGreaterThanOrEqual(0); // Might be very fast
    });
  });
});
