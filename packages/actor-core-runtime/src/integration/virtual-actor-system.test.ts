/**
 * @module actor-core/runtime/tests/virtual-actor-system.test
 * @description Tests for virtual actor system with Orleans-style caching
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setup } from 'xstate';
import type { ActorRef } from '../actor-ref.js';
import { createActorRef } from '../create-actor-ref.js';
import type { BaseEventObject } from '../types.js';
import {
  ActorDirectory,
  ConsistentHashPlacementStrategy,
  createConsistentHashVirtualActorSystem,
  createLoadAwareVirtualActorSystem,
  createVirtualActorSystem,
  LoadAwarePlacementStrategy,
  type NodeMetrics,
  RoundRobinPlacementStrategy,
  type VirtualActorEntry,
  type VirtualActorId,
  VirtualActorSystem,
  type VirtualActorSystemConfig,
} from '../virtual-actor-system.js';

// ✅ CORRECT: Use real framework API instead of complex mocks
// Test machine for creating real ActorRef instances
const testActorMachine = setup({
  types: {
    context: {} as { id: string },
    events: {} as { type: 'TEST_EVENT' },
  },
}).createMachine({
  id: 'test-actor',
  initial: 'active',
  context: ({ input }) => ({ id: (input as { id: string })?.id || 'unknown' }),
  states: {
    active: {
      on: {
        TEST_EVENT: { target: 'active' }, // Simple transition for testing
      },
    },
  },
});

// ✅ Helper to create real ActorRef for testing (behavior-focused)
function createTestActorRef(id: string): ActorRef<BaseEventObject> {
  // Use real framework API - this is what the framework is designed for!
  return createActorRef(testActorMachine, { id, input: { id } });
}

const testWorkflowMachine = setup({
  types: {
    context: {} as { workflowId: string; status: string },
    events: {} as
      | { type: 'START'; workflowId: string }
      | { type: 'PAUSE' }
      | { type: 'RESUME' }
      | { type: 'STOP' },
  },
  actions: {
    updateStatus: ({ context, event }) => {
      if (event.type === 'START') {
        context.status = 'running';
        context.workflowId = event.workflowId;
      } else if (event.type === 'PAUSE') {
        context.status = 'paused';
      } else if (event.type === 'RESUME') {
        context.status = 'running';
      } else if (event.type === 'STOP') {
        context.status = 'stopped';
      }
    },
  },
}).createMachine({
  id: 'workflow-actor',
  initial: 'idle',
  context: { workflowId: 'test', status: 'idle' },
  states: {
    idle: {
      on: {
        START: {
          target: 'running',
          actions: ['updateStatus'],
        },
      },
    },
    running: {
      on: {
        PAUSE: {
          target: 'paused',
          actions: ['updateStatus'],
        },
        STOP: {
          target: 'stopped',
          actions: ['updateStatus'],
        },
      },
    },
    paused: {
      on: {
        RESUME: {
          target: 'running',
          actions: ['updateStatus'],
        },
        STOP: {
          target: 'stopped',
          actions: ['updateStatus'],
        },
      },
    },
    stopped: {
      type: 'final',
    },
  },
});

describe('Virtual Actor System', () => {
  let system: VirtualActorSystem;
  let config: VirtualActorSystemConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      nodeId: 'test-node',
      cacheSize: 10,
      evictionPolicy: 'lru',
      maxIdleTime: 1000,
      placementStrategy: new RoundRobinPlacementStrategy(),
      enableMigration: true,
      healthCheckInterval: 100,
    };
    system = new VirtualActorSystem(config);
  });

  describe('Actor Registration', () => {
    it('should register actor types', () => {
      expect(() => {
        system.registerActorType('user', testActorMachine);
      }).not.toThrow();
    });

    it('should throw error when getting unregistered actor type', () => {
      expect(() => {
        system.getActor('unknown', 'test-id');
      }).toThrow('Actor type not registered: unknown');
    });
  });

  describe('Actor Activation', () => {
    beforeEach(() => {
      system.registerActorType('user', testActorMachine);
      system.registerActorType('workflow', testWorkflowMachine);
    });

    it('should activate actor on first access', () => {
      const actor = system.getActor('user', 'user-123');
      expect(actor).toBeDefined();
      expect(actor.id).toBe('user-user-123');
    });

    it('should return cached actor on subsequent access', () => {
      const actor1 = system.getActor('user', 'user-123');
      const actor2 = system.getActor('user', 'user-123');

      expect(actor1).toBe(actor2);
    });

    it('should handle partitioned actors', () => {
      const actor1 = system.getActor('user', 'user-123', 'partition-1');
      const actor2 = system.getActor('user', 'user-123', 'partition-2');

      expect(actor1).toBeDefined();
      expect(actor2).toBeDefined();
      expect(actor1).not.toBe(actor2);
    });

    it('should activate different actor types independently', () => {
      const userActor = system.getActor('user', 'user-123');
      const workflowActor = system.getActor('workflow', 'workflow-456');

      expect(userActor).toBeDefined();
      expect(workflowActor).toBeDefined();
      expect(userActor.id).toBe('user-user-123');
      expect(workflowActor.id).toBe('workflow-workflow-456');
    });
  });

  describe('Actor Deactivation', () => {
    beforeEach(() => {
      system.registerActorType('user', testActorMachine);
    });

    it('should deactivate actor', async () => {
      const actor = system.getActor('user', 'user-123');
      expect(actor).toBeDefined();

      const virtualId: VirtualActorId = { type: 'user', id: 'user-123' };
      await system.deactivateActor(virtualId);

      // Should create new actor instance after deactivation
      const newActor = system.getActor('user', 'user-123');
      expect(newActor).toBeDefined();
      expect(newActor).not.toBe(actor);
    });

    it('should handle deactivation of non-existent actor', async () => {
      const virtualId: VirtualActorId = { type: 'user', id: 'non-existent' };
      await expect(system.deactivateActor(virtualId)).resolves.not.toThrow();
    });
  });

  describe('System Statistics', () => {
    beforeEach(() => {
      system.registerActorType('user', testActorMachine);
    });

    it('should provide system statistics', () => {
      // Activate some actors
      system.getActor('user', 'user-1');
      system.getActor('user', 'user-2');

      const stats = system.getStats();

      expect(stats).toMatchObject({
        directory: expect.objectContaining({
          hitCount: expect.any(Number),
          missCount: expect.any(Number),
          hitRate: expect.any(Number),
          cacheSize: expect.any(Number),
        }),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            nodeId: 'test-node',
            actorCount: expect.any(Number),
          }),
        ]),
        totalNodes: 1,
        registeredActorTypes: 1,
      });
    });
  });

  describe('Node Management', () => {
    beforeEach(() => {
      system.registerActorType('user', testActorMachine);
    });

    it('should add nodes to cluster', () => {
      system.addNode('node-2');

      const stats = system.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.nodes).toHaveLength(2);
    });

    it('should remove nodes from cluster', () => {
      system.addNode('node-2');
      system.removeNode('node-2');

      const stats = system.getStats();
      expect(stats.totalNodes).toBe(1);
      expect(stats.nodes).toHaveLength(1);
    });

    it('should not add duplicate nodes', () => {
      system.addNode('node-2');
      system.addNode('node-2');

      const stats = system.getStats();
      expect(stats.totalNodes).toBe(2);
    });
  });

  describe('Cleanup', () => {
    beforeEach(() => {
      system.registerActorType('user', testActorMachine);
    });

    it('should cleanup system resources', async () => {
      // Activate some actors
      system.getActor('user', 'user-1');
      system.getActor('user', 'user-2');

      await expect(system.cleanup()).resolves.not.toThrow();

      const stats = system.getStats();
      expect(stats.directory.cacheSize).toBe(0);
    });
  });
});

describe('ActorDirectory', () => {
  let directory: ActorDirectory;
  let config: VirtualActorSystemConfig;

  beforeEach(() => {
    config = {
      nodeId: 'test-node',
      cacheSize: 3,
      evictionPolicy: 'lru',
      maxIdleTime: 1000,
      placementStrategy: new RoundRobinPlacementStrategy(),
      enableMigration: true,
      healthCheckInterval: 100,
    };
    directory = new ActorDirectory(config);
  });

  it('should store and retrieve actor entries', () => {
    const virtualId: VirtualActorId = { type: 'user', id: 'user-123' };
    const entry: VirtualActorEntry = {
      virtualId,
      physicalRef: createTestActorRef('user-123'),
      node: 'test-node',
      lastAccessed: Date.now(),
      activationCount: 1,
      isActive: true,
    };

    directory.set(entry);
    const retrieved = directory.get(virtualId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.virtualId).toEqual(virtualId);
    expect(retrieved?.activationCount).toBe(2); // Should increment on access
  });

  it('should handle cache eviction with LRU policy', () => {
    const entries: VirtualActorEntry[] = [];

    // Create more entries than cache size
    for (let i = 0; i < 5; i++) {
      const virtualId: VirtualActorId = { type: 'user', id: `user-${i}` };
      const entry: VirtualActorEntry = {
        virtualId,
        physicalRef: createTestActorRef(`user-${i}`),
        node: 'test-node',
        lastAccessed: Date.now(),
        activationCount: 1,
        isActive: true,
      };
      entries.push(entry);
      directory.set(entry);
    }

    // First two entries should be evicted
    expect(directory.get(entries[0].virtualId)).toBeUndefined();
    expect(directory.get(entries[1].virtualId)).toBeUndefined();

    // Last three should still be present
    expect(directory.get(entries[2].virtualId)).toBeDefined();
    expect(directory.get(entries[3].virtualId)).toBeDefined();
    expect(directory.get(entries[4].virtualId)).toBeDefined();
  });

  it('should track cache statistics', () => {
    const virtualId: VirtualActorId = { type: 'user', id: 'user-123' };
    const entry: VirtualActorEntry = {
      virtualId,
      physicalRef: createTestActorRef('user-123'),
      node: 'test-node',
      lastAccessed: Date.now(),
      activationCount: 1,
      isActive: true,
    };

    // Miss
    directory.get(virtualId);

    // Hit
    directory.set(entry);
    directory.get(virtualId);

    const stats = directory.getStats();
    expect(stats.hitCount).toBe(1);
    expect(stats.missCount).toBe(1);
    expect(stats.hitRate).toBe(50);
  });

  it('should filter by node', () => {
    const entry1: VirtualActorEntry = {
      virtualId: { type: 'user', id: 'user-1' },
      physicalRef: createTestActorRef('user-1'),
      node: 'node-1',
      lastAccessed: Date.now(),
      activationCount: 1,
      isActive: true,
    };

    const entry2: VirtualActorEntry = {
      virtualId: { type: 'user', id: 'user-2' },
      physicalRef: createTestActorRef('user-2'),
      node: 'node-2',
      lastAccessed: Date.now(),
      activationCount: 1,
      isActive: true,
    };

    directory.set(entry1);
    directory.set(entry2);

    const node1Entries = directory.getByNode('node-1');
    const node2Entries = directory.getByNode('node-2');

    expect(node1Entries).toHaveLength(1);
    expect(node2Entries).toHaveLength(1);
    expect(node1Entries[0].virtualId.id).toBe('user-1');
    expect(node2Entries[0].virtualId.id).toBe('user-2');
  });

  it('should filter by actor type', () => {
    const userEntry: VirtualActorEntry = {
      virtualId: { type: 'user', id: 'user-1' },
      physicalRef: createTestActorRef('user-1'),
      node: 'node-1',
      lastAccessed: Date.now(),
      activationCount: 1,
      isActive: true,
    };

    const workflowEntry: VirtualActorEntry = {
      virtualId: { type: 'workflow', id: 'workflow-1' },
      physicalRef: createTestActorRef('workflow-1'),
      node: 'node-1',
      lastAccessed: Date.now(),
      activationCount: 1,
      isActive: true,
    };

    directory.set(userEntry);
    directory.set(workflowEntry);

    const userEntries = directory.getByType('user');
    const workflowEntries = directory.getByType('workflow');

    expect(userEntries).toHaveLength(1);
    expect(workflowEntries).toHaveLength(1);
    expect(userEntries[0].virtualId.type).toBe('user');
    expect(workflowEntries[0].virtualId.type).toBe('workflow');
  });

  it('should cleanup inactive actors', async () => {
    const virtualId: VirtualActorId = { type: 'user', id: 'user-123' };
    const entry: VirtualActorEntry = {
      virtualId,
      physicalRef: createTestActorRef('user-123'),
      node: 'test-node',
      lastAccessed: Date.now() - 2000, // 2 seconds ago (older than maxIdleTime)
      activationCount: 1,
      isActive: true,
    };

    directory.set(entry);

    // Don't call get() here as it updates lastAccessed
    const stats = directory.getStats();
    expect(stats.cacheSize).toBe(1);

    directory.cleanup();

    const statsAfterCleanup = directory.getStats();
    expect(statsAfterCleanup.cacheSize).toBe(0);
  });
});

describe('Placement Strategies', () => {
  const availableNodes = ['node-1', 'node-2', 'node-3'];
  const virtualId: VirtualActorId = { type: 'user', id: 'user-123' };

  describe('RoundRobinPlacementStrategy', () => {
    it('should distribute actors evenly across nodes', () => {
      const strategy = new RoundRobinPlacementStrategy();
      const selections: string[] = [];

      for (let i = 0; i < 6; i++) {
        const node = strategy.selectNode(virtualId, availableNodes);
        selections.push(node);
      }

      expect(selections).toEqual(['node-1', 'node-2', 'node-3', 'node-1', 'node-2', 'node-3']);
    });

    it('should suggest migration for unhealthy nodes', () => {
      const strategy = new RoundRobinPlacementStrategy();
      const entry: VirtualActorEntry = {
        virtualId,
        physicalRef: createTestActorRef('user-123'),
        node: 'node-1',
        lastAccessed: Date.now(),
        activationCount: 1,
        isActive: true,
      };

      const unhealthyMetrics: NodeMetrics = {
        nodeId: 'node-1',
        cpuUsage: 90,
        memoryUsage: 50,
        actorCount: 100,
        networkLatency: 10,
        isHealthy: false,
      };

      expect(strategy.shouldMigrate(entry, unhealthyMetrics)).toBe(true);
    });
  });

  describe('ConsistentHashPlacementStrategy', () => {
    it('should consistently place same actor on same node', () => {
      const strategy = new ConsistentHashPlacementStrategy();

      const node1 = strategy.selectNode(virtualId, availableNodes);
      const node2 = strategy.selectNode(virtualId, availableNodes);

      expect(node1).toBe(node2);
    });

    it('should distribute different actors across nodes', () => {
      const strategy = new ConsistentHashPlacementStrategy();
      const selections = new Set();

      for (let i = 0; i < 10; i++) {
        const testVirtualId: VirtualActorId = { type: 'user', id: `user-${i}` };
        const node = strategy.selectNode(testVirtualId, availableNodes);
        selections.add(node);
      }

      // Should use multiple nodes (not all on same node)
      expect(selections.size).toBeGreaterThan(1);
    });

    it('should be conservative about migration', () => {
      const strategy = new ConsistentHashPlacementStrategy();
      const entry: VirtualActorEntry = {
        virtualId,
        physicalRef: createTestActorRef('user-123'),
        node: 'node-1',
        lastAccessed: Date.now(),
        activationCount: 1,
        isActive: true,
      };

      const highLoadMetrics: NodeMetrics = {
        nodeId: 'node-1',
        cpuUsage: 85,
        memoryUsage: 85,
        actorCount: 1000,
        networkLatency: 50,
        isHealthy: true,
      };

      expect(strategy.shouldMigrate(entry, highLoadMetrics)).toBe(false);
    });
  });

  describe('LoadAwarePlacementStrategy', () => {
    it('should select first available node', () => {
      const strategy = new LoadAwarePlacementStrategy();

      const node = strategy.selectNode(virtualId, availableNodes);
      expect(node).toBe('node-1');
    });

    it('should migrate on high load', () => {
      const strategy = new LoadAwarePlacementStrategy();
      const entry: VirtualActorEntry = {
        virtualId,
        physicalRef: createTestActorRef('user-123'),
        node: 'node-1',
        lastAccessed: Date.now(),
        activationCount: 1,
        isActive: true,
      };

      const highLoadMetrics: NodeMetrics = {
        nodeId: 'node-1',
        cpuUsage: 75,
        memoryUsage: 75,
        actorCount: 1001,
        networkLatency: 10,
        isHealthy: true,
      };

      expect(strategy.shouldMigrate(entry, highLoadMetrics)).toBe(true);
    });
  });
});

describe('Factory Functions', () => {
  it('should create virtual actor system with default config', () => {
    const system = createVirtualActorSystem('test-node');
    expect(system).toBeInstanceOf(VirtualActorSystem);

    const stats = system.getStats();
    expect(stats.totalNodes).toBe(1);
    expect(stats.nodes[0].nodeId).toBe('test-node');
  });

  it('should create virtual actor system with consistent hash strategy', () => {
    const system = createConsistentHashVirtualActorSystem('test-node');
    expect(system).toBeInstanceOf(VirtualActorSystem);
  });

  it('should create virtual actor system with load-aware strategy', () => {
    const system = createLoadAwareVirtualActorSystem('test-node');
    expect(system).toBeInstanceOf(VirtualActorSystem);
  });

  it('should apply config overrides', () => {
    const system = createVirtualActorSystem('test-node', {
      cacheSize: 500,
      maxIdleTime: 10000,
    });

    expect(system).toBeInstanceOf(VirtualActorSystem);
    // Note: We can't directly test the internal config, but we can verify the system works
  });
});
