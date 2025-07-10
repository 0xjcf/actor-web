/**
 * Form Validation Utilities - Reactive form validation with XState
 *
 * Provides reactive form validation patterns that integrate with ReactiveEventBus,
 * ARIA automation, and provide real-time validation with accessibility support.
 *
 * Part of Phase 0.7 Reactive Infrastructure
 */

import type { AnyEventObject } from 'xstate';
import { fromCallback, setup } from 'xstate';

// ===== TYPE DEFINITIONS =====

export interface ValidationRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable error message */
  message: string;
  /** Validation function that returns true if valid */
  validate: (value: string, form?: HTMLFormElement) => boolean | Promise<boolean>;
  /** Whether this rule should trigger on blur or only on submit */
  triggerOn?: 'blur' | 'submit' | 'change';
  /** Custom data associated with this rule */
  data?: unknown;
}

export interface FieldValidationConfig {
  /** CSS selector or element reference */
  field: string | HTMLElement;
  /** Validation rules for this field */
  rules: ValidationRule[];
  /** Whether to show validation on first interaction */
  validateOnBlur?: boolean;
  /** Whether to show validation as user types */
  validateOnChange?: boolean;
  /** Custom error container selector */
  errorContainer?: string;
  /** Custom aria-describedby ID */
  ariaDescribedBy?: string;
}

export interface FormValidationConfig {
  /** Form selector or element reference */
  form: string | HTMLFormElement;
  /** Field validation configurations */
  fields: FieldValidationConfig[];
  /** Global form validation rules */
  globalRules?: ValidationRule[];
  /** Whether to prevent submission on validation errors */
  preventSubmission?: boolean;
  /** Custom submit handler */
  onSubmit?: (formData: FormData, isValid: boolean) => void | Promise<void>;
}

export interface ValidationResult {
  /** Whether the field/form is valid */
  isValid: boolean;
  /** Array of error messages */
  errors: string[];
  /** Field that was validated */
  field?: HTMLElement;
  /** The rule that failed (if any) */
  failedRule?: ValidationRule;
}

export interface FormValidationContext {
  /** Current validation results for each field */
  fieldResults: Map<string, ValidationResult>;
  /** Overall form validity */
  isFormValid: boolean;
  /** Current form data */
  formData: FormData | null;
  /** Fields currently being validated */
  validatingFields: Set<string>;
}

// ===== BUILT-IN VALIDATION RULES =====

export const ValidationRules = {
  required: (customMessage?: string): ValidationRule => ({
    id: 'required',
    message: customMessage || 'This field is required',
    validate: (value) => value.trim().length > 0,
    triggerOn: 'blur',
  }),

  email: (customMessage?: string): ValidationRule => ({
    id: 'email',
    message: customMessage || 'Please enter a valid email address',
    validate: (value) => {
      if (!value) return true; // Let required rule handle empty values
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value);
    },
    triggerOn: 'blur',
  }),

  minLength: (min: number, customMessage?: string): ValidationRule => ({
    id: 'minLength',
    message: customMessage || `Must be at least ${min} characters long`,
    validate: (value) => value.length >= min,
    triggerOn: 'change',
  }),

  maxLength: (max: number, customMessage?: string): ValidationRule => ({
    id: 'maxLength',
    message: customMessage || `Must be no more than ${max} characters long`,
    validate: (value) => value.length <= max,
    triggerOn: 'change',
  }),

  pattern: (regex: RegExp, customMessage?: string): ValidationRule => ({
    id: 'pattern',
    message: customMessage || 'Please enter a valid value',
    validate: (value) => {
      if (!value) return true; // Let required rule handle empty values
      return regex.test(value);
    },
    triggerOn: 'blur',
  }),

  url: (customMessage?: string): ValidationRule => ({
    id: 'url',
    message: customMessage || 'Please enter a valid URL',
    validate: (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    triggerOn: 'blur',
  }),

  number: (customMessage?: string): ValidationRule => ({
    id: 'number',
    message: customMessage || 'Please enter a valid number',
    validate: (value) => {
      if (!value) return true;
      return !Number.isNaN(Number(value)) && Number.isFinite(Number(value));
    },
    triggerOn: 'change',
  }),

  range: (min: number, max: number, customMessage?: string): ValidationRule => ({
    id: 'range',
    message: customMessage || `Value must be between ${min} and ${max}`,
    validate: (value) => {
      if (!value) return true;
      const num = Number(value);
      return !Number.isNaN(num) && num >= min && num <= max;
    },
    triggerOn: 'change',
  }),

  confirm: (originalFieldSelector: string, customMessage?: string): ValidationRule => ({
    id: 'confirm',
    message: customMessage || 'Values do not match',
    validate: (value, form) => {
      if (!form) return true;
      const originalField = form.querySelector(originalFieldSelector) as HTMLInputElement;
      return originalField ? originalField.value === value : true;
    },
    triggerOn: 'blur',
  }),

  async: (
    asyncValidator: (value: string) => Promise<boolean>,
    customMessage?: string
  ): ValidationRule => ({
    id: 'async',
    message: customMessage || 'Please enter a valid value',
    validate: asyncValidator,
    triggerOn: 'blur',
  }),
};

