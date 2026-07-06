import { describe, expect, it } from 'vitest';
import type { ActorAddress, ActorDirectory, ActorMessage, AddressQuery } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import type { RuntimeDirectoryEntry } from '../runtime-transport-protocol.js';
import { defineBehavior } from '../unified-actor-builder.js';
import { matchesAddressQuery } from '../utils/factories.js';

class RecordingDirectory implements ActorDirectory {
  readonly registered: Array<{ address: ActorAddress; location: string }> = [];
  readonly unregistered: ActorAddress[] = [];
  readonly remoteEntries: RuntimeDirectoryEntry[] = [];
  readonly removedRemoteEntries: ActorAddress[] = [];
  cleanupCalled = false;
  private readonly entries = new Map<string, string>();
  private readonly listeners = new Set<
    (event: {
      type: 'registered' | 'unregistered' | 'updated';
      address: ActorAddress;
      location?: string;
    }) => void
  >();

  async register(address: ActorAddress, location: string): Promise<void> {
    this.registered.push({ address, location });
    this.entries.set(address, location);
    this.emit({ type: 'registered', address, location });
  }

  async unregister(address: ActorAddress): Promise<void> {
    this.unregistered.push(address);
    this.entries.delete(address);
    this.emit({ type: 'unregistered', address });
  }

  async lookup(address: ActorAddress): Promise<string | undefined> {
    return this.entries.get(address);
  }

  async find(query: AddressQuery): Promise<ActorAddress[]> {
    return Array.from(this.entries.keys())
      .map((address) => address as ActorAddress)
      .filter((address) => matchesAddressQuery(address, query));
  }

  async getAll(): Promise<Map<string, string>> {
    return new Map(this.entries);
  }

  subscribeToChanges(
    listener: (event: {
      type: 'registered' | 'unregistered' | 'updated';
      address: ActorAddress;
      location?: string;
    }) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  applyRemoteEntry(entry: RuntimeDirectoryEntry): void {
    this.remoteEntries.push(entry);
    this.entries.set(entry.address, entry.location);
  }

  removeRemoteEntry(address: ActorAddress): void {
    this.removedRemoteEntries.push(address);
    this.entries.delete(address);
  }

  exportEntries(): RuntimeDirectoryEntry[] {
    return this.remoteEntries;
  }

  getCacheStats(): {
    size: number;
    hitRate: number;
    hits: number;
    misses: number;
    maxSize: number;
  } {
    return {
      size: this.entries.size,
      hitRate: 0,
      hits: 0,
      misses: 0,
      maxSize: Number.POSITIVE_INFINITY,
    };
  }

  async cleanup(): Promise<void> {
    this.cleanupCalled = true;
    this.entries.clear();
    this.listeners.clear();
  }

  private emit(event: {
    type: 'registered' | 'unregistered' | 'updated';
    address: ActorAddress;
    location?: string;
  }): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe('ActorSystemImpl directory injection', () => {
  it('uses a configured ActorDirectory implementation for actor registration and cleanup', async () => {
    const directory = new RecordingDirectory();
    const system = new ActorSystemImpl({
      nodeAddress: 'node-a',
      directory: { implementation: directory },
    });

    await system.start();

    try {
      const actor = await system.spawn(
        defineBehavior<ActorMessage>()
          .onMessage(() => undefined)
          .build(),
        { id: 'directory-owned' }
      );

      expect(directory.registered).toContainEqual({
        address: actor.address,
        location: 'node-a',
      });
      await expect(system.lookup(actor.address)).resolves.toBeDefined();
      expect(system.getDirectoryStats()).toMatchObject({ size: directory.registered.length });
    } finally {
      await system.stop();
    }

    expect(directory.cleanupCalled).toBe(true);
  });
});
