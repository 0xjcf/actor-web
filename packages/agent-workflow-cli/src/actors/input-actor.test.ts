/**
 * InputActor Tests
 *
 * Tests for the InputActor implementation to verify real-time validation,
 * suggestion generation, and state management.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createInputActor, type InputActor } from './input-actor';

describe('InputActor', () => {
  let inputActor: InputActor;

  beforeEach(() => {
    inputActor = createInputActor({
      availableCommands: ['help', 'state', 'events', 'status', 'q'],
      availableEvents: ['CHECK_STATUS', 'COMMIT_CHANGES', 'PUSH_CHANGES'],
    });

    inputActor.start();
  });

  describe('Real-time Validation', () => {
    it('should validate input as user types', () => {
      // Type "h" - should be red (invalid)
      inputActor.send({ type: 'CHAR_TYPED', char: 'h' });

      let snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(false);
      expect(snapshot.context.validationResult.color).toBe('red');
      expect(snapshot.context.currentInput).toBe('h');
      expect(snapshot.context.validationResult.message).toBe('Unknown command: h');

      // Type "e" - should still be red
      inputActor.send({ type: 'CHAR_TYPED', char: 'e' });

      snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(false);
      expect(snapshot.context.validationResult.color).toBe('red');
      expect(snapshot.context.currentInput).toBe('he');

      // Type "l" - should still be red
      inputActor.send({ type: 'CHAR_TYPED', char: 'l' });

      snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.color).toBe('red');
      expect(snapshot.context.currentInput).toBe('hel');

      // Type "p" - should now be green (valid "help" command)
      inputActor.send({ type: 'CHAR_TYPED', char: 'p' });

      snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(true);
      expect(snapshot.context.validationResult.color).toBe('green');
      expect(snapshot.context.currentInput).toBe('help');
    });

    it('should validate git events in uppercase', () => {
      // Type "CHECK_STATUS" - should be green
      'CHECK_STATUS'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(true);
      expect(snapshot.context.validationResult.color).toBe('green');
      expect(snapshot.context.currentInput).toBe('CHECK_STATUS');
    });

    it('should show red for unknown commands', () => {
      // Type "unknown" - should be red
      'unknown'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(false);
      expect(snapshot.context.validationResult.color).toBe('red');
      expect(snapshot.context.validationResult.message).toBe('Unknown command: unknown');
    });

    it('should show gray for empty input', () => {
      // Start with empty input
      const snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.color).toBe('gray');
      expect(snapshot.context.validationResult.isValid).toBe(true);
    });
  });

  describe('Suggestion Generation', () => {
    it('should generate suggestions as user types', () => {
      // Type "h" - should suggest "help"
      inputActor.send({ type: 'CHAR_TYPED', char: 'h' });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.context.suggestions).toContain('help');
      expect(snapshot.context.currentInput).toBe('h');
    });

    it('should suggest both commands and events', () => {
      // Type "c" - should suggest both "COMMIT_CHANGES" and "CHECK_STATUS"
      inputActor.send({ type: 'CHAR_TYPED', char: 'c' });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.context.suggestions).toContain('COMMIT_CHANGES');
      expect(snapshot.context.suggestions).toContain('CHECK_STATUS');
    });
  });

  describe('State Transitions', () => {
    it('should transition from idle to typing', () => {
      expect(inputActor.getSnapshot().value).toBe('idle');

      inputActor.send({ type: 'CHAR_TYPED', char: 'h' });

      expect(inputActor.getSnapshot().value).toBe('typing');
    });

    it('should transition to completing on tab press', () => {
      inputActor.send({ type: 'CHAR_TYPED', char: 'h' });
      inputActor.send({ type: 'TAB_PRESSED' });

      expect(inputActor.getSnapshot().value).toBe('completing');
    });

    it('should transition to validating on enter press', () => {
      inputActor.send({ type: 'CHAR_TYPED', char: 'h' });
      inputActor.send({ type: 'CHAR_TYPED', char: 'e' });
      inputActor.send({ type: 'CHAR_TYPED', char: 'l' });
      inputActor.send({ type: 'CHAR_TYPED', char: 'p' });
      inputActor.send({ type: 'ENTER_PRESSED' });

      expect(inputActor.getSnapshot().value).toBe('valid');
    });

    it('should transition to invalid state for bad input', () => {
      inputActor.send({ type: 'CHAR_TYPED', char: 'x' });
      inputActor.send({ type: 'CHAR_TYPED', char: 'y' });
      inputActor.send({ type: 'CHAR_TYPED', char: 'z' });
      inputActor.send({ type: 'ENTER_PRESSED' });

      expect(inputActor.getSnapshot().value).toBe('invalid');
    });
  });

  describe('Context Updates', () => {
    it('should update context on every keystroke', () => {
      inputActor.send({ type: 'CHAR_TYPED', char: 'h' });

      let snapshot = inputActor.getSnapshot();
      expect(snapshot.context.currentInput).toBe('h');
      expect(snapshot.context.validationResult.isValid).toBe(false);

      inputActor.send({ type: 'CHAR_TYPED', char: 'e' });

      snapshot = inputActor.getSnapshot();
      expect(snapshot.context.currentInput).toBe('he');
      expect(snapshot.context.validationResult.isValid).toBe(false);
    });

    it('should update suggestions on every keystroke', () => {
      inputActor.send({ type: 'CHAR_TYPED', char: 'h' });

      let snapshot = inputActor.getSnapshot();
      expect(snapshot.context.suggestions).toContain('help');

      inputActor.send({ type: 'CHAR_TYPED', char: 'e' });

      snapshot = inputActor.getSnapshot();
      expect(snapshot.context.suggestions.length).toBeGreaterThan(0);
    });

    it('should show validation result for valid input', () => {
      'help'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });
      inputActor.send({ type: 'ENTER_PRESSED' });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.value).toBe('valid');
      expect(snapshot.context.validationResult.isValid).toBe(true);
    });

    it('should show validation result for invalid input', () => {
      'invalid'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });
      inputActor.send({ type: 'ENTER_PRESSED' });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.value).toBe('invalid');
      expect(snapshot.context.validationResult.isValid).toBe(false);
    });
  });

  describe('Backspace Handling', () => {
    it('should handle backspace correctly', () => {
      // Type "help" then backspace
      'help'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });

      inputActor.send({ type: 'BACKSPACE' });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.context.currentInput).toBe('hel');
      expect(snapshot.context.cursorPosition).toBe(3);
    });

    it('should revalidate after backspace', () => {
      // Type "help" (valid) then backspace to "hel" (invalid)
      'help'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });

      inputActor.send({ type: 'BACKSPACE' });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(false);
      expect(snapshot.context.validationResult.color).toBe('red');
      expect(snapshot.context.currentInput).toBe('hel');
    });
  });

  describe('Available Events Update', () => {
    it('should update available events and revalidate', () => {
      // Type an event that's not available
      'NEW_EVENT'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });

      let snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(false);

      // Update available events to include this event
      inputActor.send({ type: 'UPDATE_AVAILABLE_EVENTS', events: ['NEW_EVENT'] });

      snapshot = inputActor.getSnapshot();
      expect(snapshot.context.validationResult.isValid).toBe(true);
      expect(snapshot.context.validationResult.color).toBe('green');
      expect(snapshot.context.availableEvents).toContain('NEW_EVENT');
    });
  });

  describe('Clear Input', () => {
    it('should clear input and return to idle state', () => {
      'help'.split('').forEach((char) => {
        inputActor.send({ type: 'CHAR_TYPED', char });
      });

      inputActor.send({ type: 'CLEAR_INPUT' });

      const snapshot = inputActor.getSnapshot();
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.currentInput).toBe('');
      expect(snapshot.context.cursorPosition).toBe(0);
    });
  });
});