// ===== FORM VALIDATION SERVICE =====

/**
 * Create a form validation service for state machines
 * Handles real-time validation with ARIA announcements
 *
 * @example
 * ```typescript
 * const validationService = createFormValidationService();
 *
 * const machine = setup({
 *   actors: { validation: validationService }
 * }).createMachine({
 *   states: {
 *     validating: {
 *       invoke: {
 *         src: 'validation',
 *         input: {
 *           config: {
 *             form: '#myForm',
 *             fields: [
 *               {
 *                 field: '#email',
 *                 rules: [ValidationRules.required(), ValidationRules.email()]
 *               }
 *             ]
 *           }
 *         }
 *       },
 *       on: {
 *         FIELD_VALIDATED: { actions: 'updateFieldState' },
 *         FORM_VALIDATED: { actions: 'updateFormState' }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createFormValidationService = () => {
  return fromCallback<AnyEventObject, { config: FormValidationConfig }>(
    ({ sendBack, input, receive }) => {
      const { config } = input;

      // Get form element
      const formElement =
        typeof config.form === 'string'
          ? (document.querySelector(config.form) as HTMLFormElement)
          : config.form;

      if (!formElement) {
        sendBack({ type: 'VALIDATION_ERROR', error: 'Form element not found' });
        return;
      }

      // Initialize field tracking
      const fieldElements = new Map<string, HTMLElement>();
      const fieldConfigs = new Map<string, FieldValidationConfig>();

      // Setup field elements and configurations
      config.fields.forEach((fieldConfig, index) => {
        const fieldElement =
          typeof fieldConfig.field === 'string'
            ? (formElement.querySelector(fieldConfig.field) as HTMLElement)
            : fieldConfig.field;

        if (fieldElement) {
          const fieldId = fieldElement.id || `field-${index}`;
          fieldElements.set(fieldId, fieldElement);
          fieldConfigs.set(fieldId, fieldConfig);

          // Setup error container
          setupErrorContainer(fieldElement, fieldConfig);

          // Setup event listeners
          setupFieldValidation(fieldElement, fieldConfig, fieldId, sendBack);
        }
      });

      // Setup form submission handling
      const handleSubmit = async (e: Event) => {
        e.preventDefault();

        const formData = new FormData(formElement);
        const allResults = await validateAllFields();
        const isFormValid = allResults.every((result) => result.isValid);

        // Validate global rules
        if (config.globalRules) {
          for (const rule of config.globalRules) {
            const isValid = await rule.validate('', formElement);
            if (!isValid) {
              allResults.push({
                isValid: false,
                errors: [rule.message],
                failedRule: rule,
              });
            }
          }
        }

        sendBack({
          type: 'FORM_VALIDATED',
          isValid: isFormValid,
          results: allResults,
          formData,
        });

        // Call custom submit handler
        if (config.onSubmit) {
          await config.onSubmit(formData, isFormValid);
        }

        // Prevent submission if invalid and preventSubmission is true
        if (!isFormValid && config.preventSubmission !== false) {
          return false;
        }
      };

      formElement.addEventListener('submit', handleSubmit);

      // Validate all fields function
      const validateAllFields = async (): Promise<ValidationResult[]> => {
        const results: ValidationResult[] = [];

        for (const [fieldId, fieldElement] of fieldElements) {
          const fieldConfig = fieldConfigs.get(fieldId);
          if (!fieldConfig) {
            console.warn(`Field config not found for field ID: ${fieldId}`);
            continue;
          }
          const result = await validateField(fieldElement, fieldConfig);
          results.push(result);

          sendBack({
            type: 'FIELD_VALIDATED',
            fieldId,
            result,
            element: fieldElement,
          });
        }

        return results;
      };

      // Handle external validation requests
      receive((event) => {
        if (event.type === 'VALIDATE_FIELD') {
          const { fieldId } = event as { type: 'VALIDATE_FIELD'; fieldId: string };
          const fieldElement = fieldElements.get(fieldId);
          const fieldConfig = fieldConfigs.get(fieldId);

          if (fieldElement && fieldConfig) {
            validateField(fieldElement, fieldConfig).then((result) => {
              sendBack({
                type: 'FIELD_VALIDATED',
                fieldId,
                result,
                element: fieldElement,
              });
            });
          }
        } else if (event.type === 'VALIDATE_FORM') {
          validateAllFields();
        } else if (event.type === 'RESET_VALIDATION') {
          resetAllValidation();
        }
      });

      // Reset all validation function
      const resetAllValidation = () => {
        fieldElements.forEach((fieldElement, fieldId) => {
          clearFieldValidation(fieldElement);
          sendBack({
            type: 'FIELD_RESET',
            fieldId,
            element: fieldElement,
          });
        });
      };

      // Cleanup function
      return () => {
        formElement.removeEventListener('submit', handleSubmit);
        fieldElements.forEach((fieldElement) => {
          fieldElement.removeEventListener('blur', () => {});
          fieldElement.removeEventListener('input', () => {});
        });
      };
    }
  );
};

// ===== HELPER FUNCTIONS =====

/**
 * Setup error container for a field
 */
