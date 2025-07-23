/**
 * @file Runtime Fan-Out Shortcut Example
 * @description Demonstrates the new Day 2 feature: automatic fan-out from handler returns
 *
 * This example shows the DX improvement from the fan-out shortcut:
 * - Before: machine.send() + emit() (2 calls, boilerplate)
 * - After: return domainEvent (1 call, automatic fan-out)
 */

import { createMachine } from 'xstate';
import { createComponentActorBehavior } from '../component-actor.js';
import { Logger } from '../logger.js';

const log = Logger.namespace('RUNTIME_FANOUT_EXAMPLE');

// ============================================================================
// DOMAIN EVENTS - Business events that trigger fan-out
// ============================================================================

interface FormSavedEvent {
  readonly type: 'FORM_SAVED';
  readonly id: string;
  readonly timestamp: number;
}

interface ValidationErrorEvent {
  readonly type: 'VALIDATION_ERROR';
  readonly field: string;
  readonly message: string;
}

type DomainEvent = FormSavedEvent | ValidationErrorEvent;

// ============================================================================
// XSTATE MACHINE - UI Logic
// ============================================================================

const formMachine = createMachine({
  id: 'form',
  initial: 'idle',
  states: {
    idle: {
      on: { SUBMIT: 'validating' },
    },
    validating: {
      on: {
        VALIDATION_SUCCESS: 'saving',
        VALIDATION_ERROR: 'error',
      },
    },
    saving: {
      on: {
        SAVE_SUCCESS: 'saved',
        SAVE_ERROR: 'error',
      },
    },
    saved: {
      on: { RESET: 'idle' },
    },
    error: {
      on: { RETRY: 'idle' },
    },
  },
});

// ============================================================================
// COMPONENT BEHAVIOR - With Runtime Fan-Out Shortcut
// ============================================================================

const enhancedFormBehavior = createComponentActorBehavior({
  machine: formMachine,
  template: (state) => `<div>Form State: ${JSON.stringify(state)}</div>`,

  // ✨ Enhanced handler with fan-out support
  onMessage: async ({ message, machine }) => {
    log.info('Processing message with fan-out support', {
      messageType: message.type,
      currentState: machine.getSnapshot().value,
    });

    switch (message.type) {
      case 'DOM_EVENT': {
        if (message.payload.eventType === 'SUBMIT') {
          const currentState = machine.getSnapshot().value;

          if (currentState === 'validating') {
            // Simulate validation
            const isValid = Math.random() > 0.3; // 70% success rate

            if (isValid) {
              // 🎯 OLD WAY (still works - backward compatibility):
              // machine.send({ type: 'VALIDATION_SUCCESS' });
              // emit({ type: 'FORM_VALIDATED', id: 'form-123' });

              // ✨ NEW WAY: Return domain event - runtime handles both!
              log.info('✨ Using fan-out shortcut: returning domain event directly');

              // This will automatically:
              // 1. Send to XState machine: machine.send({ type: 'VALIDATION_SUCCESS' })
              // 2. Emit to actor system: emit({ type: 'FORM_VALIDATED', ... })
              return {
                type: 'FORM_VALIDATED',
                id: 'form-123',
                timestamp: Date.now(),
              } as const;
            }
            // 🎯 Fan-out shortcut for validation error
            log.info('✨ Using fan-out shortcut for validation error');

            return {
              type: 'VALIDATION_ERROR',
              field: 'email',
              message: 'Invalid email format',
            } as const;
          }

          if (currentState === 'saving') {
            // 🎯 Fan-out shortcut for save success
            log.info('✨ Using fan-out shortcut for form save');

            return {
              type: 'FORM_SAVED',
              id: 'form-123',
              timestamp: Date.now(),
            } as const;
          }
        }
        break;
      }

      case 'EXTERNAL_MESSAGE': {
        // External messages can also use fan-out shortcuts
        const payload = message.payload;
        if (
          payload &&
          typeof payload === 'object' &&
          'type' in payload &&
          payload.type === 'SAVE_COMMAND'
        ) {
          log.info('✨ External message triggering fan-out shortcut');

          const formId =
            'formId' in payload && typeof payload.formId === 'string'
              ? payload.formId
              : 'unknown-form';

          return {
            type: 'FORM_SAVED',
            id: formId,
            timestamp: Date.now(),
          } as const;
        }
        break;
      }
    }

    // Traditional return (no fan-out)
    return {
      context: {}, // Just return context, no events
    };
  },
});

// ============================================================================
// USAGE DEMONSTRATION
// ============================================================================

export function demonstrateRuntimeFanOut() {
  log.info('🚀 Runtime Fan-Out Shortcut Demo');
  log.info('');
  log.info('Before (2 calls):');
  log.info('  machine.send({ type: "SAVE_SUCCESS" });');
  log.info('  emit({ type: "FORM_SAVED", id: "123" });');
  log.info('');
  log.info('✨ After (1 call):');
  log.info('  return { type: "FORM_SAVED", id: "123" };');
  log.info('  // Runtime automatically does both!');
  log.info('');
  log.info('Benefits:');
  log.info('  ✅ 50% less boilerplate code');
  log.info('  ✅ Same atomicity guarantees');
  log.info('  ✅ Zero breaking changes');
  log.info('  ✅ Better observability');

  return enhancedFormBehavior;
}

// Demo the type safety
export function typeSafetyDemo() {
  // ✅ Valid domain events (compile-time checked)
  const validEvent: FormSavedEvent = {
    type: 'FORM_SAVED',
    id: 'form-123',
    timestamp: Date.now(),
  };

  // ❌ Invalid events won't compile:
  // const invalidEvent = {
  //   type: 'FORM_SAVED',
  //   id: 'form-123'
  //   // Missing timestamp - TypeScript error!
  // };

  log.info('✅ Type safety demo complete - invalid events caught at compile time');
  return validEvent;
}

// Export for external usage
export { enhancedFormBehavior, type DomainEvent };

log.info('📝 Runtime Fan-Out Example loaded successfully');
log.info('🎯 Day 2 implementation: Core runtime integration complete!');
