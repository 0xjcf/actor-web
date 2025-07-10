/**
 * Tests for JSON Utilities - Actor-SPA Framework
 * Focus: Safe serialization, deserialization, and data validation behaviors
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeserializationError,
  SerializationError,
  createTypedSerializer,
  deserializeEventPayload,
  frameworkSerializers,
  safeDeserialize,
  safeSerialize,
  serializeEventPayload,
  serializeFormData,
  storageHelpers,
  validators,
} from './json-utilities.js';

describe('JSON Utilities', () => {
  describe('Safe Serialization', () => {
    describe('Basic serialization behavior', () => {
      it('serializes simple data structures correctly', () => {
        const data = { name: 'test', count: 42, active: true };

        const result = safeSerialize(data);

        expect(result).toBe('{"name":"test","count":42,"active":true}');
      });

      it('handles null values safely', () => {
        const data = { value: null, other: 'test' };

        const result = safeSerialize(data);

        expect(result).toBe('{"value":null,"other":"test"}');
      });

      it('produces pretty-formatted output when requested', () => {
        const data = { a: 1, b: 2 };

        const result = safeSerialize(data, { pretty: true });

        expect(result).toContain('\n');
        expect(result).toContain('  '); // Should have indentation
      });
    });

    describe('Error handling', () => {
      it('throws SerializationError for circular references', () => {
        const obj: { name: string; circular?: unknown } = { name: 'test' };
        obj.circular = obj; // Create circular reference

        expect(() => safeSerialize(obj)).toThrow(SerializationError);
        expect(() => safeSerialize(obj)).toThrow('Circular reference detected');
      });

      it('throws SerializationError when depth limit exceeded', () => {
        const deepObj = { level1: { level2: { level3: { level4: { level5: 'deep' } } } } };

        expect(() => safeSerialize(deepObj, { maxDepth: 3 })).toThrow(SerializationError);
        expect(() => safeSerialize(deepObj, { maxDepth: 3 })).toThrow('Maximum depth');
      });

      it('throws SerializationError for disallowed types', () => {
        const data = { func: () => 'test' };

        expect(() => safeSerialize(data)).toThrow(SerializationError);
        expect(() => safeSerialize(data)).toThrow('not allowed for serialization');
      });
    });

    describe('Special object handling', () => {
      it('converts Date objects to ISO strings', () => {
        const date = new Date('2023-01-01T00:00:00.000Z');
        const data = { timestamp: date };

        const result = safeSerialize(data);

        expect(result).toContain('2023-01-01T00:00:00.000Z');
      });

      it('handles Error objects by extracting key properties', () => {
        const error = new Error('Test error');
        error.stack = 'Error: Test error\n  at test';
        const data = { error };

        const result = safeSerialize(data);
        const parsed = JSON.parse(result);

        expect(parsed.error.name).toBe('Error');
        expect(parsed.error.message).toBe('Test error');
        expect(parsed.error.stack).toContain('Error: Test error');
      });
    });

    describe('Custom replacer functionality', () => {
      it('applies custom replacer function to transform values', () => {
        const data = { password: 'secret123', username: 'user' };
        const replacer = (key: string, value: unknown) =>
          key === 'password' ? '[REDACTED]' : value;

        const result = safeSerialize(data, { replacer });

        expect(result).toContain('[REDACTED]');
        expect(result).not.toContain('secret123');
      });
    });
  });

  describe('Safe Deserialization', () => {
    describe('Basic deserialization behavior', () => {
      it('deserializes valid JSON correctly', () => {
        const json = '{"name":"test","count":42,"active":true}';

        const result = safeDeserialize(json);

        expect(result).toEqual({ name: 'test', count: 42, active: true });
      });

      it('preserves data types accurately', () => {
        const json = '{"str":"text","num":123,"bool":true,"null":null}';

        const result = safeDeserialize(json) as Record<string, unknown>;

        expect(typeof result.str).toBe('string');
        expect(typeof result.num).toBe('number');
        expect(typeof result.bool).toBe('boolean');
        expect(result.null).toBe(null);
      });
    });

    describe('Error handling', () => {
      it('throws DeserializationError for non-string input', () => {
        expect(() => safeDeserialize(123 as unknown as string)).toThrow(DeserializationError);
        expect(() => safeDeserialize(123 as unknown as string)).toThrow('Input must be a string');
      });

      it('throws DeserializationError for invalid JSON', () => {
        const invalidJson = '{"unclosed": true';

        expect(() => safeDeserialize(invalidJson)).toThrow(DeserializationError);
        expect(() => safeDeserialize(invalidJson)).toThrow('Invalid JSON format');
      });

      it('throws DeserializationError when string exceeds length limit', () => {
        const longString = 'a'.repeat(15000);

        expect(() => safeDeserialize(longString, { maxStringLength: 1000 })).toThrow(
          DeserializationError
        );
        expect(() => safeDeserialize(longString, { maxStringLength: 1000 })).toThrow('too long');
      });
    });

    describe('Validation functionality', () => {
      it('applies validator function to parsed data', () => {
        const json = '{"type":"user","name":"Alice"}';
        const validator = (obj: unknown): boolean =>
          Boolean(
            obj && typeof obj === 'object' && (obj as Record<string, unknown>).type === 'user'
          );

        const result = safeDeserialize(json, { validator });

        expect(result).toEqual({ type: 'user', name: 'Alice' });
      });

      it('throws DeserializationError when validation fails', () => {
        const json = '{"type":"admin","name":"Alice"}';
        const validator = (obj: unknown): boolean =>
          Boolean(
            obj && typeof obj === 'object' && (obj as Record<string, unknown>).type === 'user'
          );

        expect(() => safeDeserialize(json, { validator })).toThrow(DeserializationError);
        expect(() => safeDeserialize(json, { validator })).toThrow('Validation failed');
      });
    });

    describe('Property filtering', () => {
      it('filters to only allowed properties when specified', () => {
        const json = '{"name":"Alice","password":"secret","email":"alice@test.com"}';
        const allowedProperties = ['name', 'email'];

        const result = safeDeserialize(json, { allowedProperties });

        expect(result).toEqual({ name: 'Alice', email: 'alice@test.com' });
        expect(result).not.toHaveProperty('password');
      });
    });

    describe('Transformation functionality', () => {
      it('applies transformer function to modify parsed data', () => {
        const json = '{"name":"alice","age":25}';
        const transformer = (obj: unknown) => {
          const typedObj = obj as Record<string, unknown>;
          return {
            ...typedObj,
            name: (typedObj.name as string).toUpperCase(),
          };
        };

        const result = safeDeserialize(json, { transformer }) as Record<string, unknown>;

        expect(result.name).toBe('ALICE');
        expect(result.age).toBe(25);
      });
    });
  });

  describe('Event Payload Serialization', () => {
    it('serializes event payloads with appropriate constraints', () => {
      const payload = {
        type: 'user-click',
        data: { element: 'button', timestamp: new Date('2023-01-01') },
        meta: { source: 'ui' },
      };

      const result = serializeEventPayload(payload);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('user-click');
      expect(parsed.data.timestamp).toBe('2023-01-01T00:00:00.000Z');
    });

    it('removes functions and undefined values from payloads', () => {
      const payload = {
        type: 'event',
        callback: () => 'test',
        value: undefined,
        data: 'valid',
      };

      const result = serializeEventPayload(payload);
      const parsed = JSON.parse(result);

      expect(parsed).not.toHaveProperty('callback');
      expect(parsed).not.toHaveProperty('value');
      expect(parsed.data).toBe('valid');
    });
  });

  describe('Event Payload Deserialization', () => {
    it('deserializes valid event payloads safely', () => {
      const json = '{"type":"user-action","data":{"count":1}}';

      const result = deserializeEventPayload(json) as Record<string, unknown>;

      expect(result.type).toBe('user-action');
      expect((result.data as Record<string, unknown>).count).toBe(1);
    });

    it('prevents prototype pollution attacks', () => {
      const maliciousJson = '{"__proto__":{"admin":true},"type":"event"}';

      expect(() => deserializeEventPayload(maliciousJson)).toThrow(DeserializationError);
    });

    it('sanitizes dangerous property names', () => {
      const dangerousJson = '{"constructor":{"admin":true},"type":"event"}';

      expect(() => deserializeEventPayload(dangerousJson)).toThrow(DeserializationError);
    });
  });

  describe('Form Data Serialization', () => {
    it('converts FormData to JSON format correctly', () => {
      const formData = new FormData();
      formData.append('name', 'Alice');
      formData.append('email', 'alice@test.com');
      formData.append('age', '25');

      const result = serializeFormData(formData);
      const parsed = JSON.parse(result);

      expect(parsed.name).toBe('Alice');
      expect(parsed.email).toBe('alice@test.com');
      expect(parsed.age).toBe('25');
    });

    it('handles multiple values for the same field name', () => {
      const formData = new FormData();
      formData.append('skills', 'JavaScript');
      formData.append('skills', 'TypeScript');
      formData.append('skills', 'React');

      const result = serializeFormData(formData);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed.skills)).toBe(true);
      expect(parsed.skills).toEqual(['JavaScript', 'TypeScript', 'React']);
    });
  });

  describe('Typed Serializers', () => {
    describe('Custom typed serializer creation', () => {
      it('creates working serializer for custom types', () => {
        interface TestData {
          id: string;
          value: number;
        }

        const isTestData = (obj: unknown): obj is TestData =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as Record<string, unknown>).id === 'string' &&
          typeof (obj as Record<string, unknown>).value === 'number';

        const testSerializer = createTypedSerializer(isTestData, 'TestData');
        const data: TestData = { id: 'test-1', value: 42 };

        const serialized = testSerializer.serialize(data);
        const deserialized = testSerializer.deserialize(serialized);

        expect(deserialized).toEqual(data);
      });

      it('throws error when serializing invalid data structure', () => {
        const isTestData = (obj: unknown): obj is { id: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as Record<string, unknown>).id === 'string';

        const testSerializer = createTypedSerializer(isTestData, 'TestData');
        const invalidData = { name: 'test' }; // Missing 'id'

        expect(() => testSerializer.serialize(invalidData as unknown as { id: string })).toThrow(
          SerializationError
        );
      });

      it('throws error when deserializing invalid JSON structure', () => {
        const isTestData = (obj: unknown): obj is { id: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as Record<string, unknown>).id === 'string';

        const testSerializer = createTypedSerializer(isTestData, 'TestData');
        const invalidJson = '{"name":"test"}'; // Missing 'id'

        expect(() => testSerializer.deserialize(invalidJson)).toThrow(DeserializationError);
      });
    });
  });

  describe('Validators', () => {
    describe('Object validation', () => {
      it('correctly identifies objects', () => {
        expect(validators.isObject({})).toBe(true);
        expect(validators.isObject({ key: 'value' })).toBe(true);
        expect(validators.isObject([])).toBe(false);
        expect(validators.isObject(null)).toBe(false);
        expect(validators.isObject('string')).toBe(false);
      });

      it('correctly identifies arrays', () => {
        expect(validators.isArray([])).toBe(true);
        expect(validators.isArray([1, 2, 3])).toBe(true);
        expect(validators.isArray({})).toBe(false);
        expect(validators.isArray('string')).toBe(false);
      });
    });

    describe('Required fields validation', () => {
      it('validates objects have required fields', () => {
        const validator = validators.hasRequiredFields(['name', 'email']);

        expect(validator({ name: 'Alice', email: 'alice@test.com' })).toBe(true);
        expect(validator({ name: 'Alice' })).toBe(false);
        expect(validator({})).toBe(false);
      });
    });

    describe('User data validation', () => {
      it('validates complete user objects', () => {
        const validUser = { id: '123', name: 'Alice', email: 'alice@test.com' };
        const invalidUser = { id: '123', name: 'Alice', email: 'invalid-email' };

        expect(validators.isUser(validUser)).toBe(true);
        expect(validators.isUser(invalidUser)).toBe(false);
      });
    });

    describe('Event payload validation', () => {
      it('validates event payload structure', () => {
        const validPayload = { type: 'user-action', data: {} };
        const invalidPayload = { data: {} }; // Missing type

        expect(validators.isEventPayload(validPayload)).toBe(true);
        expect(validators.isEventPayload(invalidPayload)).toBe(false);
      });
    });
  });

  describe('Storage Helpers', () => {
    beforeEach(() => {
      // Mock localStorage and sessionStorage
      const mockStorage = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      };

      Object.defineProperty(window, 'localStorage', {
        value: mockStorage,
        writable: true,
      });

      Object.defineProperty(window, 'sessionStorage', {
        value: mockStorage,
        writable: true,
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe('localStorage helpers', () => {
      it('stores and retrieves data correctly', () => {
        const data = { name: 'test', value: 42 };

        // Mock successful storage
        localStorage.setItem = vi.fn();
        localStorage.getItem = vi.fn().mockReturnValue('{"name":"test","value":42}');

        const stored = storageHelpers.setItem('test-key', data);
        const retrieved = storageHelpers.getItem('test-key');

        expect(stored).toBe(true);
        expect(retrieved).toEqual(data);
      });

      it('returns null for non-existent keys', () => {
        localStorage.getItem = vi.fn().mockReturnValue(null);

        const result = storageHelpers.getItem('non-existent');

        expect(result).toBe(null);
      });

      it('returns fallback value when retrieval fails', () => {
        localStorage.getItem = vi.fn().mockReturnValue('invalid-json');
        const fallback = { default: true };

        const result = storageHelpers.getItem('test-key', fallback);

        expect(result).toEqual(fallback);
      });

      it('handles storage errors gracefully', () => {
        localStorage.setItem = vi.fn().mockImplementation(() => {
          throw new Error('Storage full');
        });

        const result = storageHelpers.setItem('test-key', { data: 'test' });

        expect(result).toBe(false);
      });
    });

    describe('sessionStorage helpers', () => {
      it('stores and retrieves session data correctly', () => {
        const data = { session: 'data' };

        sessionStorage.setItem = vi.fn();
        sessionStorage.getItem = vi.fn().mockReturnValue('{"session":"data"}');

        const stored = storageHelpers.setSessionItem('session-key', data);
        const retrieved = storageHelpers.getSessionItem('session-key');

        expect(stored).toBe(true);
        expect(retrieved).toEqual(data);
      });
    });
  });

  describe('Framework Serializers', () => {
    describe('Component state serializer', () => {
      it('serializes and deserializes component state', () => {
        const state = { count: 5, active: true, data: { items: [] } };

        const serialized = frameworkSerializers.componentState.serialize(state);
        const deserialized = frameworkSerializers.componentState.deserialize(serialized);

        expect(deserialized).toEqual(state);
      });
    });

    describe('User serializer', () => {
      it('serializes valid user data', () => {
        const user = { id: '123', name: 'Alice', email: 'alice@test.com' };

        const result = frameworkSerializers.user.serialize(user);

        expect(typeof result).toBe('string');
        expect(JSON.parse(result)).toEqual(user);
      });

      it('throws error for invalid user data', () => {
        const invalidUser = { id: '123', name: 'Alice' }; // Missing email

        expect(() =>
          frameworkSerializers.user.serialize(
            invalidUser as unknown as { id: string; name: string; email: string }
          )
        ).toThrow(SerializationError);
      });
    });

    describe('Event payload serializer', () => {
      it('handles valid event payloads', () => {
        const payload = { type: 'user-click', data: { button: 'submit' } };

        const serialized = frameworkSerializers.eventPayload.serialize(payload);
        const deserialized = frameworkSerializers.eventPayload.deserialize(serialized);

        expect(deserialized).toEqual(payload);
      });
    });
  });

  describe('Integration scenarios', () => {
    it('handles complete data flow from component to storage', () => {
      // Simulate component state that needs to be persisted
      const componentState = {
        user: { id: '123', name: 'Alice', email: 'alice@test.com' },
        preferences: { theme: 'dark', notifications: true },
        timestamp: new Date('2023-01-01'),
      };

      // Serialize for storage
      const serialized = safeSerialize(componentState);

      // Deserialize from storage
      const deserialized = safeDeserialize(serialized) as Record<string, unknown>;

      expect(deserialized.user as Record<string, unknown>).toEqual(componentState.user);
      expect(deserialized.preferences as Record<string, unknown>).toEqual(
        componentState.preferences
      );
      expect(deserialized.timestamp).toBe('2023-01-01T00:00:00.000Z');
    });

    it('handles form submission data processing', () => {
      // Create form data
      const formData = new FormData();
      formData.append('name', 'Alice');
      formData.append('email', 'alice@test.com');
      formData.append('interests', 'JavaScript');
      formData.append('interests', 'React');

      // Process through serialization pipeline
      const serialized = serializeFormData(formData);
      const eventPayload = deserializeEventPayload(serialized);

      expect(eventPayload.name).toBe('Alice');
      expect(eventPayload.email).toBe('alice@test.com');
      expect(eventPayload.interests).toEqual(['JavaScript', 'React']);
    });
  });
});
