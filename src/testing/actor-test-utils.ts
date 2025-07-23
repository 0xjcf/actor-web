/**
 * @module framework/testing/actor-test-utils
 * @description Test utilities and helpers for testing actor implementations
 * @author Agent C - 2025-07-15
 *
 * Updated for v2.0.0 to use @actor-core/runtime
 */

import type {
  ActorAddress,
  ActorMessage,
  ActorPID,
  ActorStats,
  ActorSystem,
  ClusterState,
  MessageInput,
  Observable,
} from '@actor-core/runtime';

/**
 * Mock Actor implementation for testing
 */
export class MockActor implements ActorPID {
  public readonly address: ActorAddress;
  private messages: ActorMessage[] = [];
  private isAliveValue = true;

  constructor(id: string) {
    this.address = { id, type: 'mock', path: `/mock/${id}` };
  }

  async send(message: MessageInput): Promise<void> {
    this.messages.push(message as ActorMessage);
  }

  async ask<T>(message: MessageInput): Promise<T> {
    this.messages.push(message as ActorMessage);
    // Return mock response
    return {} as T;
  }

  async stop(): Promise<void> {
    this.isAliveValue = false;
  }

  subscribe(_eventType: string): Observable<ActorMessage> {
    // Mock observable
    return {
      subscribe: () => ({ unsubscribe: () => {} }),
    } as Observable<ActorMessage>;
  }

  unsubscribe(_eventType: string): void {
    // Mock implementation
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

  subscribeToClusterEvents(): Observable<{
    type: 'node-up' | 'node-down' | 'leader-changed';
    node: string;
  }> {
    return {
      subscribe: () => ({ unsubscribe: () => {} }),
    } as Observable<{ type: 'node-up' | 'node-down' | 'leader-changed'; node: string }>;
  }

  onShutdown(_handler: () => Promise<void>): void {
    // Mock implementation
  }

  subscribeToSystemEvents(): Observable<{
    type: string;
    [key: string]: unknown;
  }> {
    return {
      subscribe: () => ({ unsubscribe: () => {} }),
    } as Observable<{ type: string; [key: string]: unknown }>;
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
 * Wait for an actor to receive a specific message
 */
export async function waitForMessage(
  actor: MockActor,
  messageType: string,
  timeout = 1000
): Promise<ActorMessage> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const messages = actor.getMessages();
    const found = messages.find((m) => m.type === messageType);
    if (found) return found;

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timeout waiting for message: ${messageType}`);
}
