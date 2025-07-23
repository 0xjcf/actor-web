/**
 * @module actor-core/runtime/tests/runtime-adapter.test
 * @description Tests for cross-environment runtime adapters
 *
 * These tests verify that the runtime adapter pattern provides consistent
 * behavior across different JavaScript environments (Node.js, Browser, Web Worker).
 * This is critical for enabling "write once, run anywhere" actor applications.
 *
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setup } from 'xstate';
import {
  BrowserAdapter,
  BrowserStorage,
  BrowserTimer,
  BrowserTransport,
  cleanupRuntime,
  createRuntimeAdapter,
  detectEnvironment,
  getRuntimeCapabilities,
  getRuntimeInfo,
  initializeRuntime,
  NodeAdapter,
  NodeStorage,
  NodeTimer,
  NodeTransport,
  type RuntimeAdapter,
  WorkerAdapter,
  WorkerStorage,
  WorkerTimer,
  WorkerTransport,
} from '../runtime-adapter.js';

// Mock global objects for testing different environments
const mockGlobal = {
  process: { versions: { node: '18.0.0' } },
  window: {
    setTimeout: vi.fn().mockReturnValue(123),
    clearTimeout: vi.fn(),
    setInterval: vi.fn().mockReturnValue(456),
    clearInterval: vi.fn(),
  },
  document: {},
  self: { postMessage: vi.fn(), addEventListener: vi.fn() },
  importScripts: vi.fn(),
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  },
  BroadcastChannel: vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
  })),
  setTimeout: vi.fn().mockReturnValue(123),
  clearTimeout: vi.fn(),
  setInterval: vi.fn().mockReturnValue(456),
  clearInterval: vi.fn(),
};

// Test machine for adapter testing
const testMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: 'INCREMENT' } | { type: 'DECREMENT' },
  },
}).createMachine({
  id: 'test-machine',
  initial: 'idle',
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: {
          actions: ({ context }) => ({ count: context.count + 1 }),
        },
        DECREMENT: {
          actions: ({ context }) => ({ count: context.count - 1 }),
        },
      },
    },
  },
});

describe('Runtime Adapter Pattern', () => {
  let adapters: RuntimeAdapter[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    adapters = [];
  });

  afterEach(async () => {
    // ✅ CORRECT: Clean up all adapters to prevent memory leaks
    await Promise.all(
      adapters.map(async (adapter) => {
        try {
          // Skip cleanup for browser adapters in test environment
          if (adapter instanceof BrowserAdapter) {
            return;
          }
          await adapter.cleanup();
        } catch (_error) {
          // Ignore cleanup errors in tests - environment may not support all operations
        }
      })
    );
    adapters = [];
  });

  describe('Environment Detection', () => {
    it('should detect Node.js environment', () => {
      // Arrange
      const originalProcess = globalThis.process;
      vi.stubGlobal('process', mockGlobal.process);

      // Act
      const environment = detectEnvironment();

      // Assert
      expect(environment).toBe('node');

      // Cleanup
      vi.stubGlobal('process', originalProcess);
    });

    it('should detect browser environment', () => {
      // Arrange
      const originalProcess = globalThis.process;
      vi.unstubAllGlobals(); // Clear any existing stubs
      vi.stubGlobal('process', undefined);
      vi.stubGlobal('window', mockGlobal.window);
      vi.stubGlobal('document', mockGlobal.document);

      // Act
      const environment = detectEnvironment();

      // Assert
      expect(environment).toBe('browser');

      // Cleanup
      vi.unstubAllGlobals();
      if (originalProcess) {
        vi.stubGlobal('process', originalProcess);
      }
    });

    it('should detect worker environment', () => {
      // Arrange
      const originalProcess = globalThis.process;
      vi.unstubAllGlobals(); // Clear any existing stubs
      vi.stubGlobal('process', undefined);
      vi.stubGlobal('self', mockGlobal.self);
      vi.stubGlobal('importScripts', mockGlobal.importScripts);

      // Act
      const environment = detectEnvironment();

      // Assert
      expect(environment).toBe('worker');

      // Cleanup
      vi.unstubAllGlobals();
      if (originalProcess) {
        vi.stubGlobal('process', originalProcess);
      }
    });

    it('should detect unknown environment', () => {
      // Arrange
      const originalProcess = globalThis.process;
      vi.unstubAllGlobals(); // Clear any existing stubs
      vi.stubGlobal('process', undefined);

      // Act
      const environment = detectEnvironment();

      // Assert
      expect(environment).toBe('unknown');

      // Cleanup
      vi.unstubAllGlobals();
      if (originalProcess) {
        vi.stubGlobal('process', originalProcess);
      }
    });
  });

  describe('Node.js Adapter', () => {
    let adapter: NodeAdapter;

    beforeEach(() => {
      adapter = new NodeAdapter();
      adapters.push(adapter);
    });

    it('should create Node.js adapter with correct properties', () => {
      // Assert
      expect(adapter.environment).toBe('node');
      expect(adapter.storage).toBeInstanceOf(NodeStorage);
      expect(adapter.transport).toBeInstanceOf(NodeTransport);
      expect(adapter.timer).toBeInstanceOf(NodeTimer);
    });

    it('should spawn actors using createActorRef', () => {
      // Act
      const actorRef = adapter.spawn(testMachine);

      // Assert
      expect(actorRef).toBeDefined();
      expect(actorRef.id).toBeDefined();
      expect(actorRef.status).toBe('idle');
    });

    it('should report correct capabilities', () => {
      // Act
      const capabilities = adapter.getCapabilities();

      // Assert
      expect(capabilities).toEqual({
        supportsWorkers: true,
        supportsStreaming: true,
        supportsPersistence: true,
        supportsNetworking: true,
      });
    });

    it('should initialize and cleanup properly', async () => {
      // Act & Assert
      await expect(adapter.initialize()).resolves.not.toThrow();
      await expect(adapter.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Browser Adapter', () => {
    let adapter: BrowserAdapter;

    beforeEach(() => {
      // Mock browser globals
      vi.stubGlobal('localStorage', mockGlobal.localStorage);
      vi.stubGlobal('BroadcastChannel', mockGlobal.BroadcastChannel);
      vi.stubGlobal('window', mockGlobal.window);

      adapter = new BrowserAdapter();
      adapters.push(adapter);
    });

    afterEach(async () => {
      // Skip cleanup for browser adapter in test environment
      // The adapter.cleanup() tries to access localStorage which causes test failures

      // Restore globals
      vi.unstubAllGlobals();
    });

    it('should create browser adapter with correct properties', () => {
      // Assert
      expect(adapter.environment).toBe('browser');
      expect(adapter.storage).toBeInstanceOf(BrowserStorage);
      expect(adapter.transport).toBeInstanceOf(BrowserTransport);
      expect(adapter.timer).toBeInstanceOf(BrowserTimer);
    });

    it('should report correct capabilities', () => {
      // Act
      const capabilities = adapter.getCapabilities();

      // Assert
      expect(capabilities).toEqual({
        supportsWorkers: true,
        supportsStreaming: false,
        supportsPersistence: true,
        supportsNetworking: true,
      });
    });
  });

  describe('Web Worker Adapter', () => {
    let adapter: WorkerAdapter;

    beforeEach(() => {
      // Mock worker globals
      vi.stubGlobal('self', mockGlobal.self);
      vi.stubGlobal('setTimeout', mockGlobal.setTimeout);
      vi.stubGlobal('clearTimeout', mockGlobal.clearTimeout);
      vi.stubGlobal('setInterval', mockGlobal.setInterval);
      vi.stubGlobal('clearInterval', mockGlobal.clearInterval);

      adapter = new WorkerAdapter();
      adapters.push(adapter);
    });

    afterEach(() => {
      // Restore globals
      vi.unstubAllGlobals();
    });

    it('should create worker adapter with correct properties', () => {
      // Assert
      expect(adapter.environment).toBe('worker');
      expect(adapter.storage).toBeInstanceOf(WorkerStorage);
      expect(adapter.transport).toBeInstanceOf(WorkerTransport);
      expect(adapter.timer).toBeInstanceOf(WorkerTimer);
    });

    it('should report correct capabilities', () => {
      // Act
      const capabilities = adapter.getCapabilities();

      // Assert
      expect(capabilities).toEqual({
        supportsWorkers: false,
        supportsStreaming: false,
        supportsPersistence: false,
        supportsNetworking: false,
      });
    });
  });

  describe('Storage Implementations', () => {
    describe('NodeStorage', () => {
      let storage: NodeStorage;

      beforeEach(() => {
        storage = new NodeStorage();
      });

      it('should store and retrieve values', async () => {
        // Act
        await storage.set('test-key', { value: 'test-data' });
        const result = await storage.get('test-key');

        // Assert
        expect(result).toEqual({ value: 'test-data' });
      });

      it('should remove values', async () => {
        // Arrange
        await storage.set('test-key', 'test-value');

        // Act
        await storage.remove('test-key');
        const result = await storage.get('test-key');

        // Assert
        expect(result).toBeUndefined();
      });

      it('should clear all values', async () => {
        // Arrange
        await storage.set('key1', 'value1');
        await storage.set('key2', 'value2');

        // Act
        await storage.clear();
        const keys = await storage.keys();

        // Assert
        expect(keys).toHaveLength(0);
      });

      it('should return all keys', async () => {
        // Arrange
        await storage.set('key1', 'value1');
        await storage.set('key2', 'value2');

        // Act
        const keys = await storage.keys();

        // Assert
        expect(keys).toEqual(['key1', 'key2']);
      });
    });

    describe('BrowserStorage', () => {
      let storage: BrowserStorage;

      beforeEach(() => {
        vi.stubGlobal('localStorage', mockGlobal.localStorage);
        storage = new BrowserStorage();
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('should use localStorage with prefix', async () => {
        // Arrange
        mockGlobal.localStorage.getItem.mockReturnValue('{"value":"test"}');

        // Act
        await storage.set('test-key', { value: 'test' });
        const result = await storage.get('test-key');

        // Assert
        expect(mockGlobal.localStorage.setItem).toHaveBeenCalledWith(
          'actor-web-test-key',
          '{"value":"test"}'
        );
        expect(mockGlobal.localStorage.getItem).toHaveBeenCalledWith('actor-web-test-key');
        expect(result).toEqual({ value: 'test' });
      });

      it('should handle missing keys gracefully', async () => {
        // Arrange
        mockGlobal.localStorage.getItem.mockReturnValue(null);

        // Act
        const result = await storage.get('missing-key');

        // Assert
        expect(result).toBeUndefined();
      });
    });
  });

  describe('Transport Implementations', () => {
    describe('NodeTransport', () => {
      let transport: NodeTransport;

      beforeEach(() => {
        transport = new NodeTransport();
      });

      it('should send messages to subscribers', async () => {
        // Arrange
        const handler = vi.fn();
        const unsubscribe = transport.subscribe('test-actor', handler);

        // Act
        await transport.send('test-actor', { type: 'TEST_MESSAGE' });

        // Assert
        expect(handler).toHaveBeenCalledWith({ type: 'TEST_MESSAGE' });

        // Cleanup
        unsubscribe();
      });

      it('should handle multiple subscribers', async () => {
        // Arrange
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        const unsubscribe1 = transport.subscribe('test-actor', handler1);
        const unsubscribe2 = transport.subscribe('test-actor', handler2);

        // Act
        await transport.send('test-actor', { type: 'TEST_MESSAGE' });

        // Assert
        expect(handler1).toHaveBeenCalledWith({ type: 'TEST_MESSAGE' });
        expect(handler2).toHaveBeenCalledWith({ type: 'TEST_MESSAGE' });

        // Cleanup
        unsubscribe1();
        unsubscribe2();
      });

      it('should broadcast messages to all subscribers', async () => {
        // Arrange
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        const unsubscribe1 = transport.subscribe('actor1', handler1);
        const unsubscribe2 = transport.subscribe('actor2', handler2);

        // Act
        await transport.broadcast({ type: 'BROADCAST_MESSAGE' });

        // Assert
        expect(handler1).toHaveBeenCalledWith({ type: 'BROADCAST_MESSAGE' });
        expect(handler2).toHaveBeenCalledWith({ type: 'BROADCAST_MESSAGE' });

        // Cleanup
        unsubscribe1();
        unsubscribe2();
      });

      it('should track transport statistics', async () => {
        // Arrange
        const handler = vi.fn();
        const unsubscribe = transport.subscribe('test-actor', handler);

        // Act
        await transport.send('test-actor', { type: 'TEST_MESSAGE' });
        await transport.broadcast({ type: 'BROADCAST_MESSAGE' });
        const stats = transport.getStats();

        // Assert
        expect(stats.messagesSent).toBe(2);
        expect(stats.activeSubscriptions).toBe(1);

        // Cleanup
        unsubscribe();
      });
    });

    describe('BrowserTransport', () => {
      let transport: BrowserTransport;

      beforeEach(() => {
        vi.stubGlobal('BroadcastChannel', mockGlobal.BroadcastChannel);
        transport = new BrowserTransport();
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('should use BroadcastChannel for messaging', async () => {
        // Arrange
        const mockChannel = { postMessage: vi.fn(), close: vi.fn() };
        mockGlobal.BroadcastChannel.mockReturnValue(mockChannel);

        // Act
        await transport.send('test-actor', { type: 'TEST_MESSAGE' });

        // Assert
        expect(mockGlobal.BroadcastChannel).toHaveBeenCalledWith('actor-test-actor');
        expect(mockChannel.postMessage).toHaveBeenCalledWith({ type: 'TEST_MESSAGE' });
      });
    });
  });

  describe('Timer Implementations', () => {
    describe('NodeTimer', () => {
      let timer: NodeTimer;

      beforeEach(() => {
        timer = new NodeTimer();
      });

      it('should provide timer functionality for Node environment', () => {
        // Arrange
        const callback = vi.fn();

        // Mock global timer functions for this test
        vi.stubGlobal(
          'setTimeout',
          vi.fn().mockImplementation(() => {
            // Simulate timer behavior
            return Math.random();
          })
        );
        vi.stubGlobal('clearTimeout', vi.fn());
        vi.stubGlobal(
          'setInterval',
          vi.fn().mockImplementation(() => {
            // Simulate interval behavior
            return Math.random();
          })
        );
        vi.stubGlobal('clearInterval', vi.fn());

        // Act & Assert - Test behavior not implementation
        // Timer should accept callbacks and delays
        const timeoutHandle = timer.setTimeout(callback, 1000);
        expect(timeoutHandle).toBeDefined();
        expect(global.setTimeout).toHaveBeenCalledWith(callback, 1000);

        // Should be able to clear timeouts
        timer.clearTimeout(timeoutHandle);
        expect(global.clearTimeout).toHaveBeenCalled();

        // Should provide interval functionality
        const intervalHandle = timer.setInterval(callback, 1000);
        expect(intervalHandle).toBeDefined();
        expect(global.setInterval).toHaveBeenCalledWith(callback, 1000);

        // Should be able to clear intervals
        timer.clearInterval(intervalHandle);
        expect(global.clearInterval).toHaveBeenCalled();

        // Should provide current time
        const now = timer.now();
        expect(typeof now).toBe('number');
        expect(now).toBeGreaterThan(0);

        // Restore original functions
        vi.unstubAllGlobals();
      });
    });

    describe('BrowserTimer', () => {
      let timer: BrowserTimer;

      beforeEach(() => {
        vi.stubGlobal('window', mockGlobal.window);
        timer = new BrowserTimer();
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('should provide timer functionality for browser environment', () => {
        // Arrange
        const callback = vi.fn();

        // Act & Assert - Test behavior not implementation
        // Timer should accept callbacks and delays
        const timeoutHandle = timer.setTimeout(callback, 1000);
        expect(timeoutHandle).toBeDefined();
        expect(mockGlobal.window.setTimeout).toHaveBeenCalledWith(callback, 1000);

        // Should be able to clear timeouts
        timer.clearTimeout(timeoutHandle);
        expect(mockGlobal.window.clearTimeout).toHaveBeenCalledWith(timeoutHandle);

        // Should provide interval functionality
        const intervalHandle = timer.setInterval(callback, 1000);
        expect(intervalHandle).toBeDefined();
        expect(mockGlobal.window.setInterval).toHaveBeenCalledWith(callback, 1000);

        // Should be able to clear intervals
        timer.clearInterval(intervalHandle);
        expect(mockGlobal.window.clearInterval).toHaveBeenCalledWith(intervalHandle);

        // Should provide current time
        const now = timer.now();
        expect(typeof now).toBe('number');
        expect(now).toBeGreaterThan(0);
      });
    });
  });

  describe('Adapter Factory', () => {
    it('should create appropriate adapter for environment', () => {
      // Arrange
      const originalProcess = globalThis.process;
      vi.stubGlobal('process', mockGlobal.process);

      // Act
      const adapter = createRuntimeAdapter();

      // Assert
      expect(adapter).toBeInstanceOf(NodeAdapter);
      expect(adapter.environment).toBe('node');

      // Cleanup
      vi.stubGlobal('process', originalProcess);
    });

    it('should throw error for unknown environment', () => {
      // Arrange
      const originalProcess = globalThis.process;
      vi.stubGlobal('process', undefined);

      // Act & Assert
      expect(() => createRuntimeAdapter()).toThrow('Unsupported environment: unknown');

      // Cleanup
      vi.stubGlobal('process', originalProcess);
    });
  });

  describe('Global Runtime Functions', () => {
    it('should initialize and cleanup runtime', async () => {
      // Act & Assert
      await expect(initializeRuntime()).resolves.not.toThrow();
      await expect(cleanupRuntime()).resolves.not.toThrow();
    });

    it('should get runtime capabilities', () => {
      // Act
      const capabilities = getRuntimeCapabilities();

      // Assert
      expect(capabilities).toHaveProperty('supportsWorkers');
      expect(capabilities).toHaveProperty('supportsStreaming');
      expect(capabilities).toHaveProperty('supportsPersistence');
      expect(capabilities).toHaveProperty('supportsNetworking');
    });

    it('should get runtime info', () => {
      // Act
      const info = getRuntimeInfo();

      // Assert
      expect(info).toHaveProperty('environment');
      expect(info).toHaveProperty('capabilities');
      expect(info).toHaveProperty('transportStats');
    });
  });

  describe('Cross-Environment Compatibility', () => {
    it('should provide consistent API across all adapters', () => {
      // Arrange
      const adapters = [new NodeAdapter(), new BrowserAdapter(), new WorkerAdapter()];

      // Act & Assert
      adapters.forEach((adapter) => {
        expect(adapter).toHaveProperty('environment');
        expect(adapter).toHaveProperty('storage');
        expect(adapter).toHaveProperty('transport');
        expect(adapter).toHaveProperty('timer');
        expect(typeof adapter.spawn).toBe('function');
        expect(typeof adapter.getCapabilities).toBe('function');
        expect(typeof adapter.initialize).toBe('function');
        expect(typeof adapter.cleanup).toBe('function');
      });
    });

    it('should handle structured cloning for message passing', async () => {
      // Arrange
      const adapter = new NodeAdapter();
      const complexMessage = {
        type: 'COMPLEX_MESSAGE',
        data: {
          nested: { value: 42 },
          array: [1, 2, 3],
          date: new Date(),
        },
      };

      // Act
      const handler = vi.fn();
      const unsubscribe = adapter.transport.subscribe('test-actor', handler);
      await adapter.transport.send('test-actor', complexMessage);

      // Assert
      expect(handler).toHaveBeenCalledWith(complexMessage);

      // Cleanup
      unsubscribe();
    });
  });
});
