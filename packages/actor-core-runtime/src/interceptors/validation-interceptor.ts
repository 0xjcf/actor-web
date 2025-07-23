/**
 * @module actor-core/runtime/interceptors/validation-interceptor
 * @description Message validation interceptor with fast-path optimization
 * @author Agent A - Actor-Core Framework
 * @since 2025-07-18
 */

import type { ActorAddress, ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';
import type { BeforeReceiveParams, MessageInterceptor } from '../messaging/interceptors.js';

const log = Logger.namespace('VALIDATION_INTERCEPTOR');

/**
 * Message validator interface
 */
export interface MessageValidator {
  /**
   * Validate a message
   * @returns true if valid, false to filter out, throws to indicate error
   */
  validate(message: ActorMessage): boolean | Promise<boolean>;

  /**
   * Optional error message generator
   */
  getErrorMessage?(message: ActorMessage): string;
}

/**
 * Schema-based validator using a validation function
 */
export interface SchemaValidator extends MessageValidator {
  schema: unknown;
  validate(message: ActorMessage): boolean | Promise<boolean>;
}

/**
 * Configuration options for validation interceptor
 */
export interface ValidationOptions {
  /** Default action when validation fails: 'filter' or 'error' */
  onFailure?: 'filter' | 'error';
  /** Log validation failures */
  logFailures?: boolean;
  /** Include message details in logs */
  includeMessageInLogs?: boolean;
}

/**
 * Validation result with details
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * High-performance validation interceptor with fast-path optimization
 *
 * Features:
 * - Fast-path for messages without validators
 * - Support for async validators
 * - Configurable failure handling
 * - Type-specific validation registration
 */
export class ValidationInterceptor implements MessageInterceptor {
  private validators = new Map<string, MessageValidator>();
  private globalValidator?: MessageValidator;
  private validationCache = new WeakMap<ActorMessage, boolean>();

  constructor(private options: ValidationOptions = {}) {}

  /**
   * Register a validator for a specific message type
   */
  registerValidator(messageType: string, validator: MessageValidator): void {
    this.validators.set(messageType, validator);
    log.debug('Registered validator for message type', { messageType });
  }

  /**
   * Register a global validator for all messages
   */
  registerGlobalValidator(validator: MessageValidator): void {
    this.globalValidator = validator;
    log.debug('Registered global validator');
  }

  /**
   * Unregister a validator
   */
  unregisterValidator(messageType: string): boolean {
    return this.validators.delete(messageType);
  }

  /**
   * Clear all validators
   */
  clearValidators(): void {
    this.validators.clear();
    this.globalValidator = undefined;
  }

  async beforeReceive({ message, sender }: BeforeReceiveParams): Promise<ActorMessage | null> {
    // Check cache first
    const cached = this.validationCache.get(message);
    if (cached !== undefined) {
      return cached ? message : null;
    }

    // Fast path - no validators
    const typeValidator = this.validators.get(message.type);
    if (!typeValidator && !this.globalValidator) {
      return message;
    }

    try {
      // Run type-specific validator
      if (typeValidator) {
        const result = await this.runValidator(typeValidator, message, 'type-specific');
        if (!result) {
          this.validationCache.set(message, false);
          return this.handleValidationFailure(message, sender, 'Type validation failed');
        }
      }

      // Run global validator
      if (this.globalValidator) {
        const result = await this.runValidator(this.globalValidator, message, 'global');
        if (!result) {
          this.validationCache.set(message, false);
          return this.handleValidationFailure(message, sender, 'Global validation failed');
        }
      }

      // Validation passed
      this.validationCache.set(message, true);
      return message;
    } catch (error) {
      // Validation error
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.options.logFailures) {
        log.error('Validation error', {
          messageType: message.type,
          error: errorMessage,
          message: this.options.includeMessageInLogs ? message : undefined,
        });
      }

      // Treat errors as validation failures
      return this.handleValidationFailure(message, sender, errorMessage);
    }
  }

  /**
   * Run a validator and handle async/sync results
   */
  private async runValidator(
    validator: MessageValidator,
    message: ActorMessage,
    validatorType: string
  ): Promise<boolean> {
    try {
      const result = validator.validate(message);
      return result instanceof Promise ? await result : result;
    } catch (error) {
      log.debug('Validator threw error', {
        validatorType,
        messageType: message.type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Handle validation failure based on configuration
   */
  private handleValidationFailure(
    message: ActorMessage,
    sender: ActorAddress | null,
    reason: string
  ): ActorMessage | null {
    if (this.options.logFailures) {
      log.warn('Message validation failed', {
        messageType: message.type,
        sender: sender?.path,
        reason,
        message: this.options.includeMessageInLogs ? message : undefined,
      });
    }

    if (this.options.onFailure === 'error') {
      throw new Error(`Validation failed: ${reason}`);
    }

    // Default: filter out the message
    return null;
  }

  /**
   * Get number of registered validators
   */
  get validatorCount(): number {
    return this.validators.size + (this.globalValidator ? 1 : 0);
  }

  /**
   * Check if a message type has a validator
   */
  hasValidator(messageType: string): boolean {
    return this.validators.has(messageType) || this.globalValidator !== undefined;
  }
}

/**
 * Create a simple validator from a predicate function
 */
export function createValidator(
  predicate: (message: ActorMessage) => boolean | Promise<boolean>,
  errorMessage?: string
): MessageValidator {
  return {
    validate: predicate,
    getErrorMessage: errorMessage ? () => errorMessage : undefined,
  };
}

/**
 * Create a validator that checks message payload properties
 */
export function createPayloadValidator(
  validator: (payload: unknown) => boolean | Promise<boolean>,
  errorMessage?: string
): MessageValidator {
  return createValidator((message) => validator(message.payload), errorMessage);
}

/**
 * Create a validator that checks required fields
 */
export function createRequiredFieldsValidator(
  fields: string[],
  checkPayload = true
): MessageValidator {
  return createValidator(
    (message) => {
      const target = checkPayload ? message.payload : message;

      if (typeof target !== 'object' || target === null) {
        return false;
      }

      const obj = target as Record<string, unknown>;
      return fields.every((field) => field in obj && obj[field] !== undefined);
    },
    `Required fields missing: ${fields.join(', ')}`
  );
}

/**
 * Create a composite validator that runs multiple validators
 */
export function createCompositeValidator(
  validators: MessageValidator[],
  mode: 'all' | 'any' = 'all'
): MessageValidator {
  return {
    async validate(message: ActorMessage): Promise<boolean> {
      const results = await Promise.all(validators.map((v) => v.validate(message)));

      return mode === 'all' ? results.every((r) => r === true) : results.some((r) => r === true);
    },
    getErrorMessage(message: ActorMessage): string {
      const errors = validators.map((v) => v.getErrorMessage?.(message)).filter(Boolean);
      return errors.join('; ');
    },
  };
}

/**
 * Create a pre-configured validation interceptor
 */
export function createValidationInterceptor(options?: ValidationOptions): ValidationInterceptor {
  return new ValidationInterceptor(options);
}
