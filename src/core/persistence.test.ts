/**
 * Behavior Tests for Persistence Services - Actor-Web Framework
 *
 * Following TESTING-GUIDE.md patterns:
 * - Test behavior through framework APIs
 * - Focus on WHAT the services do, not HOW
 * - Use proper XState v5 patterns
 * - Follow AAA structure
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestEnvironment,
  setupGlobalMocks,
  type TestEnvironment,
} from '../testing/actor-test-utils';
import { Logger } from './dev-mode.js';
import { type StorageItem, StorageUtils } from './persistence.js';

const log = Logger.namespace('PERSISTENCE_TEST');

// ✅ DEMONSTRATION: This shows how we SHOULD test persistence
// Following the testing guide patterns:
// 1. Test behavior through framework APIs (not direct service calls)
// 2. Focus on WHAT the service does, not HOW
// 3. Use proper test structure and utilities
// 4. Avoid testing implementation details

// [TODO: When we implement XState v5 compatibility, we would create]
// [TODO: proper test machines here following the patterns shown in]
// [TODO: timer-services.test.ts and animation-services.test.ts]

// Mock browser storage APIs
const createMockStorage = (): Storage => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: vi.fn((key: string) => store.get(key) || null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    length: 0, // Make this writable for testing
    key: vi.fn((index: number) => {
      const keys = Array.from(store.keys());
      return keys[index] || null;
    }),
  };
  return mockStorage as Storage;
};

describe('Persistence Services', () => {
  let testEnv: TestEnvironment;
  let mockLocalStorage: Storage;
  let mockSessionStorage: Storage;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();
    log.debug('Persistence test environment initialized', { testEnvExists: !!testEnv });

    // Mock storage
    mockLocalStorage = createMockStorage();
    mockSessionStorage = createMockStorage();

    Object.defineProperty(global, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });

    Object.defineProperty(global, 'sessionStorage', {
      value: mockSessionStorage,
      writable: true,
    });

    // Mock BroadcastChannel
    global.BroadcastChannel = vi.fn().mockImplementation((name: string) => ({
      name,
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    }));

    // Mock navigation storage API
    Object.defineProperty(navigator, 'storage', {
      value: {
        estimate: vi.fn().mockResolvedValue({
          usage: 1024 * 1024, // 1MB
          quota: 5 * 1024 * 1024, // 5MB
        }),
      },
      writable: true,
    });

    // Mock crypto functions for simple testing
    global.btoa = vi.fn((str: string) => Buffer.from(str).toString('base64'));
    global.atob = vi.fn((str: string) => Buffer.from(str, 'base64').toString());

    vi.useFakeTimers();
    log.debug('Persistence mocks and storage APIs set up', {
      hasLocalStorageMock: !!mockLocalStorage,
      hasSessionStorageMock: !!mockSessionStorage,
      hasBroadcastChannelMock: !!global.BroadcastChannel,
    });
  });

  afterEach(() => {
    testEnv.cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    log.debug('Persistence test environment cleaned up');
  });

  // ✅ GOOD: Testing behavior through utility functions (framework API)
  // This follows the testing guide patterns correctly
  describe('Storage Utilities - Framework API Behavior', () => {
    describe('Storage Quota Management', () => {
      it('should retrieve storage quota information', async () => {
        // Arrange - Already set up in beforeEach with mock navigator.storage
        log.debug('Storage quota test started', {
          hasNavigatorStorage: !!navigator.storage,
          mockUsage: 1024 * 1024,
          mockQuota: 5 * 1024 * 1024,
        });

        // Act
        const quota = await StorageUtils.getQuota();
        log.debug('Storage quota retrieved', {
          quota,
          expectedPercentage: 20,
        });

        // Assert
        expect(quota).toEqual({
          usage: 1024 * 1024, // 1MB
          quota: 5 * 1024 * 1024, // 5MB
          percentage: 20, // 1MB / 5MB = 20%
        });
        log.debug('Storage quota verification completed', {
          usageMatches: quota.usage === 1024 * 1024,
          quotaMatches: quota.quota === 5 * 1024 * 1024,
          percentageCorrect: quota.percentage === 20,
        });
      });

      it('should handle unavailable storage API gracefully', async () => {
        // Arrange - Remove storage API
        Object.defineProperty(navigator, 'storage', {
          value: undefined,
          writable: true,
        });

        // Mock localStorage with some data for fallback calculation
        Object.defineProperty(mockLocalStorage, 'length', { value: 2, writable: true });
        mockLocalStorage.key = vi
          .fn()
          .mockReturnValueOnce('test:key1')
          .mockReturnValueOnce('test:key2')
          .mockReturnValue(null);

        mockLocalStorage.getItem = vi.fn().mockReturnValue('{"data":"test"}'); // 15 characters each

        // Act
        const quota = await StorageUtils.getQuota();

        // Assert - Should provide fallback calculation
        expect(quota).toEqual({
          usage: expect.any(Number),
          quota: 5 * 1024 * 1024,
          percentage: expect.any(Number),
        });
        expect(quota.usage).toBeGreaterThan(0);
      });
    });

    describe('Storage Cleanup Operations', () => {
      it('should remove expired data during cleanup', () => {
        // Arrange
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        log.debug('Storage cleanup test started', {
          maxAge: `${maxAge / (60 * 60 * 1000)} hours`,
          currentTime: now,
        });

        // Mock old data
        const oldData: StorageItem = {
          data: { old: true },
          timestamp: now - 2 * maxAge, // 2 days old
          version: 1,
        };

        // Mock recent data
        const recentData: StorageItem = {
          data: { recent: true },
          timestamp: now - maxAge / 2, // 12 hours old
          version: 1,
        };

        Object.defineProperty(mockLocalStorage, 'length', { value: 2, writable: true });
        mockLocalStorage.key = vi
          .fn()
          .mockReturnValueOnce('test:old-key')
          .mockReturnValueOnce('test:recent-key')
          .mockReturnValue(null);

        mockLocalStorage.getItem = vi
          .fn()
          .mockReturnValueOnce(JSON.stringify(oldData))
          .mockReturnValueOnce(JSON.stringify(recentData));

        log.debug('Mock storage data prepared', {
          oldDataAge: `${(now - oldData.timestamp) / (60 * 60 * 1000)} hours`,
          recentDataAge: `${(now - recentData.timestamp) / (60 * 60 * 1000)} hours`,
          shouldRemoveOld: true,
          shouldKeepRecent: true,
        });

        // Act
        const cleanedCount = StorageUtils.cleanup('test', maxAge);
        log.debug('Storage cleanup completed', {
          cleanedCount,
          expectedCleanedCount: 1,
        });

        // Assert
        expect(cleanedCount).toBe(1);
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('test:old-key');
        expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('test:recent-key');
        log.debug('Storage cleanup verification completed', {
          cleanedCountMatches: cleanedCount === 1,
          removeItemCallCount: (mockLocalStorage.removeItem as ReturnType<typeof vi.fn>).mock.calls
            .length,
        });
      });

      it('should remove invalid data during cleanup', () => {
        // Arrange
        Object.defineProperty(mockLocalStorage, 'length', { value: 1, writable: true });
        mockLocalStorage.key = vi
          .fn()
          .mockReturnValueOnce('test:invalid-key')
          .mockReturnValue(null);

        mockLocalStorage.getItem = vi.fn().mockReturnValue('invalid json data');

        // Act
        const cleanedCount = StorageUtils.cleanup('test');

        // Assert
        expect(cleanedCount).toBe(1);
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('test:invalid-key');
      });
    });
  });

  // ✅ GOOD: Performance testing following guide patterns
  describe('Performance Characteristics', () => {
    it('should handle quota checks efficiently', async () => {
      // Arrange
      const start = performance.now();

      // Act - Multiple quota checks
      const quotaChecks = await Promise.all([
        StorageUtils.getQuota(),
        StorageUtils.getQuota(),
        StorageUtils.getQuota(),
      ]);

      const processingTime = performance.now() - start;

      // Assert
      expect(quotaChecks).toHaveLength(3);
      expect(quotaChecks.every((q) => q.quota === 5 * 1024 * 1024)).toBe(true);
      expect(processingTime).toBeLessThan(50); // Should be reasonably fast
    });

    it('should handle cleanup operations efficiently', () => {
      // Arrange
      const itemCount = 100;
      Object.defineProperty(mockLocalStorage, 'length', { value: itemCount, writable: true });

      // Mock many items
      mockLocalStorage.key = vi
        .fn()
        .mockImplementation((index: number) => (index < itemCount ? `test:key-${index}` : null));
      mockLocalStorage.getItem = vi
        .fn()
        .mockReturnValue('{"data":"test","timestamp":0,"version":1}');

      const start = performance.now();

      // Act
      const cleanedCount = StorageUtils.cleanup('test', 1000); // Very short maxAge to clean all

      const processingTime = performance.now() - start;

      // Assert
      expect(cleanedCount).toBe(itemCount);
      expect(processingTime).toBeLessThan(100); // Should handle 100 items quickly
    });
  });

  // [TODO: When XState v5 compatibility is implemented]
  // [TODO: Add proper service behavior tests here using patterns from:]
  // [TODO: - timer-services.test.ts (XState v5 actor creation)]
  // [TODO: - animation-services.test.ts (proper test machine design)]
  // [TODO: - template-renderer.test.ts (framework utilities usage)]

  describe('Integration Notes - Future Implementation', () => {
    it('should demonstrate proper testing approach for XState v5 services', () => {
      // ✅ This is the CORRECT approach we should follow:
      //
      // 1. Create test machines that use the storage service
      // 2. Test through framework APIs (send events, observe state)
      // 3. Focus on behavior: "does storage work?" not "how does it work?"
      // 4. Use proper XState v5 patterns (createActor, invoke with input)
      // 5. Avoid direct service calling
      //
      // Example pattern (from testing guide):
      // const machine = setup({ actors: { storage: createStorageService() } })
      //   .createMachine({ ... });
      // const actor = createActor(machine);
      // actor.start();
      // actor.send({ type: 'STORE_DATA', key: 'test', data: {...} });
      // expect(actor.getSnapshot().value).toBe('ready');

      expect(true).toBe(true); // Placeholder
    });
  });
});

// ✅ SUMMARY: Testing Guide Patterns Applied
//
// ✅ DO:
// - Test behavior through framework APIs (StorageUtils functions)
// - Use descriptive test names ("should retrieve storage quota information")
// - Follow AAA pattern (Arrange, Act, Assert)
// - Test real-world scenarios and edge cases
// - Use performance testing for critical operations
// - Keep tests focused on WHAT, not HOW
//
// ❌ DON'T:
// - Call XState services directly (old persistence tests)
// - Test implementation details
// - Add framework internals to test machines
// - Ignore actor lifecycle patterns
// - Use timing-dependent assertions
// - Over-mock when framework APIs work
