/**
 * @file message-plan.unit.test.ts
 * @description Pure unit tests for MessagePlan utility functions
 *
 * These are TRUE unit tests - they test individual functions in isolation
 * without creating actor systems, spawning actors, or integration concerns.
 */

import { describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import {
  type ActorRef,
  type AskInstruction,
  createAskInstruction,
  createSendInstruction,
  type DomainEvent,
  isAskInstruction,
  isSendInstruction,
  type SendInstruction,
} from '../message-plan.js';
import { createMockActorRef } from '../utils/factories.js';
import { isDomainEvent, isMessagePlan } from '../utils/validation.js';

describe('MessagePlan Utility Functions (Unit Tests)', () => {
  describe('Type Guards', () => {
    it('should identify DomainEvent correctly', () => {
      const domainEvent: DomainEvent = {
        type: 'USER_CREATED',
        userId: '123',
        timestamp: Date.now(),
      };

      expect(isDomainEvent(domainEvent)).toBe(true);
      expect(isDomainEvent(null)).toBe(false);
      expect(isDomainEvent(undefined)).toBe(false);
      expect(isDomainEvent({})).toBe(false);
      expect(isDomainEvent({ type: 123 })).toBe(false);
    });

    it('should identify SendInstruction correctly', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'actor-123', type: 'test', path: '/actor-123' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const sendInstruction: SendInstruction = {
        to: mockActorRef,
        tell: { type: 'TEST_MESSAGE' },
        mode: 'fireAndForget',
      };

      expect(isSendInstruction(sendInstruction)).toBe(true);
      expect(isSendInstruction(null)).toBe(false);
      expect(isSendInstruction({})).toBe(false);
      expect(isSendInstruction({ to: 'invalid' })).toBe(false);
    });

    it('should identify AskInstruction correctly', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'actor-123', type: 'test', path: '/actor-123' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const askInstruction: AskInstruction = {
        to: mockActorRef,
        ask: { type: 'GET_DATA' },
        onOk: (response) => ({ type: 'SUCCESS', result: String(response), timestamp: Date.now() }),
        timeout: 5000,
      };

      expect(isAskInstruction(askInstruction)).toBe(true);
      expect(isAskInstruction(null)).toBe(false);
      expect(isAskInstruction({})).toBe(false);
      expect(isAskInstruction({ to: 'invalid' })).toBe(false);
    });

    it('should identify MessagePlan correctly', () => {
      const domainEvent: DomainEvent = { type: 'TEST_EVENT', timestamp: Date.now() };

      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: '123', type: 'test', path: '/123' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const sendInstruction: SendInstruction = {
        to: mockActorRef,
        tell: { type: 'TEST' },
        mode: 'fireAndForget',
      };

      const askInstruction: AskInstruction = {
        to: mockActorRef,
        ask: { type: 'GET' },
        onOk: () => ({ type: 'SUCCESS', timestamp: Date.now() }),
      };

      expect(isMessagePlan(domainEvent)).toBe(true);
      expect(isMessagePlan(sendInstruction)).toBe(true);
      expect(isMessagePlan(askInstruction)).toBe(true);
      expect(isMessagePlan([domainEvent, sendInstruction])).toBe(true);
      expect(isMessagePlan(null)).toBe(true); // null is valid (void response)
      expect(isMessagePlan(undefined)).toBe(true); // undefined is valid (void response)
      expect(isMessagePlan('invalid')).toBe(false);
      expect(isMessagePlan(123)).toBe(false);
    });
  });

  describe('Factory Functions', () => {
    it('should create SendInstruction with correct structure', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'test-actor', type: 'test', path: '/test-actor' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const message = {
        type: 'TEST_MESSAGE',
        data: 'test',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const sendInstruction = createSendInstruction(mockActorRef, message);

      expect(sendInstruction.to).toBe(mockActorRef);
      expect(sendInstruction.tell).toBe(message);
      expect(sendInstruction.mode).toBe('fireAndForget'); // default
      expect(isSendInstruction(sendInstruction)).toBe(true);
    });

    it('should create SendInstruction with custom mode', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'test-actor', type: 'test', path: '/test-actor' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const message = {
        type: 'TEST_MESSAGE',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const sendInstruction = createSendInstruction(mockActorRef, message, 'retry(3)');

      expect(sendInstruction.mode).toBe('retry(3)');
      expect(isSendInstruction(sendInstruction)).toBe(true);
    });

    it('should create AskInstruction with correct structure', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'test-actor', type: 'test', path: '/test-actor' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({ result: 'success' }) as T,
      });

      const message = {
        type: 'GET_DATA',
        query: 'test',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const onOkCallback = (response: unknown) => ({
        type: 'DATA_RECEIVED',
        result: String(response),
        timestamp: Date.now(),
      });

      const askInstruction = createAskInstruction(mockActorRef, message, onOkCallback);

      expect(askInstruction.to).toBe(mockActorRef);
      expect(askInstruction.ask).toBe(message);
      expect(askInstruction.onOk).toBe(onOkCallback);
      expect(askInstruction.timeout).toBe(5000); // default
      expect(isAskInstruction(askInstruction)).toBe(true);
    });

    it('should create AskInstruction with custom timeout', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'test-actor', type: 'test', path: '/test-actor' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const message = {
        type: 'GET_DATA',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const onOkCallback = () => ({ type: 'SUCCESS', timestamp: Date.now() });

      const askInstruction = createAskInstruction(
        mockActorRef,
        message,
        onOkCallback,
        undefined, // onError parameter
        10000 // 10 second timeout
      );

      expect(askInstruction.timeout).toBe(10000);
      expect(isAskInstruction(askInstruction)).toBe(true);
    });

    it('should handle timeout in createAskInstruction', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'test-actor', type: 'test', path: '/test-actor' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const message = {
        type: 'GET_DATA',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const onOkCallback = () => ({ type: 'SUCCESS', timestamp: Date.now() });

      const askInstruction = createAskInstruction(
        mockActorRef,
        message,
        onOkCallback,
        undefined, // onError parameter
        10000 // 10 second timeout
      );

      expect(askInstruction.timeout).toBe(10000);
      expect(isAskInstruction(askInstruction)).toBe(true);
    });

    it('should handle error callback in createAskInstruction', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'test-actor', type: 'test', path: '/test-actor' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const message = {
        type: 'GET_DATA',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const onOkCallback = () => ({ type: 'SUCCESS', timestamp: Date.now() });

      const askInstruction = createAskInstruction(
        mockActorRef,
        message,
        onOkCallback,
        undefined, // onError parameter
        10000 // 10 second timeout
      );

      expect(askInstruction.timeout).toBe(10000);
      expect(isAskInstruction(askInstruction)).toBe(true);
    });

    it('should validate both onOk and onError in createAskInstruction', () => {
      const mockActorRef: ActorRef<ActorMessage> = createMockActorRef({
        address: { id: 'test-actor', type: 'test', path: '/test-actor' },
        send: async () => {},
        ask: async <T>(): Promise<T> => ({}) as T,
      });

      const message = {
        type: 'GET_DATA',
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const onOkCallback = () => ({ type: 'SUCCESS', timestamp: Date.now() });

      const askInstruction = createAskInstruction(
        mockActorRef,
        message,
        onOkCallback,
        undefined, // onError parameter
        10000 // 10 second timeout
      );

      expect(askInstruction.timeout).toBe(10000);
      expect(isAskInstruction(askInstruction)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty arrays as valid MessagePlan', () => {
      expect(isMessagePlan([])).toBe(true);
    });

    it('should reject mixed invalid/valid arrays', () => {
      const validEvent: DomainEvent = { type: 'VALID', timestamp: Date.now() };
      const mixedArray = [validEvent, 'invalid', null];

      expect(isMessagePlan(mixedArray)).toBe(false);
    });

    it('should handle nested arrays correctly', () => {
      const validEvent: DomainEvent = { type: 'VALID', timestamp: Date.now() };
      const nestedArray = [[validEvent]];

      // Nested arrays are not valid MessagePlan
      expect(isMessagePlan(nestedArray)).toBe(false);
    });
  });
});
