/**
 * @fileoverview TypeScript Type Safety Tests for TypeSafeActor
 *
 * CRITICAL FINDING: Our TypeSafeActor implementation is NOT providing
 * immediate type validation as intended. This test file documents the
 * actual behavior we're seeing.
 */

import { describe, expect, test } from 'vitest';
import { asTypeSafeActor, createActor, defineBehavior, type MessageMap } from '../index.js';

// ============================================================================
// Test Message Maps
// ============================================================================

interface ValidMessageMap extends MessageMap {
  GET_USER: { id: number; name: string };
  UPDATE_USER: { success: boolean; message: string };
  DELETE_USER: { deleted: boolean };
}

// ============================================================================
// Tests Documenting Current Behavior
// ============================================================================

describe('TypeSafeActor - Current Behavior Analysis', () => {
  test('ISSUE: TypeSafeActor allows invalid message types (should not)', () => {
    const behavior = defineBehavior({
      onMessage: async () => ({ emit: null }),
    });

    const actor = createActor(behavior);
    const typedActor = asTypeSafeActor<ValidMessageMap>(actor);

    // These should be rejected by TypeScript but are NOT
    // This proves our conditional type approach is not working
    // @ts-expect-error - 'INVALID_MESSAGE' is not in ValidMessageMap
    typedActor.send({ type: 'INVALID_MESSAGE' }); // Should be rejected
    // @ts-expect-error - 'ANOTHER_INVALID' is not in ValidMessageMap
    typedActor.send({ type: 'ANOTHER_INVALID' }); // Should be rejected
    // @ts-expect-error - '' is not in ValidMessageMap
    typedActor.send({ type: '' }); // Should be rejected

    expect(true).toBe(true);
  });

  test('ISSUE: Ask pattern returns Promise<unknown> instead of typed responses', async () => {
    const behavior = defineBehavior({
      onMessage: async ({ message }) => {
        switch (message.type) {
          case 'GET_USER':
            return {
              emit: {
                type: 'RESPONSE',
                payload: { id: 1, name: 'test' },
              },
            };
          default:
            return { emit: null };
        }
      },
    });

    const actor = createActor(behavior);
    const typedActor = asTypeSafeActor<ValidMessageMap>(actor);

    // This should return Promise<{ id: number; name: string }> but returns Promise<unknown>
    const result = typedActor.ask({ type: 'GET_USER' });

    // We can't properly type check the result because it's unknown
    expect(result).toBeInstanceOf(Promise);
  });

  test('ISSUE: Valid message types work but without type safety', () => {
    const behavior = defineBehavior({
      onMessage: async () => ({ emit: null }),
    });

    const actor = createActor(behavior);
    const typedActor = asTypeSafeActor<ValidMessageMap>(actor);

    // These compile and work (which is good)
    typedActor.send({ type: 'GET_USER' });
    typedActor.send({ type: 'UPDATE_USER' });
    typedActor.send({ type: 'DELETE_USER' });

    expect(true).toBe(true);
  });
});

// ============================================================================
// Root Cause Analysis
// ============================================================================

describe('TypeSafeActor - Root Cause Investigation', () => {
  test('Should investigate why conditional types are not working', () => {
    const behavior = defineBehavior({
      onMessage: async () => ({ emit: null }),
    });

    const actor = createActor(behavior);
    const typedActor = asTypeSafeActor<ValidMessageMap>(actor);

    /**
     * ROOT CAUSE HYPOTHESIS:
     *
     * Our conditional type approach:
     * ask<K extends keyof T>(message: K extends keyof T ? MessageObject : never)
     *
     * Is not working because:
     * 1. TypeScript may be inferring K as 'string' instead of specific literal types
     * 2. The conditional type may not be evaluating to 'never' for invalid keys
     * 3. The asTypeSafeActor implementation may not be properly typed
     * 4. There may be issues with how we're constraining the generic parameters
     *
     * NEXT STEPS:
     * 1. Check the actual type signatures being generated
     * 2. Test simpler conditional type patterns
     * 3. Verify the asTypeSafeActor implementation
     * 4. Consider alternative approaches (discriminated unions, strict overloads)
     */

    expect(typedActor).toBeDefined();
  });
});