function setupErrorContainer(fieldElement: HTMLElement, config: FieldValidationConfig): void {
  const errorId = `${fieldElement.id || 'field'}-error`;

  // Create error container if it doesn't exist
  if (!document.getElementById(errorId)) {
    const errorContainer = document.createElement('div');
    errorContainer.id = errorId;
    errorContainer.className = 'field-error';
    errorContainer.setAttribute('role', 'alert');
    errorContainer.setAttribute('aria-live', 'polite');
    errorContainer.style.display = 'none';

    // Insert error container after the field
    if (config.errorContainer) {
      const customContainer = document.querySelector(config.errorContainer);
      if (customContainer) {
        customContainer.appendChild(errorContainer);
      }
    } else {
      fieldElement.parentNode?.insertBefore(errorContainer, fieldElement.nextSibling);
    }
  }

  // Set aria-describedby
  const ariaDescribedBy = config.ariaDescribedBy || errorId;
  fieldElement.setAttribute('aria-describedby', ariaDescribedBy);
}

/**
 * Setup field validation event listeners
 */
function setupFieldValidation(
  fieldElement: HTMLElement,
  config: FieldValidationConfig,
  fieldId: string,
  sendBack: (event: AnyEventObject) => void
): void {
  const validateOnEvent = async (triggerType: 'blur' | 'change') => {
    const result = await validateField(fieldElement, config, triggerType);

    sendBack({
      type: 'FIELD_VALIDATED',
      fieldId,
      result,
      element: fieldElement,
      triggerType,
    });

    updateFieldUI(fieldElement, result);
  };

  // Blur validation
  if (config.validateOnBlur !== false) {
    fieldElement.addEventListener('blur', () => validateOnEvent('blur'));
  }

  // Change validation
  if (config.validateOnChange) {
    fieldElement.addEventListener('input', () => validateOnEvent('change'));
  }
}

/**
 * Validate a single field
 */
