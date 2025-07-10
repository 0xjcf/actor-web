/**
 * Behavior Tests for Development Mode - Actor-SPA Framework
 *
 * Focus: Testing development-time template validation and machine registration
 * Tests the enhanced developer experience features for runtime validation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMachine } from 'xstate';
import {
  enableDevMode,
  inspectTemplate,
  registerMachine,
  resetDevMode,
  validateTemplate,
} from './dev-mode.js';

// Type definition for the dev mode API
interface ActorSPADevMode {
  inspectTemplate: typeof inspectTemplate;
  validateTemplate: typeof validateTemplate;
  listMachines: () => string[];
  getMachine: (id: string) => unknown;
}

declare global {
  interface Window {
    __actorSPA?: ActorSPADevMode;
  }
}

describe('Development Mode', () => {
  let originalWindow: typeof window;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleGroupSpy: ReturnType<typeof vi.spyOn>;
  let consoleGroupEndSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Clear any previous state
    originalWindow = global.window;

    // Reset dev mode state
    resetDevMode();

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
    consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore window
    global.window = originalWindow;

    // Reset dev mode
    resetDevMode();

    // Clear all mocks
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('enableDevMode', () => {
    it('enables dev mode and sets up global helper', () => {
      // Behavior: Dev mode should add global helpers for template inspection
      enableDevMode();

      const actorSPA = window.__actorSPA;
      expect(actorSPA).toBeDefined();
      expect(actorSPA.inspectTemplate).toBeDefined();
      expect(actorSPA.validateTemplate).toBeDefined();
      expect(actorSPA.listMachines).toBeDefined();
      expect(actorSPA.getMachine).toBeDefined();
    });

    it('does not enable dev mode if window is undefined', () => {
      // Behavior: Server-side rendering should not break
      (global as typeof globalThis & { window?: Window }).window = undefined;

      enableDevMode();

      expect((global as typeof globalThis & { __actorSPA?: ActorSPADevMode }).__actorSPA).toBeUndefined();
    });

    it('only enables dev mode once', () => {
      // Behavior: Multiple calls should not reset state
      enableDevMode();
      const firstInstance = window.__actorSPA;

      enableDevMode();
      const secondInstance = window.__actorSPA;

      expect(firstInstance).toBe(secondInstance);
    });
  });

  describe('registerMachine', () => {
    it('registers machine when dev mode is enabled', () => {
      // Behavior: Machines should be available for validation
      enableDevMode();

      const machine = createMachine({
        id: 'test-machine',
        initial: 'idle',
        states: { idle: {} },
      });

      registerMachine(machine);

      const actorSPA = window.__actorSPA;
      expect(actorSPA.listMachines()).toContain('test-machine');
      expect(actorSPA.getMachine('test-machine')).toBe(machine);
    });

    it('does not register machine when dev mode is disabled', () => {
      // Behavior: No-op in production
      const machine = createMachine({
        id: 'test-machine',
        initial: 'idle',
        states: { idle: {} },
      });

      registerMachine(machine);

      // Dev mode not enabled, so no global helper
      expect(window.__actorSPA).toBeUndefined();
    });
  });

  describe('validateTemplate', () => {
    beforeEach(() => {
      enableDevMode();
    });

    it('validates event attributes', () => {
      // Behavior: Should extract and validate send events
      const html = `
        <button send="CLICK">Click me</button>
        <button data-action="SUBMIT">Submit</button>
      `;

      const result = validateTemplate(html);

      expect(result.patterns.events).toEqual(['CLICK', 'SUBMIT']);
      // isValid should be false due to mixing send and data-action
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'inconsistent-event-syntax')).toBe(true);
    });

    it('validates state references', () => {
      // Behavior: Should extract state.matches patterns
      const html = `
        <div class="${'${'}state.matches('loading') ? 'loading' : ''}">
          ${'${'}state.matches('error') ? 'Error!' : ''}
        </div>
      `;

      const result = validateTemplate(html);

      expect(result.patterns.stateReferences).toEqual(['loading', 'error']);
      expect(result.patterns.hasStateValue).toBe(false);
    });

    it('validates context properties', () => {
      // Behavior: Should extract context access patterns
      const html = `
        <div>Count: ${'${'}state.context.count}</div>
        <div>Name: ${'${'}state.context.userName}</div>
      `;

      const result = validateTemplate(html);

      expect(result.patterns.contextProperties).toEqual(['count', 'userName']);
    });

    it('validates ARIA attributes', () => {
      // Behavior: Should extract ARIA attribute usage
      const html = `
        <button aria-pressed="true" data-aria-expanded="false">
          Toggle
        </button>
      `;

      const result = validateTemplate(html);

      expect(result.patterns.ariaAttributes).toEqual(['pressed', 'expanded']);
    });

    it('validates payload attributes', () => {
      // Behavior: Should extract payload attributes
      const html = `
        <button send="DELETE" payload="item-1">Delete</button>
        <button send="UPDATE" payload="data-123">Update</button>
      `;

      const result = validateTemplate(html);

      expect(result.patterns.payloads).toEqual(['item-1', 'data-123']);
    });

    it('validates against registered machine', () => {
      // Behavior: Should validate events and states against machine definition
      const machine = createMachine({
        id: 'test-machine',
        initial: 'idle',
        states: {
          idle: {
            on: {
              START: 'running',
            },
          },
          running: {
            on: {
              STOP: 'idle',
            },
          },
        },
      });

      registerMachine(machine);

      // Valid template
      const validHtml = `
        <button send="START">Start</button>
        <div class="${'${'}state.matches('running') ? 'active' : ''}">
          Running...
        </div>
      `;

      const validResult = validateTemplate(validHtml, 'test-machine');
      expect(validResult.isValid).toBe(true);
      expect(validResult.issues).toEqual([]);

      // Invalid template
      const invalidHtml = `
        <button send="INVALID_EVENT">Invalid</button>
        <div class="${'${'}state.matches('invalid_state') ? 'active' : ''}">
          Invalid
        </div>
      `;

      const invalidResult = validateTemplate(invalidHtml, 'test-machine');
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.issues).toHaveLength(2);
      expect(invalidResult.issues[0].type).toBe('invalid-event');
      expect(invalidResult.issues[1].type).toBe('invalid-state');
    });

    it('provides suggestions for typos', () => {
      // Behavior: Should suggest closest match for typos
      const machine = createMachine({
        id: 'test-machine',
        initial: 'idle',
        states: {
          idle: {
            on: {
              START: 'running',
              STOP: 'idle',
            },
          },
          running: {},
        },
      });

      registerMachine(machine);

      const html = `
        <button send="STRAT">Start</button>
        <div class="${'${'}state.matches('runing') ? 'active' : ''}">
          Running...
        </div>
      `;

      const result = validateTemplate(html, 'test-machine');

      expect(result.issues[0].suggestion).toBe('Did you mean "START"?');
      expect(result.issues[1].suggestion).toBe('Did you mean "running"?');
    });

    it('validates nested states', () => {
      // Behavior: Should validate compound state references
      const machine = createMachine({
        id: 'test-machine',
        initial: 'auth',
        states: {
          auth: {
            initial: 'idle',
            states: {
              idle: {},
              loading: {},
              error: {},
            },
          },
        },
      });

      registerMachine(machine);

      const html = `
        <div class="${'${'}state.matches('auth.loading') ? 'loading' : ''}">
          Loading...
        </div>
      `;

      const result = validateTemplate(html, 'test-machine');

      expect(result.isValid).toBe(true);
    });

    it('detects unconventional context property names', () => {
      // Behavior: Should suggest conventional naming for accessibility properties
      const html = `
        <div aria-busy="${'${'}state.context.busy}">
          <div aria-expanded="${'${'}state.context.expanded}">
            Content
          </div>
        </div>
      `;

      const result = validateTemplate(html);

      const contextIssues = result.issues.filter((i) => i.type === 'unconventional-context');
      expect(contextIssues).toHaveLength(2);
      expect(contextIssues[0].suggestion).toContain('isBusy');
      expect(contextIssues[1].suggestion).toContain('isExpanded');
    });

    it('warns about mixed event syntax', () => {
      // Behavior: Should detect inconsistent event attribute usage
      const html = `
        <button send="CLICK">Click</button>
        <button data-action="SUBMIT">Submit</button>
      `;

      const result = validateTemplate(html);

      const syntaxIssue = result.issues.find((i) => i.type === 'inconsistent-event-syntax');
      expect(syntaxIssue).toBeDefined();
      expect(syntaxIssue?.severity).toBe('info');
    });
  });

  describe('inspectTemplate', () => {
    beforeEach(() => {
      enableDevMode();
    });

    it('logs validation results for templates', () => {
      // Behavior: Should provide helpful console output for debugging
      const template = { html: '<button send="CLICK">Click</button>' };

      inspectTemplate(template);

      expect(consoleGroupSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleGroupEndSpy).toHaveBeenCalled();
    });

    it('logs issues with suggestions', () => {
      // Behavior: Should log validation issues with helpful suggestions
      const machine = createMachine({
        id: 'test-machine',
        initial: 'idle',
        states: {
          idle: {
            on: {
              START: 'running',
            },
          },
          running: {},
        },
      });

      registerMachine(machine);

      const template = { html: '<button send="STRAT">Start</button>' };

      inspectTemplate(template, 'test-machine');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Did you mean "START"?'));
    });

    it('does nothing when dev mode is disabled', () => {
      // Explicitly disable dev mode after beforeEach enables it
      resetDevMode();

      const template = { html: '<button send="CLICK">Click</button>' };

      inspectTemplate(template);

      expect(consoleGroupSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      enableDevMode();
    });

    it('handles empty templates', () => {
      // Behavior: Should handle empty strings gracefully
      const result = validateTemplate('');

      expect(result.isValid).toBe(true);
      expect(result.patterns.events).toEqual([]);
      expect(result.patterns.stateReferences).toEqual([]);
    });

    it('handles templates with no patterns', () => {
      // Behavior: Static HTML should validate successfully
      const html = '<div>Hello World</div>';

      const result = validateTemplate(html);

      expect(result.isValid).toBe(true);
      expect(result.patterns.events).toEqual([]);
    });

    it('handles malformed patterns gracefully', () => {
      // Behavior: Should not crash on unusual patterns
      const html = `
        <button send="">Empty</button>
        <div class="\${state.matches() ? 'active' : ''}">Bad</div>
        <span>\${state.context.}</span>
      `;

      const result = validateTemplate(html);

      // Should now capture empty string
      expect(result.patterns.events).toContain('');
      // But should still be valid since no specific errors
      expect(result.isValid).toBe(true);
    });

    it('handles very long state names', () => {
      // Behavior: Should handle realistic nested state names
      const machine = createMachine({
        id: 'complex-machine',
        initial: 'app',
        states: {
          app: {
            initial: 'dashboard',
            states: {
              dashboard: {
                initial: 'widgets',
                states: {
                  widgets: {
                    initial: 'loading',
                    states: {
                      loading: {},
                      loaded: {},
                    },
                  },
                },
              },
            },
          },
        },
      });

      registerMachine(machine);

      const html = `
        <div class="${'${'}state.matches('app.dashboard.widgets.loading') ? 'loading' : ''}">
          Loading widgets...
        </div>
      `;

      const result = validateTemplate(html, 'complex-machine');

      expect(result.isValid).toBe(true);
    });
  });

  describe('Real-world Patterns', () => {
    beforeEach(() => {
      enableDevMode();
    });

    it('validates complex form template', () => {
      // Behavior: Should validate realistic form patterns
      const machine = createMachine({
        id: 'form-machine',
        initial: 'ready',
        context: {
          errors: [] as string[],
          isSubmitting: false,
        },
        states: {
          ready: {
            on: {
              SUBMIT: 'validating',
            },
          },
          validating: {
            on: {
              VALID: 'submitting',
              INVALID: 'ready',
            },
          },
          submitting: {
            on: {
              SUCCESS: 'complete',
              ERROR: 'ready',
            },
          },
          complete: {},
        },
      });

      registerMachine(machine);

      const html = `
        <form send:submit="SUBMIT">
          <div class="${'${'}state.matches('validating') ? 'validating' : ''}">
            <input 
              type="email" 
              aria-invalid="${'${'}state.context.errors.length > 0}"
              disabled="${'${'}state.context.isSubmitting}"
            />
            <button 
              type="submit" 
              aria-busy="${'${'}state.matches('submitting')}"
            >
              ${'${'}state.matches('submitting') ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      `;

      const result = validateTemplate(html, 'form-machine');

      expect(result.isValid).toBe(true);
      expect(result.patterns.events).toContain('SUBMIT');
      expect(result.patterns.stateReferences).toContain('validating');
      expect(result.patterns.stateReferences).toContain('submitting');
    });

    it('validates list component with keyboard navigation', () => {
      // Behavior: Should validate list patterns with ARIA
      const machine = createMachine({
        id: 'list-machine',
        initial: 'idle',
        context: {
          items: [],
          selectedIndex: -1,
          isLoading: false,
        },
        states: {
          idle: {
            on: {
              SELECT: 'idle',
              LOAD: 'loading',
            },
          },
          loading: {
            on: {
              LOADED: 'idle',
              ERROR: 'error',
            },
          },
          error: {},
        },
      });

      registerMachine(machine);

      const html = `
        <ul 
          role="listbox" 
          aria-busy="\${state.context.isLoading}"
        >
          \${state.context.items.map((item, index) => \`
            <li 
              role="option"
              aria-selected="\${index === state.context.selectedIndex}"
              send="SELECT"
              payload="\${index}"
            >
              \${item.name}
            </li>
          \`).join('')}
        </ul>
      `;

      const result = validateTemplate(html, 'list-machine');

      // The template includes complex JS so it might have issues
      // but should extract the patterns correctly
      expect(result.patterns.events).toContain('SELECT');
      expect(result.patterns.contextProperties).toContain('isLoading');
      expect(result.patterns.contextProperties).toContain('items');
      expect(result.patterns.contextProperties).toContain('selectedIndex');
      // Check that unconventional naming issue is detected
      const hasUnconventionalIssue = result.issues.some((i) => i.type === 'unconventional-context');
      expect(hasUnconventionalIssue).toBe(true);
    });
  });
});
