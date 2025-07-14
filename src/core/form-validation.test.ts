import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { Logger } from '@/core/dev-mode.js';
import { createTestEnvironment, type TestEnvironment } from '@/testing/actor-test-utils';
import {
  createFormValidationMachine,
  type FormValidationConfig,
  type ValidationRule,
  ValidationRules,
} from './form-validation.js';

const log = Logger.namespace('FORM_VALIDATION_TEST');

describe('Form Validation', () => {
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    log.debug('Test environment initialized');
    // setupGlobalMocks(); // [actor-web] TODO: Fix event bus integration
  });

  afterEach(() => {
    testEnv.cleanup();
    log.debug('Test environment cleaned up');
  });

  describe('Built-in Validation Rules', () => {
    describe('required rule', () => {
      it('validates that field is not empty', () => {
        const rule = ValidationRules.required();

        expect(rule.validate('')).toBe(false);
        expect(rule.validate('   ')).toBe(false);
        expect(rule.validate('valid input')).toBe(true);
      });

      it('uses custom error message when provided', () => {
        const customMessage = 'This field cannot be empty';
        const rule = ValidationRules.required(customMessage);

        expect(rule.message).toBe(customMessage);
      });

      it('triggers on blur by default', () => {
        const rule = ValidationRules.required();

        expect(rule.triggerOn).toBe('blur');
      });
    });

    describe('email rule', () => {
      it('validates email format correctly', () => {
        const rule = ValidationRules.email();

        expect(rule.validate('valid@email.com')).toBe(true);
        expect(rule.validate('user.name+tag@domain.co.uk')).toBe(true);
        expect(rule.validate('invalid-email')).toBe(false);
        expect(rule.validate('no@domain')).toBe(false);
        expect(rule.validate('@domain.com')).toBe(false);
      });

      it('allows empty values to let required rule handle them', () => {
        const rule = ValidationRules.email();

        expect(rule.validate('')).toBe(true);
      });
    });

    describe('minLength rule', () => {
      it('validates minimum length requirement', () => {
        const rule = ValidationRules.minLength(5);

        expect(rule.validate('short')).toBe(true);
        expect(rule.validate('long enough')).toBe(true);
        expect(rule.validate('hi')).toBe(false);
        expect(rule.validate('')).toBe(false);
      });

      it('includes length in error message', () => {
        const rule = ValidationRules.minLength(10);

        expect(rule.message).toContain('10');
      });
    });

    describe('maxLength rule', () => {
      it('validates maximum length requirement', () => {
        const rule = ValidationRules.maxLength(10);

        expect(rule.validate('short')).toBe(true);
        expect(rule.validate('exactly10!')).toBe(true);
        expect(rule.validate('this is too long')).toBe(false);
      });
    });

    describe('pattern rule', () => {
      it('validates against custom regex pattern', () => {
        const phonePattern = /^\(\d{3}\) \d{3}-\d{4}$/;
        const rule = ValidationRules.pattern(phonePattern);

        expect(rule.validate('(123) 456-7890')).toBe(true);
        expect(rule.validate('123-456-7890')).toBe(false);
        expect(rule.validate('invalid')).toBe(false);
      });

      it('allows empty values to let required rule handle them', () => {
        const rule = ValidationRules.pattern(/^\d+$/);

        expect(rule.validate('')).toBe(true);
      });
    });

    describe('url rule', () => {
      it('validates URL format correctly', () => {
        const rule = ValidationRules.url();

        expect(rule.validate('https://example.com')).toBe(true);
        expect(rule.validate('http://localhost:3000')).toBe(true);
        expect(rule.validate('ftp://files.example.com')).toBe(true);
        expect(rule.validate('not-a-url')).toBe(false);
        expect(rule.validate('http://')).toBe(false);
      });
    });

    describe('number rule', () => {
      it('validates numeric values correctly', () => {
        const rule = ValidationRules.number();

        expect(rule.validate('42')).toBe(true);
        expect(rule.validate('-3.14')).toBe(true);
        expect(rule.validate('0')).toBe(true);
        expect(rule.validate('not-a-number')).toBe(false);
        expect(rule.validate('Infinity')).toBe(false);
      });
    });

    describe('range rule', () => {
      it('validates numeric range correctly', () => {
        const rule = ValidationRules.range(1, 10);

        expect(rule.validate('5')).toBe(true);
        expect(rule.validate('1')).toBe(true);
        expect(rule.validate('10')).toBe(true);
        expect(rule.validate('0')).toBe(false);
        expect(rule.validate('11')).toBe(false);
        expect(rule.validate('not-a-number')).toBe(false);
      });
    });

    describe('confirm rule', () => {
      it('validates that values match between fields', () => {
        // Create a form with two fields
        const form = document.createElement('form');
        const originalField = document.createElement('input');
        originalField.id = 'password';
        originalField.value = 'secret123';
        form.appendChild(originalField);

        const rule = ValidationRules.confirm('#password');

        expect(rule.validate('secret123', form)).toBe(true);
        expect(rule.validate('different', form)).toBe(false);
      });
    });

    describe('async rule', () => {
      it('validates using async function', async () => {
        const asyncValidator = vi.fn().mockResolvedValue(true);
        const rule = ValidationRules.async(asyncValidator);

        const result = await rule.validate('test value');

        expect(result).toBe(true);
        expect(asyncValidator).toHaveBeenCalledWith('test value');
      });

      it('handles async validation failure', async () => {
        const asyncValidator = vi.fn().mockResolvedValue(false);
        const rule = ValidationRules.async(asyncValidator);

        const result = await rule.validate('invalid value');

        expect(result).toBe(false);
      });
    });
  });

  describe('Form Validation Machine', () => {
    let form: HTMLFormElement;
    let emailField: HTMLInputElement;
    let passwordField: HTMLInputElement;
    let config: FormValidationConfig;

    beforeEach(() => {
      // Create test form
      form = document.createElement('form');
      form.id = 'test-form';

      emailField = document.createElement('input');
      emailField.type = 'email';
      emailField.id = 'email';
      emailField.name = 'email';

      passwordField = document.createElement('input');
      passwordField.type = 'password';
      passwordField.id = 'password';
      passwordField.name = 'password';

      form.appendChild(emailField);
      form.appendChild(passwordField);
      testEnv.container.appendChild(form);

      config = {
        form: form,
        fields: [
          {
            field: emailField,
            rules: [ValidationRules.required(), ValidationRules.email()],
            validateOnBlur: true,
            validateOnChange: false,
          },
          {
            field: passwordField,
            rules: [ValidationRules.required(), ValidationRules.minLength(8)],
            validateOnBlur: true,
            validateOnChange: true,
          },
        ],
        preventSubmission: true,
      };
    });

    describe('Machine Creation', () => {
      it('creates a form validation machine successfully', () => {
        const machine = createFormValidationMachine(config);

        expect(machine).toBeDefined();
        expect(machine.id).toBe('form-validation');
      });

      it('creates an actor that can be started', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);

        expect(actor).toBeDefined();
        // In XState v5, actors are active immediately when created
        expect(actor.getSnapshot().status).toBe('active');

        actor.start();
        expect(actor.getSnapshot().status).toBe('active');

        actor.stop();
        expect(actor.getSnapshot().status).toBe('stopped');
      });

      it('starts in idle state', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);
        actor.start();

        expect(actor.getSnapshot().value).toBe('idle');

        actor.stop();
      });
    });

    describe('Machine State Transitions', () => {
      it('transitions to validating state when START_VALIDATION is sent', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);
        actor.start();

        expect(actor.getSnapshot().value).toBe('idle');

        actor.send({ type: 'START_VALIDATION' });

        expect(actor.getSnapshot().value).toBe('validating');

        actor.stop();
      });

      it('handles validation errors by transitioning to error state', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'START_VALIDATION' });
        actor.send({ type: 'VALIDATION_ERROR', error: 'Test error' });

        expect(actor.getSnapshot().value).toBe('error');

        actor.stop();
      });

      it('can retry from error state', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'START_VALIDATION' });
        actor.send({ type: 'VALIDATION_ERROR', error: 'Test error' });
        actor.send({ type: 'RETRY' });

        expect(actor.getSnapshot().value).toBe('validating');

        actor.stop();
      });

      it('can reset from error state', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'START_VALIDATION' });
        actor.send({ type: 'VALIDATION_ERROR', error: 'Test error' });
        actor.send({ type: 'RESET' });

        expect(actor.getSnapshot().value).toBe('idle');

        actor.stop();
      });
    });

    describe('Context Management', () => {
      it('initializes with default context', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);
        actor.start();

        const context = actor.getSnapshot().context;

        expect(context.fieldResults).toBeInstanceOf(Map);
        expect(context.isFormValid).toBe(false);
        expect(context.formData).toBeNull();
        expect(context.validatingFields).toBeInstanceOf(Set);

        actor.stop();
      });

      it('updates context when field validation events are received', () => {
        const machine = createFormValidationMachine(config);
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'START_VALIDATION' });

        // Simulate field validation result
        actor.send({
          type: 'FIELD_VALIDATED',
          fieldId: 'email',
          result: {
            isValid: true,
            errors: [],
            field: emailField,
          },
        });

        const context = actor.getSnapshot().context;
        expect(context.fieldResults.has('email')).toBe(true);

        actor.stop();
      });
    });

    describe('Error Handling', () => {
      it('handles validation errors gracefully', async () => {
        const errorRule: ValidationRule = {
          id: 'error-rule',
          message: 'Test error',
          validate: () => {
            throw new Error('Validation error');
          },
        };

        const errorConfig: FormValidationConfig = {
          form: form,
          fields: [
            {
              field: emailField,
              rules: [errorRule],
            },
          ],
        };

        const machine = createFormValidationMachine(errorConfig);
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'START_VALIDATION' });

        // Machine should handle validation errors
        expect(actor.getSnapshot().value).toBe('validating');

        actor.stop();
      });

      it('handles missing form element gracefully', () => {
        const invalidConfig: FormValidationConfig = {
          form: '#nonexistent-form',
          fields: [],
        };

        const machine = createFormValidationMachine(invalidConfig);
        const actor = createActor(machine);

        // Should not throw when creating machine with invalid config
        expect(() => actor.start()).not.toThrow();

        actor.stop();
      });
    });
  });

  describe('Performance Characteristics', () => {
    it('handles large forms efficiently', () => {
      const form = document.createElement('form');
      const fields: HTMLInputElement[] = [];

      // Create 50 fields
      for (let i = 0; i < 50; i++) {
        const field = document.createElement('input');
        field.id = `field-${i}`;
        field.name = `field-${i}`;
        form.appendChild(field);
        fields.push(field);
      }

      testEnv.container.appendChild(form);

      const config: FormValidationConfig = {
        form: form,
        fields: fields.map((field) => ({
          field: field,
          rules: [ValidationRules.required()],
        })),
      };

      const start = performance.now();

      const machine = createFormValidationMachine(config);
      const actor = createActor(machine);
      actor.start();

      const setupTime = performance.now() - start;

      // Should setup within reasonable time
      expect(setupTime).toBeLessThan(100);

      actor.stop();
    });

    it('creates validation rules efficiently', () => {
      const start = performance.now();

      // Create multiple rules
      const rules = [
        ValidationRules.required(),
        ValidationRules.email(),
        ValidationRules.minLength(8),
        ValidationRules.maxLength(100),
        ValidationRules.pattern(/^\d+$/),
        ValidationRules.url(),
        ValidationRules.number(),
        ValidationRules.range(1, 100),
      ];

      const setupTime = performance.now() - start;

      expect(rules).toHaveLength(8);
      expect(setupTime).toBeLessThan(10);
    });
  });
});