async function validateField(
  fieldElement: HTMLElement,
  config: FieldValidationConfig,
  triggerType?: 'blur' | 'change' | 'submit'
): Promise<ValidationResult> {
  const value = (fieldElement as HTMLInputElement).value;
  const form = fieldElement.closest('form') as HTMLFormElement;
  const errors: string[] = [];
  let failedRule: ValidationRule | undefined;

  for (const rule of config.rules) {
    // Skip rules that don't match the trigger type
    if (
      triggerType &&
      rule.triggerOn &&
      rule.triggerOn !== triggerType &&
      triggerType !== 'submit'
    ) {
      continue;
    }

    try {
      const isValid = await rule.validate(value, form);
      if (!isValid) {
        errors.push(rule.message);
        failedRule = rule;
        break; // Stop at first failure
      }
    } catch (_error) {
      errors.push('Validation error occurred');
      break;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    field: fieldElement,
    failedRule,
  };
}

/**
 * Update field UI based on validation result
 */
function updateFieldUI(fieldElement: HTMLElement, result: ValidationResult): void {
  const errorId = `${fieldElement.id || 'field'}-error`;
  const errorContainer = document.getElementById(errorId);

  if (result.isValid) {
    // Clear error state
    fieldElement.removeAttribute('aria-invalid');
    fieldElement.setAttribute('data-state', 'valid');

    if (errorContainer) {
      errorContainer.textContent = '';
      errorContainer.style.display = 'none';
    }
  } else {
    // Set error state
    fieldElement.setAttribute('aria-invalid', 'true');
    fieldElement.setAttribute('data-state', 'error');

    if (errorContainer && result.errors.length > 0) {
      errorContainer.textContent = result.errors[0];
      errorContainer.style.display = 'block';
    }
  }
}

/**
 * Clear field validation
 */
function clearFieldValidation(fieldElement: HTMLElement): void {
  fieldElement.removeAttribute('aria-invalid');
  fieldElement.removeAttribute('data-state');

  const errorId = `${fieldElement.id || 'field'}-error`;
  const errorContainer = document.getElementById(errorId);

  if (errorContainer) {
    errorContainer.textContent = '';
    errorContainer.style.display = 'none';
  }
}

// ===== CONVENIENCE MACHINE CREATOR =====

/**
 * Create a complete form validation machine
 *
 * @example
 * ```typescript
 * const formMachine = createFormValidationMachine({
 *   form: '#contactForm',
 *   fields: [
 *     {
 *       field: '#email',
 *       rules: [ValidationRules.required(), ValidationRules.email()]
 *     },
 *     {
 *       field: '#message',
 *       rules: [ValidationRules.required(), ValidationRules.minLength(10)]
 *     }
 *   ]
 * });
 *
 * const actor = createActor(formMachine);
 * actor.start();
 * ```
 */
export const createFormValidationMachine = (config: FormValidationConfig) => {
  return setup({
    types: {
      context: {} as FormValidationContext,
    },
    actors: {
      validation: createFormValidationService(),
    },
  }).createMachine({
    id: 'form-validation',
    initial: 'idle',
    context: {
      fieldResults: new Map(),
      isFormValid: false,
      formData: null,
      validatingFields: new Set(),
    },
    states: {
      idle: {
        on: {
          START_VALIDATION: 'validating',
        },
      },
      validating: {
        invoke: {
          src: 'validation',
          input: { config },
        },
        on: {
          FIELD_VALIDATED: {
            actions: ({ context, event }) => {
              context.fieldResults.set(event.fieldId, event.result);
              context.isFormValid = Array.from(context.fieldResults.values()).every(
                (result) => result.isValid
              );
            },
          },
          FORM_VALIDATED: {
            actions: ({ context, event }) => {
              context.isFormValid = event.isValid;
              context.formData = event.formData;
            },
          },
          VALIDATION_ERROR: 'error',
        },
      },
      error: {
        on: {
          RETRY: 'validating',
          RESET: 'idle',
        },
      },
    },
  });
};

// ===== EXPORT SERVICES =====

/**
 * Pre-configured validation services
 */
export const ValidationServices = {
  form: createFormValidationService(),
} as const;

// ===== DEFAULT EXPORT =====

export default ValidationServices;
