/**
 * @module framework/testing/actor-test-utils
 * @description Test utilities and helpers for testing actor implementations
 * @author Agent C - 2025-07-15
 * 
 * Updated for v2.0.0 to use @actor-core/runtime
 */

import { vi } from 'vitest';
import type { EventObject, StateMachine } from 'xstate';
import type { 
  ActorRef, 
  ActorSystem,
  Message,
  ActorStats 
} from '@actor-core/runtime';

/**
 * Mock Actor implementation for testing
 */
export class MockActor implements ActorRef {
  public readonly id: string;
  private messages: Message[] = [];
  private isAliveValue = true;
  
  constructor(id: string) {
    this.id = id;
  }
  
  async send(message: Message): Promise<void> {
    this.messages.push(message);
  }
  
  async ask<T>(message: Message): Promise<T> {
    this.messages.push(message);
    // Return mock response
    return {} as T;
  }
  
  async isAlive(): Promise<boolean> {
    return this.isAliveValue;
  }
  
  async getStats(): Promise<ActorStats> {
    return {
      messagesProcessed: this.messages.length,
      messagesReceived: this.messages.length,
      uptime: 1000,
      lastMessageTime: Date.now()
    };
  }
  
  // Test helpers
  getMessages(): Message[] {
    return [...this.messages];
  }
  
  clearMessages(): void {
    this.messages = [];
  }
  
  setAlive(value: boolean): void {
    this.isAliveValue = value;
  }
}

/**
 * Mock Actor System for testing
 */
export class MockActorSystem implements ActorSystem {
  private actors = new Map<string, MockActor>();
  
  async start(): Promise<void> {
    // No-op for mock
  }
  
  async stop(): Promise<void> {
    // No-op for mock
  }
  
  async spawn(behavior: any, options?: { id?: string }): Promise<MockActor> {
    const id = options?.id || `actor-${Date.now()}`;
    const actor = new MockActor(id);
    this.actors.set(id, actor);
    return actor;
  }
  
  async lookup(path: string): Promise<MockActor | null> {
    // Simple lookup by ID for testing
    const id = path.split('/').pop() || '';
    return this.actors.get(id) || null;
  }
  
  async listActors(): Promise<string[]> {
    return Array.from(this.actors.keys());
  }
  
  // Test helpers
  getActor(id: string): MockActor | undefined {
    return this.actors.get(id);
  }
  
  clearActors(): void {
    this.actors.clear();
  }
}

/**
 * Create a test environment with mock actor system
 */
export function createTestEnvironment() {
  const system = new MockActorSystem();
  
  return {
    system,
    async createActor(id: string): Promise<MockActor> {
      return system.spawn({}, { id });
    },
    cleanup() {
      system.clearActors();
    }
  };
}

/**
 * Create a mock actor ref for testing
 */
export function createMockActorRef(id = 'test-actor'): MockActor {
  return new MockActor(id);
}

/**
 * Assert that an actor received a specific message
 */
export function assertMessageReceived(
  actor: MockActor,
  expectedMessage: Partial<Message>
): void {
  const messages = actor.getMessages();
  const found = messages.some(msg => 
    msg.type === expectedMessage.type &&
    (expectedMessage.payload === undefined || 
     JSON.stringify(msg.payload) === JSON.stringify(expectedMessage.payload))
  );
  
  if (!found) {
    throw new Error(
      `Expected actor to receive message ${expectedMessage.type}, ` +
      `but got: ${messages.map(m => m.type).join(', ')}`
    );
  }
}

/**
 * Wait for an actor to receive a specific message
 */
export async function waitForMessage(
  actor: MockActor,
  messageType: string,
  timeout = 1000
): Promise<Message> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    const messages = actor.getMessages();
    const found = messages.find(m => m.type === messageType);
    if (found) return found;
    
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  throw new Error(`Timeout waiting for message: ${messageType}`);
}