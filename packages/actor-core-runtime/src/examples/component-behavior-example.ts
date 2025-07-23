/**
 * @module actor-core/runtime/examples/component-behavior-example
 * @description Example demonstrating the unified component behavior API
 *
 * This example shows how to use the new ComponentBehaviorConfig interface
 * with defineBehavior() for consistent developer experience across actors
 * and components.
 */

import { createMachine } from 'xstate';
import type { JsonValue } from '../actor-system.js';
import { componentBehavior, type SerializableEvent } from '../component-behavior.js';
import { defineBehavior } from '../create-actor.js';
import { createComponent } from '../create-component.js';
import { Logger } from '../logger.js';

const log = Logger.namespace('COMPONENT_BEHAVIOR_EXAMPLE');

// ============================================================================
// EXAMPLE 1: Form Component with Backend Integration
// ============================================================================

// Define the form's UI state machine
const _formMachine = createMachine({
  id: 'form',
  initial: 'editing',
  context: {
    formData: {} as Record<string, JsonValue>,
    errors: [] as string[],
    lastSaveTime: null as number | null,
  },
  states: {
    editing: {
      on: {
        UPDATE_FIELD: {
          actions: 'updateField',
        },
        SUBMIT: 'validating',
      },
    },
    validating: {
      on: {
        VALIDATION_SUCCESS: 'saving',
        VALIDATION_ERROR: {
          target: 'editing',
          actions: 'setErrors',
        },
      },
    },
    saving: {
      on: {
        SAVE_SUCCESS: 'saved',
        SAVE_ERROR: {
          target: 'editing',
          actions: 'setErrors',
        },
      },
    },
    saved: {
      after: {
        2000: 'editing',
      },
    },
  },
});

// Define message types for the form component
type FormMessage =
  | { type: 'FORM_SUBMIT_REQUESTED'; formId: string }
  | { type: 'BACKEND_RESPONSE'; success: boolean; errors?: string[] }
  | { type: 'CLEAR_FORM' };

type FormContext = {
  formId: string;
  lastBackendResponse: unknown;
  submitCount: number;
};

type FormEvent =
  | { type: 'FORM_SUBMITTED'; formId: string; data: JsonValue }
  | { type: 'FORM_CLEARED'; formId: string }
  | { type: 'VALIDATION_FAILED'; errors: string[] };

// Create the form behavior using the new unified API
const _formBehavior = defineBehavior<FormMessage, FormContext, FormEvent>({
  context: {
    formId: 'user-profile',
    lastBackendResponse: null,
    submitCount: 0,
  },

  // Component-specific handler with machine, dependencies, and emit
  onMessage: async ({ message, context, machine, dependencies, emit }) => {
    log.info('Form component received message', { type: message.type });

    switch (message.type) {
      case 'FORM_SUBMIT_REQUESTED': {
        // Get form data from XState machine
        const machineState = machine.getSnapshot();
        const formData = machineState.context.formData;

        // Send to backend via dependency
        if (dependencies.backend) {
          await dependencies.backend.send({
            type: 'SAVE_FORM',
            payload: { formId: message.formId, data: formData },
            timestamp: Date.now(),
            version: '1.0.0',
          });
        }

        // Emit domain event
        emit({ type: 'FORM_SUBMITTED', formId: message.formId, data: formData });

        return {
          context: {
            ...context,
            submitCount: context.submitCount + 1,
          },
        };
      }

      case 'BACKEND_RESPONSE': {
        if (!message.success && message.errors) {
          // Send validation errors to XState machine
          machine.send({ type: 'VALIDATION_ERROR', errors: message.errors });

          // Emit validation failed event
          emit({ type: 'VALIDATION_FAILED', errors: message.errors });
        }

        return {
          context: {
            ...context,
            lastBackendResponse: { success: message.success, errors: message.errors },
          },
        };
      }

      case 'CLEAR_FORM': {
        // Reset XState machine
        machine.send({ type: 'RESET' });

        // Emit cleared event
        emit({ type: 'FORM_CLEARED', formId: context.formId });

        return {
          context: {
            ...context,
            lastBackendResponse: null,
            submitCount: 0,
          },
        };
      }

      default:
        return { context };
    }
  },

  // Component dependencies
  dependencies: {
    backend: 'actor://system/backend',
    validator: 'actor://system/validator',
  },

  // Mailbox configuration
  mailbox: {
    capacity: 100,
    strategy: 'drop-oldest',
  },

  // Transport configuration
  transport: 'local',
});

// ============================================================================
// EXAMPLE 2: Using the Component Behavior Builder
// ============================================================================

// Counter component with analytics integration
type CounterMessage =
  | { type: 'INCREMENT'; step: number }
  | { type: 'DECREMENT'; step: number }
  | { type: 'RESET' };

type CounterContext = {
  count: number;
  changeHistory: number[];
};

type CounterEvent =
  | { type: 'COUNT_CHANGED'; oldValue: number; newValue: number }
  | { type: 'COUNT_RESET'; previousValue: number };

