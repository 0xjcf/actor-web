/**
 * Behavior Tests for Reactive State Observers - Actor-SPA Framework
 *
 * Focus: Testing reactive patterns with observables and template updates
 * Following Testing Guide principles: real APIs, behavior-focused, proper types
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assign, createMachine, type EventObject, type SnapshotFrom } from 'xstate';
import { Logger } from '@/core/dev-mode.js';
import {
  createTestEnvironment,
  setupGlobalMocks,
  type TestEnvironment,
} from '@/testing/actor-test-utils';
import { ReactiveTestManager } from '@/testing/reactive-test-adapters';
import { html } from './minimal-api.js';
import type { RawHTML } from './template-renderer.js';

const log = Logger.namespace('REACTIVE_OBSERVERS_TEST');

// Properly typed events for our tests
interface FormUpdateEvent extends EventObject {
  type: 'UPDATE_EMAIL' | 'UPDATE_PASSWORD';
  value: string;
}

interface ModalEvent extends EventObject {
  type: 'OPEN';
  message: string;
}

interface ModalCloseEvent extends EventObject {
  type: 'CLOSE';
}

interface ThemeChangeEvent extends EventObject {
  type: 'THEME_CHANGED';
  theme: string;
}

type FormEvents = FormUpdateEvent;
type ModalEvents = ModalEvent | ModalCloseEvent;
type ThemeEvents = ThemeChangeEvent;

describe('Reactive State Observers', () => {
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();
    log.debug('Test environment initialized for reactive observers');
  });

  afterEach(() => {
    testEnv.cleanup();
    log.debug('Test environment cleaned up');
  });

  describe('Component Template Reactivity', () => {
    it('reacts to multiple state properties', async () => {
      // Behavior: Templates should react to context changes across multiple properties
      const machine = createMachine({
        id: 'form-validation',
        initial: 'invalid',
        context: {
          email: '',
          password: '',
          isValid: false,
        },
        types: {
          events: {} as FormEvents,
        },
        states: {
          invalid: {
            on: {
              UPDATE_EMAIL: {
                actions: assign({
                  email: ({ event }) => event.value,
                  isValid: ({ context, event }) => {
                    const newEmail = event.value;
                    return newEmail.includes('@') && context.password.length >= 8;
                  },
                }),
                target: 'validating',
              },
              UPDATE_PASSWORD: {
                actions: assign({
                  password: ({ event }) => event.value,
                  isValid: ({ context, event }) => {
                    const newPassword = event.value;
                    return context.email.includes('@') && newPassword.length >= 8;
                  },
                }),
                target: 'validating',
              },
            },
          },
          validating: {
            always: [
              { target: 'valid', guard: ({ context }) => context.isValid },
              { target: 'invalid' },
            ],
          },
          valid: {
            on: {
              UPDATE_EMAIL: {
                actions: assign({
                  email: ({ event }) => event.value,
                  isValid: ({ context, event }) => {
                    const newEmail = event.value;
                    return newEmail.includes('@') && context.password.length >= 8;
                  },
                }),
                target: 'validating',
              },
              UPDATE_PASSWORD: {
                actions: assign({
                  password: ({ event }) => event.value,
                  isValid: ({ context, event }) => {
                    const newPassword = event.value;
                    return context.email.includes('@') && newPassword.length >= 8;
                  },
                }),
                target: 'validating',
              },
            },
          },
        },
      });

      // Template that reacts to multiple context properties
      const template = (state: SnapshotFrom<typeof machine>): RawHTML => html`
        <div class="form-container">
          <form>
            <input 
              type="email" 
              placeholder="Email" 
              value="${state.context.email}"
              class="${state.context.isValid ? 'valid' : 'invalid'}"
            />
            <input 
              type="password" 
              placeholder="Password" 
              value="${state.context.password}"
            />
            <button 
              type="submit" 
              ${state.context.isValid ? '' : 'disabled'}
            >
              Submit
            </button>
          </form>
        </div>
      `;

      // ✅ TESTING-GUIDE.md: Use real framework API behavior testing
      const testManager = new ReactiveTestManager(machine);
      const initialSnapshot = testManager.start();

      log.debug('Form test manager started');

      // Test initial invalid state - use real snapshot
      expect(template(initialSnapshot).html).toContain('disabled');
      expect(template(initialSnapshot).html).toContain('class="invalid"');

      // Test valid state after updates - use real events and snapshots
      testManager.send({ type: 'UPDATE_EMAIL', value: 'user@example.com' } as FormUpdateEvent);
      const finalSnapshot = testManager.send({
        type: 'UPDATE_PASSWORD',
        value: 'password123',
      } as FormUpdateEvent);

      // When button is enabled, no disabled attribute should be present
      expect(template(finalSnapshot).html).not.toContain('disabled');
      expect(template(finalSnapshot).html).toContain('class="valid"');
      expect(finalSnapshot.context.isValid).toBe(true);

      // Clean up
      await testManager.cleanup();
    });

    it('handles conditional rendering based on state', async () => {
      // Behavior: Components should show/hide content based on state
      const machine = createMachine({
        id: 'modal',
        initial: 'closed',
        context: { message: '' },
        types: {
          events: {} as ModalEvents,
        },
        states: {
          closed: {
            on: {
              OPEN: {
                target: 'open',
                actions: assign({
                  message: ({ event }) => event.message,
                }),
              },
            },
          },
          open: {
            on: { CLOSE: 'closed' },
          },
        },
      });

      // Template using matches() method from XState snapshot
      const template = (state: SnapshotFrom<typeof machine>): RawHTML => html`
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

      // ✅ TESTING-GUIDE.md: Use real framework API and snapshots
      const testManager = new ReactiveTestManager(machine);
      const closedSnapshot = testManager.start();

      // Test closed state with real snapshot - XState snapshots have matches()
      expect(template(closedSnapshot).html).toContain('Open Modal');
      expect(template(closedSnapshot).html).not.toContain('class="modal"');

      // Test open state with real snapshot
      const openSnapshot = testManager.send({
        type: 'OPEN',
        message: 'Hello from modal!',
      } as ModalEvent);

      expect(template(openSnapshot).html).toContain('Hello from modal!');
      expect(template(openSnapshot).html).toContain('class="modal"');
      expect(template(openSnapshot).html).not.toContain('Open Modal');

      // Clean up
      await testManager.cleanup();
    });
  });

  describe('Event Bus Integration', () => {
    it('reacts to global events through event bus', async () => {
      // Behavior: Components should react to global theme changes
      const machine = createMachine({
        id: 'theme-display',
        initial: 'light',
        context: { theme: 'light' },
        types: {
          events: {} as ThemeEvents,
        },
        states: {
          light: {
            on: {
              THEME_CHANGED: {
                actions: assign({
                  theme: ({ event }) => (event as ThemeChangeEvent).theme,
                }),
                target: 'dark',
                guard: ({ event }) => (event as ThemeChangeEvent).theme === 'dark',
              },
            },
          },
          dark: {
            on: {
              THEME_CHANGED: {
                actions: assign({
                  theme: ({ event }) => (event as ThemeChangeEvent).theme,
                }),
                target: 'light',
                guard: ({ event }) => (event as ThemeChangeEvent).theme === 'light',
              },
            },
          },
        },
      });

      const template = (state: SnapshotFrom<typeof machine>): RawHTML => html`
        <div class="app ${state.context.theme}">
          <h1>Current Theme: ${state.context.theme}</h1>
        </div>
      `;

      // ✅ TESTING-GUIDE.md: Use real framework API and state transitions
      const testManager = new ReactiveTestManager(machine);
      const lightSnapshot = testManager.start();

      // Test initial light theme
      expect(template(lightSnapshot).html).toContain('class="app light"');
      expect(template(lightSnapshot).html).toContain('Current Theme: light');

      // Test theme change to dark
      const darkSnapshot = testManager.send({
        type: 'THEME_CHANGED',
        theme: 'dark',
      } as ThemeChangeEvent);

      expect(template(darkSnapshot).html).toContain('class="app dark"');
      expect(template(darkSnapshot).html).toContain('Current Theme: dark');

      // Clean up
      await testManager.cleanup();
    });
  });
});
