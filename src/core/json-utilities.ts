/**
 * JSON Utilities for Actor-SPA Framework
 * Provides safe JSON serialization/deserialization with type safety and validation
 */

export interface SerializationOptions {
  pretty?: boolean;
  space?: number;
  replacer?: (key: string, value: unknown) => unknown;
  maxDepth?: number;
  allowedTypes?: string[];
}

export interface DeserializationOptions {
  validator?: (obj: unknown) => boolean;
  transformer?: (obj: unknown) => unknown;
  allowedProperties?: string[];
  maxStringLength?: number;
}

export class SerializationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SerializationError';
  }
}

export class DeserializationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DeserializationError';
  }
}

/**
 * Safe JSON serialization with configurable options
 */
export function safeSerialize(value: unknown, options: SerializationOptions = {}): string {
  const {
    pretty = false,
    space = 2,
    replacer,
    maxDepth = 10,
    allowedTypes = ['string', 'number', 'boolean', 'object'],
  } = options;

  try {
    // Check for circular references and depth
    const seen = new WeakSet();

    const serializer = (key: string, val: unknown, currentDepth = 0): unknown => {
      // Check depth limit BEFORE processing
      if (currentDepth > maxDepth) {
        throw new SerializationError(`Maximum depth of ${maxDepth} exceeded`);
      }

      // Handle null
      if (val === null) return null;

      // Apply replacer FIRST (this allows filtering out unwanted types)
      const transformedVal = replacer ? replacer(key, val) : val;

      // If replacer returned undefined, let JSON.stringify handle it (removes the property)
      if (transformedVal === undefined) {
        return undefined;
      }

      // Now check allowed types on the transformed value
      const type = typeof transformedVal;
      if (!allowedTypes.includes(type)) {
        throw new SerializationError(`Type '${type}' is not allowed for serialization`);
      }

      // Handle primitives
      if (type !== 'object') {
        return transformedVal;
      }

      // Handle objects and arrays
      if (transformedVal && typeof transformedVal === 'object') {
        // Check for circular references
        if (seen.has(transformedVal)) {
          throw new SerializationError('Circular reference detected');
        }
        seen.add(transformedVal);

        // Handle special objects
        if (transformedVal instanceof Date) {
          return transformedVal.toISOString();
        }

        if (transformedVal instanceof Error) {
          return {
            name: transformedVal.name,
            message: transformedVal.message,
            stack: transformedVal.stack,
          };
        }

        // For regular objects and arrays, we need to recursively process with increased depth
        if (Array.isArray(transformedVal)) {
          return transformedVal.map((item, index) =>
            serializer(String(index), item, currentDepth + 1)
          );
        }
        const result: Record<string, unknown> = {};
        for (const [objKey, objValue] of Object.entries(
          transformedVal as Record<string, unknown>
        )) {
          const processedValue = serializer(objKey, objValue, currentDepth + 1);
          if (processedValue !== undefined) {
            result[objKey] = processedValue;
          }
        }
        return result;
      }

      return transformedVal;
    };

    return JSON.stringify(serializer('', value), undefined, pretty ? space : undefined);
  } catch (error) {
    if (error instanceof SerializationError) {
      throw error;
    }
    throw new SerializationError(
      `JSON serialization failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Safe JSON deserialization with validation
 */
export function safeDeserialize<T = unknown>(
  json: string,
  options: DeserializationOptions = {}
): T {
  const { validator, transformer, allowedProperties, maxStringLength = 10000 } = options;

  try {
    if (typeof json !== 'string') {
      throw new DeserializationError('Input must be a string');
    }

    if (json.length > maxStringLength) {
      throw new DeserializationError(`JSON string too long (max ${maxStringLength} characters)`);
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (parseError) {
      throw new DeserializationError('Invalid JSON format', parseError as Error);
    }

    // Validate structure if validator provided
    if (validator && !validator(parsed)) {
      throw new DeserializationError('Validation failed');
    }

    // Filter allowed properties if specified
    if (allowedProperties && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const filtered: Record<string, unknown> = {};
      for (const prop of allowedProperties) {
        if (prop in parsed) {
          filtered[prop] = (parsed as Record<string, unknown>)[prop];
        }
      }
      parsed = filtered;
    }

    // Apply transformer if provided
    if (transformer) {
      parsed = transformer(parsed);
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof DeserializationError) {
      throw error;
    }
    throw new DeserializationError(
      `JSON deserialization failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Serialize event payloads for framework components
 */
export function serializeEventPayload(payload: Record<string, unknown>): string {
  return safeSerialize(payload, {
    allowedTypes: ['string', 'number', 'boolean', 'object'],
    maxDepth: 5,
    replacer: (_key, value) => {
      // Remove functions and undefined values
      if (typeof value === 'function' || value === undefined) {
        return undefined;
      }

      // Convert Dates to ISO strings
      if (value instanceof Date) {
        return value.toISOString();
      }

      return value;
    },
  });
}

/**
 * Deserialize event payloads with security validation
 */
export function deserializeEventPayload<T = Record<string, unknown>>(json: string): T {
  return safeDeserialize<T>(json, {
    maxStringLength: 5000,
    validator: (obj) => {
      // Validate that it's an object (not array or primitive)
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return false;
      }

      // Check for dangerous property names
      const dangerous = ['__proto__', 'constructor', 'prototype'];
      for (const prop of Object.keys(obj)) {
        if (dangerous.includes(prop)) {
          return false;
        }
      }

      return true;
    },
    transformer: (obj) => {
      // Ensure it's a clean object without prototype pollution
      const clean = Object.create(null);
      if (obj && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
          if (typeof key === 'string' && key.length < 100) {
            clean[key] = value;
          }
        }
      }
      return clean;
    },
  });
}

/**
 * Serialize form data for storage/transmission
 */
export function serializeFormData(formData: FormData): string {
  const obj: Record<string, unknown> = {};

  formData.forEach((value, key) => {
    // Handle multiple values for the same key
    if (key in obj) {
      const existing = obj[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        obj[key] = [existing, value];
      }
    } else {
      obj[key] = value;
    }
  });

  return serializeEventPayload(obj);
}

/**
 * Create type-safe serializers for specific data structures
 */
export function createTypedSerializer<T>(
  validator: (obj: unknown) => obj is T,
  name = 'TypedData'
) {
  return {
    serialize: (data: T): string => {
      if (!validator(data)) {
        throw new SerializationError(`Invalid ${name} structure`);
      }
      return safeSerialize(data);
    },

    deserialize: (json: string): T => {
      const parsed = safeDeserialize(json);
      if (!validator(parsed)) {
        throw new DeserializationError(`Invalid ${name} structure in JSON`);
      }
      return parsed;
    },
  };
}

/**
 * Common validation functions
 */
export const validators = {
  isObject: (obj: unknown): obj is Record<string, unknown> => {
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
  },

  isArray: (obj: unknown): obj is unknown[] => {
    return Array.isArray(obj);
  },

  hasRequiredFields:
    (fields: string[]) =>
    (obj: unknown): boolean => {
      if (!validators.isObject(obj)) return false;
      return fields.every((field) => field in obj);
    },

  isUser: (obj: unknown): obj is { id: string; name: string; email: string } => {
    return (
      validators.isObject(obj) &&
      typeof obj.id === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.email === 'string' &&
      obj.email.includes('@')
    );
  },

  isEventPayload: (obj: unknown): obj is Record<string, unknown> => {
    return validators.isObject(obj) && typeof obj.type === 'string' && obj.type.length > 0;
  },
};

/**
 * Pre-configured serializers for common framework use cases
 */
export const frameworkSerializers = {
  // For component state persistence
  componentState: createTypedSerializer(validators.isObject, 'ComponentState'),

  // For user data
  user: createTypedSerializer(validators.isUser, 'User'),

  // For event payloads
  eventPayload: createTypedSerializer(validators.isEventPayload, 'EventPayload'),

  // For form data
  formData: {
    serialize: serializeFormData,
    deserialize: (json: string) => deserializeEventPayload(json),
  },
};

/**
 * Storage helpers that integrate with JSON utilities
 */
export const storageHelpers = {
  setItem: (key: string, value: unknown): boolean => {
    try {
      const serialized = safeSerialize(value);
      localStorage.setItem(key, serialized);
      return true;
    } catch (_error) {
      return false;
    }
  },

  getItem: <T = unknown>(key: string, fallback?: T): T | null => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return fallback ?? null;
      return safeDeserialize<T>(item);
    } catch (_error) {
      return fallback ?? null;
    }
  },

  setSessionItem: (key: string, value: unknown): boolean => {
    try {
      const serialized = safeSerialize(value);
      sessionStorage.setItem(key, serialized);
      return true;
    } catch (_error) {
      return false;
    }
  },

  getSessionItem: <T = unknown>(key: string, fallback?: T): T | null => {
    try {
      const item = sessionStorage.getItem(key);
      if (item === null) return fallback ?? null;
      return safeDeserialize<T>(item);
    } catch (_error) {
      return fallback ?? null;
    }
  },
};

export default {
  safeSerialize,
  safeDeserialize,
  serializeEventPayload,
  deserializeEventPayload,
  serializeFormData,
  createTypedSerializer,
  validators,
  frameworkSerializers,
  storageHelpers,
  SerializationError,
  DeserializationError,
};
