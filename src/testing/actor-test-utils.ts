/**
 * @module framework/testing/actor-test-utils
 * @description Test utilities and helpers for testing actor implementations
 * @author Agent C - 2025-07-15
 *
 * Updated for v2.0.0 to use @actor-core/runtime
 * Cleaned up for pure actor model compliance - no timeouts, no observables
 */

import type {
  ActorAddress,
  ActorMessage,
  ActorPID,
  ActorStats,
  ActorSystem,
  BasicMessage,
  ClusterState,
} from '@actor-core/runtime';

/**
 * Mock Actor implementation for testing - Pure Actor Model Compliant
 */
export class MockActor implements ActorPID {
  public readonly address: ActorAddress;
  private messages: ActorMessage[] = [];
  private isAliveValue = true;

  constructor(id: string) {
    this.address = { id, type: 'mock', path: `/mock/${id}` };
  }

  async send(message: BasicMessage): Promise<void> {
    this.messages.push(message as ActorMessage);
  }

  async ask<T>(message: BasicMessage): Promise<T> {
    this.messages.push(message as ActorMessage);
    // Return mock response
    return {} as T;
  }

  async stop(): Promise<void> {
    this.isAliveValue = false;
  }

  subscribe(_eventType: string, _listener: (event: ActorMessage) => void): () => void {
    // Mock implementation - just return a cleanup function
    // In a real implementation, this would register the listener and return an unsubscribe function
    return () => {
      // Mock unsubscribe - in real implementation would remove listener
    };
  }

  async isAlive(): Promise<boolean> {
    return this.isAliveValue;
  }

  async getStats(): Promise<ActorStats> {
    return {
      messagesProcessed: this.messages.length,
      messagesReceived: this.messages.length,
      errors: 0,
      uptime: 1000,
    };
  }

  // Test helpers
  getMessages(): ActorMessage[] {
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
 * Mock Actor System for testing - Pure Actor Model Compliant
 */
export class MockActorSystem implements ActorSystem {
  private actors = new Map<string, MockActor>();

  async start(): Promise<void> {
    // No-op for mock
  }

  async stop(): Promise<void> {
    // No-op for mock
  }

  async spawn(_behavior: unknown, options?: { id?: string }): Promise<MockActor> {
    const id = options?.id || `actor-${Date.now()}`;
    const actor = new MockActor(id);
    this.actors.set(id, actor);
    return actor;
  }

  async lookup(path: string): Promise<ActorPID | undefined> {
    // Simple lookup by ID for testing
    const id = path.split('/').pop() || '';
    return this.actors.get(id) || undefined;
  }

  async listActors(): Promise<ActorAddress[]> {
    return Array.from(this.actors.values()).map((actor) => actor.address);
  }

  async getSystemStats(): Promise<{
    totalActors: number;
    messagesPerSecond: number;
    uptime: number;
    clusterState: ClusterState;
  }> {
    return {
      totalActors: this.actors.size,
      messagesPerSecond: 0,
      uptime: 1000,
      clusterState: { nodes: [], leader: undefined, status: 'up' as const },
    };
  }

  async join(_nodes: string[]): Promise<void> {
    // Mock implementation
  }

  async leave(): Promise<void> {
    // Mock implementation
  }

  getClusterState(): ClusterState {
    return { nodes: [], leader: undefined, status: 'up' as const };
  }

  subscribeToClusterEvents(
    _listener: (event: { type: 'node-up' | 'node-down' | 'leader-changed'; node: string }) => void
  ): () => void {
    // Mock implementation - just return a cleanup function
    return () => {
      // Mock unsubscribe - in real implementation would remove listener
    };
  }

  onShutdown(_handler: () => Promise<void>): void {
    // Mock implementation
  }

  subscribeToSystemEvents(
    _listener: (event: { type: string; [key: string]: unknown }) => void
  ): () => void {
    // Mock implementation - just return a cleanup function
    return () => {
      // Mock unsubscribe - in real implementation would remove listener
    };
  }

  // Test helpers
  getActor(id: string): MockActor | undefined {
    return this.actors.get(id);
  }

  clearActors(): void {
    this.actors.clear();
  }

  isRunning(): boolean {
    return true;
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
    },
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
  expectedMessage: Partial<ActorMessage>
): void {
  const messages = actor.getMessages();
  const found = messages.some(
    (msg) =>
      msg.type === expectedMessage.type &&
      (expectedMessage.payload === undefined ||
        JSON.stringify(msg.payload) === JSON.stringify(expectedMessage.payload))
  );

  if (!found) {
    throw new Error(
      `Expected actor to receive message ${expectedMessage.type}, ` +
        `but got: ${messages.map((m) => m.type).join(', ')}`
    );
  }
}

/**
 * Check if actor received a specific message (pure, no timeouts)
 * Use this instead of waitForMessage for pure actor model compliance
 */
export function hasReceivedMessage(
  actor: MockActor,
  messageType: string
): ActorMessage | undefined {
  const messages = actor.getMessages();
  return messages.find((m) => m.type === messageType);
}

/**
 * Get all messages of a specific type received by actor
 */
export function getMessagesOfType(actor: MockActor, messageType: string): ActorMessage[] {
  const messages = actor.getMessages();
  return messages.filter((m) => m.type === messageType);
}
