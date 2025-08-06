/**
 * @module actor-core/runtime/distributed-actor-directory.test
 * @description Tests for the DistributedActorDirectory implementation
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorAddress } from '../actor-system.js';
import { DistributedActorDirectory } from '../distributed-actor-directory.js';
import { Logger } from '../logger.js';
import { createActorDelay } from '../pure-xstate-utilities.js';

const log = Logger.namespace('TEST');
// import { enableDevMode } from './logger'; // Removed - use pnpm test:debug for verbose output

// Removed enableDevMode() - tests run quietly by default
// Use `pnpm test:debug` for verbose output when needed

function createActorAddress(id: string, type: string, node: string): ActorAddress {
  return {
    id,
    type,
    node,
    path: `actor://${node}/${type}/${id}`,
  };
}

describe.skip('DistributedActorDirectory', () => {
  let directory: DistributedActorDirectory;
  let testActorAddress: ActorAddress;

  beforeEach(() => {
    directory = new DistributedActorDirectory({
      nodeAddress: 'test-node',
    });
    testActorAddress = createActorAddress('test-actor', 'test-type', 'test-node');
  });

  afterEach(async () => {
    await directory.cleanup();
  });

  describe.skip('Actor Registration', () => {
    it('should register an actor successfully', async () => {
      await directory.register(testActorAddress, 'test-location');

      const location = await directory.lookup(testActorAddress);
      expect(location).toBe('test-location');
    });

    it('should unregister an actor successfully', async () => {
      await directory.register(testActorAddress, 'test-location');
      await directory.unregister(testActorAddress);

      const location = await directory.lookup(testActorAddress);
      expect(location).toBeUndefined();
    });

    it('should handle duplicate registrations', async () => {
      await directory.register(testActorAddress, 'location1');
      await directory.register(testActorAddress, 'location2');

      const location = await directory.lookup(testActorAddress);
      expect(location).toBe('location2');
    });
  });

  describe.skip('Actor Lookup with Caching', () => {
    it('should achieve cache hit on subsequent lookups', async () => {
      await directory.register(testActorAddress, 'test-location');

      // First lookup - should populate cache
      const location1 = await directory.lookup(testActorAddress);
      expect(location1).toBe('test-location');

      // Second lookup - should be cache hit
      const location2 = await directory.lookup(testActorAddress);
      expect(location2).toBe('test-location');

      const stats = directory.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5); // 1 hit out of 2 lookups
    });

    it('should return undefined for non-existent actor', async () => {
      const nonExistentAddress = createActorAddress('non-existent', 'test-type', 'test-node');

      const location = await directory.lookup(nonExistentAddress);
      expect(location).toBeUndefined();
    });

    it('should handle TTL expiration', async () => {
      // Register with very short TTL for testing
      const shortTtlDirectory = new DistributedActorDirectory({
        nodeAddress: 'test-node',
        cacheTtl: 50, // 50ms
        cleanupInterval: 25,
      });

      await shortTtlDirectory.register(testActorAddress, 'test-location');

      // First lookup - should work
      const location1 = await shortTtlDirectory.lookup(testActorAddress);
      expect(location1).toBe('test-location');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second lookup - should miss due to expiration
      const location2 = await shortTtlDirectory.lookup(testActorAddress);
      expect(location2).toBeUndefined();

      await shortTtlDirectory.cleanup();
    });
  });

  describe.skip('Performance Metrics', () => {
    it('should track cache statistics correctly', async () => {
      await directory.register(testActorAddress, 'test-location');

      // Perform multiple lookups
      await directory.lookup(testActorAddress); // Miss
      await directory.lookup(testActorAddress); // Hit
      await directory.lookup(testActorAddress); // Hit

      const stats = directory.getCacheStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(2 / 3); // 2 hits out of 3 lookups
      expect(stats.size).toBe(1);
    });

    it('should achieve 90%+ cache hit rate with realistic workload', async () => {
      const actorAddresses: ActorAddress[] = [];

      log.debug('=== Starting cache hit rate test ===');

      // Register 100 actors
      for (let i = 0; i < 100; i++) {
        const address = createActorAddress(`actor-${i}`, 'test-type', 'test-node');
        actorAddresses.push(address);
        await directory.register(address, `location-${i}`);
      }

      log.debug(`Registered ${actorAddresses.length} actors`);

      // Perform 1000 lookups with realistic access patterns
      // (some actors accessed more frequently than others)
      let lookupCount = 0;
      for (let i = 0; i < 1000; i++) {
        // 80% of lookups go to 20% of actors (hot actors)
        const isHotAccess = Math.random() < 0.8;
        const actorIndex = isHotAccess
          ? Math.floor(Math.random() * 20) // First 20 actors
          : Math.floor(Math.random() * 100); // Any actor

        const address = actorAddresses[actorIndex];
        const location = await directory.lookup(address);
        expect(location).toBe(`location-${actorIndex}`);
        lookupCount++;

        // Log progress every 100 lookups
        if (lookupCount % 100 === 0) {
          const stats = directory.getCacheStats();
          log.debug(
            `After ${lookupCount} lookups: ${stats.hits} hits, ${stats.misses} misses, ${(stats.hitRate * 100).toFixed(2)}% hit rate`
          );
        }
      }

      const stats = directory.getCacheStats();
      const hitRate = stats.hitRate;

      log.debug(
        `Final stats: ${stats.hits} hits, ${stats.misses} misses, ${(hitRate * 100).toFixed(2)}% hit rate`
      );
      log.debug(`Cache size: ${stats.size}`);
      log.debug('Expected hit rate: >90%');

      // Should achieve 90%+ hit rate with realistic access patterns
      expect(hitRate).toBeGreaterThan(0.9);
      expect(stats.hits + stats.misses).toBe(1000);

      log.debug(`Cache hit rate: ${(hitRate * 100).toFixed(2)}%`);
      log.debug(`Cache size: ${stats.size}`);
    });
  });

  describe.skip('Cache Management', () => {
    it('should evict oldest entries when cache exceeds maximum size', async () => {
      const smallCacheDirectory = new DistributedActorDirectory({
        nodeAddress: 'test-node',
        maxCacheSize: 3,
      });

      // Register more actors than cache size
      const addresses: ActorAddress[] = [];
      for (let i = 0; i < 5; i++) {
        const address = createActorAddress(`actor-${i}`, 'test-type', 'test-node');
        addresses.push(address);
        await smallCacheDirectory.register(address, `location-${i}`);
      }

      // Access first 3 actors to load them into cache
      for (let i = 0; i < 3; i++) {
        await smallCacheDirectory.lookup(addresses[i]);
      }

      const stats = smallCacheDirectory.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(3);

      await smallCacheDirectory.cleanup();
    });

    it('should clean up expired entries periodically', async () => {
      const shortTtlDirectory = new DistributedActorDirectory({
        nodeAddress: 'test-node',
        cacheTtl: 50,
        cleanupInterval: 25,
      });

      await shortTtlDirectory.register(testActorAddress, 'test-location');
      await shortTtlDirectory.lookup(testActorAddress);

      // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
      await createActorDelay(100);

      // ✅ CORRECT: Trigger cleanup before checking stats
      await shortTtlDirectory.cleanup();

      const stats = shortTtlDirectory.getCacheStats();
      expect(stats.size).toBe(0);

      await shortTtlDirectory.cleanup();
    });
  });

  describe.skip('Actor Listing', () => {
    it('should list actors by type', async () => {
      const address1 = createActorAddress('actor1', 'type1', 'test-node');
      const address2 = createActorAddress('actor2', 'type1', 'test-node');
      const address3 = createActorAddress('actor3', 'type2', 'test-node');

      await directory.register(address1, 'location1');
      await directory.register(address2, 'location2');
      await directory.register(address3, 'location3');

      const type1Actors = await directory.listByType('type1');
      expect(type1Actors).toHaveLength(2);
      expect(type1Actors.map((a) => a.id)).toEqual(expect.arrayContaining(['actor1', 'actor2']));

      const type2Actors = await directory.listByType('type2');
      expect(type2Actors).toHaveLength(1);
      expect(type2Actors[0].id).toBe('actor3');
    });

    it('should get all registered actors', async () => {
      const address1 = createActorAddress('actor1', 'type1', 'test-node');
      const address2 = createActorAddress('actor2', 'type2', 'test-node');

      log.debug('=== Starting getAll test ===');
      log.debug('Address1:', address1);
      log.debug('Address2:', address2);

      await directory.register(address1, 'location1');
      await directory.register(address2, 'location2');

      log.debug('Registered both actors');

      const allActors = await directory.getAll();
      log.debug('All actors map size:', allActors.size);
      log.debug('All actors map entries:');
      for (const [key, value] of allActors) {
        log.debug(`  Key: ${key}, Value: ${value}`);
      }

      expect(allActors.size).toBe(2);

      // Test with actor paths as keys
      expect(allActors.get(address1.path)).toBe('location1');
      expect(allActors.get(address2.path)).toBe('location2');

      // Verify we can find both addresses
      expect(allActors.has(address1.path)).toBe(true);
      expect(allActors.has(address2.path)).toBe(true);
    });
  });

  describe.skip('Event Subscription', () => {
    it('should notify subscribers of registration events', async () => {
      const events: Array<{
        type: string;
        address: ActorAddress;
        location?: string;
      }> = [];

      const unsubscribe = directory.subscribeToChanges((event) => {
        events.push(event);
      });

      await directory.register(testActorAddress, 'test-location');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('registered');
      expect(events[0].address).toEqual(testActorAddress);
      expect(events[0].location).toBe('test-location');

      unsubscribe();
    });

    it('should notify subscribers of unregistration events', async () => {
      const events: Array<{
        type: string;
        address: ActorAddress;
        location?: string;
      }> = [];

      const unsubscribe = directory.subscribeToChanges((event) => {
        events.push(event);
      });

      await directory.register(testActorAddress, 'test-location');
      await directory.unregister(testActorAddress);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('registered');
      expect(events[1].type).toBe('unregistered');

      unsubscribe();
    });
  });

  describe.skip('Error Handling', () => {
    it('should handle corrupted cache gracefully', async () => {
      await directory.register(testActorAddress, 'test-location');

      // Access private cache to corrupt it
      const cache = (directory as unknown as { cache: Map<string, unknown> }).cache;
      cache.set('corrupted-key', { invalid: 'data' });

      // Should still work normally
      const location = await directory.lookup(testActorAddress);
      expect(location).toBe('test-location');
    });

    it('should handle subscriber errors gracefully', async () => {
      const unsubscribe = directory.subscribeToChanges(() => {
        throw new Error('Subscriber error');
      });

      // Should not throw when notifying subscribers
      await expect(directory.register(testActorAddress, 'test-location')).resolves.not.toThrow();

      unsubscribe();
    });
  });
});