// Use the fluent builder API
const _counterBehavior = componentBehavior<CounterMessage, CounterContext, CounterEvent>()
  .context({
    count: 0,
    changeHistory: [],
  })
  .onMessage(async ({ message, context, dependencies, emit }) => {
    const oldCount = context.count;
    let newCount = oldCount;

    switch (message.type) {
      case 'INCREMENT':
        newCount = oldCount + message.step;
        emit({
          type: 'COUNT_CHANGED',
          oldValue: oldCount,
          newValue: newCount,
        } as SerializableEvent<CounterEvent>);
        break;

      case 'DECREMENT':
        newCount = oldCount - message.step;
        emit({
          type: 'COUNT_CHANGED',
          oldValue: oldCount,
          newValue: newCount,
        } as SerializableEvent<CounterEvent>);
        break;

      case 'RESET':
        newCount = 0;
        emit({ type: 'COUNT_RESET', previousValue: oldCount } as SerializableEvent<CounterEvent>);
        break;
    }

    // Send analytics if available
    if (dependencies.analytics && newCount !== oldCount) {
      await dependencies.analytics.send({
        type: 'TRACK_EVENT',
        payload: {
          event: 'counter_changed',
          properties: { from: oldCount, to: newCount },
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });
    }

    return {
      context: {
        count: newCount,
        changeHistory: [...context.changeHistory, newCount].slice(-10), // Keep last 10
      },
    };
  })
  .dependencies({
    analytics: 'capability://analytics',
  })
  .mailbox({ capacity: 50, strategy: 'suspend' })
  .transport('worker') // Run in Web Worker for performance
  .build();

// ============================================================================
// EXAMPLE 3: Creating Components with Unified Behaviors
// ============================================================================

// Template functions for rendering
const _formTemplate = (state: unknown) => {
  if (!state || typeof state !== 'object') return '<div>Loading...</div>';

  const typedState = state as {
    value: string;
    context: { formData: Record<string, JsonValue>; errors: string[] };
  };

  return `
    <form>
      <input name="username" value="${typedState.context.formData.username || ''}" />
      <button type="submit" ${typedState.value === 'saving' ? 'disabled' : ''}>
        ${typedState.value === 'saving' ? 'Saving...' : 'Save'}
      </button>
      ${typedState.context.errors.map((err) => `<p class="error">${err}</p>`).join('')}
    </form>
  `;
};

const counterTemplate = (state: unknown) => {
  if (!state || typeof state !== 'object') return '<div>Loading...</div>';

  const typedState = state as { context: { count: number } };

  return `
    <div class="counter">
      <button send="DECREMENT" data-step="1">-</button>
      <span>${typedState.context.count}</span>
      <button send="INCREMENT" data-step="1">+</button>
      <button send="RESET">Reset</button>
    </div>
  `;
};

// Create a simple actor behavior for demonstration
// NOTE: In the next iteration, createComponent will accept ComponentBehaviorConfig directly
const simpleCounterBehavior = defineBehavior({
  context: { count: 0 },
  onMessage: async ({ message, context }) => {
    if (message.type === 'INCREMENT') {
      return {
        context: { count: (context as { count: number }).count + 1 },
        emit: {
          type: 'COUNT_CHANGED',
          payload: { value: (context as { count: number }).count + 1 },
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };
    }
    return { context };
  },
});

// Create components
export const CounterComponent = createComponent({
  machine: createMachine({
    id: 'counter',
    initial: 'active',
    context: { count: 0 },
    states: {
      active: {
        on: {
          INCREMENT: { actions: 'increment' },
          DECREMENT: { actions: 'decrement' },
          RESET: { actions: 'reset' },
        },
      },
    },
  }),
  template: counterTemplate,
  behavior: simpleCounterBehavior, // Current API - takes ActorBehavior
});

// ============================================================================
// FUTURE API PREVIEW
// ============================================================================

// This shows how the API will work once createComponent is updated to accept
// ComponentBehaviorConfig directly:

/*
// Future API - createComponent will accept ComponentBehaviorConfig
export const FormComponentFuture = createComponent({
  machine: formMachine,
  template: formTemplate,
  behavior: formBehavior, // ✅ ComponentBehaviorConfig directly!
});

export const CounterComponentFuture = createComponent({
  machine: counterMachine,
  template: counterTemplate,
  behavior: counterBehavior, // ✅ Built with componentBehavior()
});
*/

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

export async function demonstrateUnifiedAPI() {
  log.info('🚀 Demonstrating Unified Component Behavior API');

  // Create counter component instance
  const counterElement = CounterComponent.create();
  counterElement.id = 'main-counter';

  // Mount to DOM
  document.body.appendChild(counterElement);

  log.info('✅ Component created with actor behavior');
  log.info('📝 ComponentBehaviorConfig provides enhanced type safety');
  log.info('🔒 Full type safety with zero any types');
  log.info('🌐 Ready for Phase 3 transactional outbox integration');
  log.info('🔜 Next: Update createComponent to accept ComponentBehaviorConfig directly');
}

// Run the example if this file is executed directly
if (import.meta.url.endsWith(process.argv[1] || '')) {
  demonstrateUnifiedAPI().catch(console.error);
}
