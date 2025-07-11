/**
 * State Persistence Utilities - XState-based data storage and synchronization
 *
 * Provides localStorage/sessionStorage integration with state versioning,
 * cross-tab synchronization, privacy-aware storage, and automatic serialization.
 *
 * Part of Phase 0.7 Reactive Infrastructure
 */

import type { AnyEventObject } from 'xstate';
import { createActor, fromCallback, fromPromise, setup } from 'xstate';

// ===== TYPE DEFINITIONS =====

export interface PersistenceConfig {
  /** Storage key prefix */
  keyPrefix?: string;
  /** Storage type */
  storageType?: 'localStorage' | 'sessionStorage';
  /** Data version for migrations */
  version?: number;
  /** Enable cross-tab synchronization */
  enableSync?: boolean;
  /** Enable encryption (requires crypto key) */
  enableEncryption?: boolean;
  /** Encryption key for sensitive data */
  encryptionKey?: string;
  /** Maximum age of data in milliseconds */
  maxAge?: number;
  /** Compression enabled */
  enableCompression?: boolean;
}

export interface StorageItem<T = unknown> {
  /** The actual data */
  data: T;
  /** Timestamp when stored */
  timestamp: number;
  /** Data version */
  version: number;
  /** Expiration timestamp (optional) */
  expiresAt?: number;
  /** Data checksum for integrity verification */
  checksum?: string;
}

export interface MigrationFunction<T = unknown> {
  /** Source version */
  fromVersion: number;
  /** Target version */
  toVersion: number;
  /** Migration transformation function */
  migrate: (data: unknown) => T;
}

export interface SyncEvent {
  /** Storage key that changed */
  key: string;
  /** New value (null if deleted) */
  newValue: string | null;
  /** Old value */
  oldValue: string | null;
  /** Source tab/window identifier */
  source: string;
}

export interface PersistenceContext {
  /** Current storage configuration */
  config: PersistenceConfig;
  /** Active storage listeners */
  listeners: Map<string, (event: SyncEvent) => void>;
  /** Migration functions */
  migrations: Map<string, MigrationFunction[]>;
  /** Tab identifier for sync */
  tabId: string;
}

// ===== STORAGE SERVICE =====

/**
 * Create a storage service for state machines
 * Handles get/set operations with versioning and migrations
 *
 * @example
 * ```typescript
 * const storageService = createStorageService();
 *
 * const machine = setup({
 *   actors: { storage: storageService }
 * }).createMachine({
 *   states: {
 *     saving: {
 *       invoke: {
 *         src: 'storage',
 *         input: {
 *           operation: 'SET',
 *           key: 'user-preferences',
 *           data: { theme: 'dark', language: 'en' },
 *           config: { storageType: 'localStorage', version: 1 }
 *         }
 *       },
 *       on: {
 *         STORAGE_SUCCESS: 'idle',
 *         STORAGE_ERROR: 'error'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createStorageService = () => {
  return fromCallback<
    AnyEventObject,
    {
      operation: 'GET' | 'SET' | 'DELETE' | 'CLEAR';
      key?: string;
      data?: unknown;
      config?: PersistenceConfig;
      migrations?: MigrationFunction[];
    }
  >(({ sendBack, input, receive }) => {
    const { operation, key, data, config = {}, migrations = [] } = input;

    const {
      keyPrefix = 'app',
      storageType = 'localStorage',
      version = 1,
      enableEncryption = false,
      encryptionKey,
      maxAge,
      enableCompression = false,
    } = config;

    const storage = storageType === 'localStorage' ? localStorage : sessionStorage;
    const fullKey = `${keyPrefix}:${key}`;

    // Helper functions
    const generateChecksum = (data: string): string => {
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash.toString(16);
    };

    const encrypt = (data: string, key: string): string => {
      // Simple XOR encryption (in production, use proper crypto)
      let encrypted = '';
      for (let i = 0; i < data.length; i++) {
        encrypted += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      return btoa(encrypted);
    };

    const decrypt = (encryptedData: string, key: string): string => {
      const data = atob(encryptedData);
      let decrypted = '';
      for (let i = 0; i < data.length; i++) {
        decrypted += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      return decrypted;
    };

    const compress = (data: string): string => {
      // Simple compression using JSON minification and common replacements
      return data
        .replace(/\s+/g, ' ')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/:\s+/g, ':');
    };

    const decompress = (data: string): string => {
      // Decompression would reverse the compression (for demo purposes, return as-is)
      return data;
    };

    const runMigrations = (storedData: StorageItem, targetVersion: number): unknown => {
      let currentData = storedData.data;
      let currentVersion = storedData.version;

      const applicableMigrations = migrations
        .filter((m) => m.fromVersion >= currentVersion && m.toVersion <= targetVersion)
        .sort((a, b) => a.fromVersion - b.fromVersion);

      for (const migration of applicableMigrations) {
        if (currentVersion === migration.fromVersion) {
          currentData = migration.migrate(currentData);
          currentVersion = migration.toVersion;
        }
      }

      return currentData;
    };

    // Execute operation
    try {
      switch (operation) {
        case 'GET': {
          if (!key) {
            sendBack({ type: 'STORAGE_ERROR', error: 'Key is required for GET operation' });
            return;
          }

          const rawValue = storage.getItem(fullKey);
          if (!rawValue) {
            sendBack({ type: 'STORAGE_SUCCESS', operation: 'GET', key, data: null });
            return;
          }

          let parsedValue: StorageItem;
          try {
            let processedValue = rawValue;

            // Decrypt if encryption is enabled
            if (enableEncryption && encryptionKey) {
              processedValue = decrypt(processedValue, encryptionKey);
            }

            // Decompress if compression is enabled
            if (enableCompression) {
              processedValue = decompress(processedValue);
            }

            parsedValue = JSON.parse(processedValue);
          } catch (error) {
            sendBack({
              type: 'STORAGE_ERROR',
              error: 'Failed to parse stored data',
              details: error,
            });
            return;
          }

          // Check expiration
          if (parsedValue.expiresAt && Date.now() > parsedValue.expiresAt) {
            storage.removeItem(fullKey);
            sendBack({ type: 'STORAGE_SUCCESS', operation: 'GET', key, data: null, expired: true });
            return;
          }

          // Verify checksum if available
          if (parsedValue.checksum) {
            const dataString = JSON.stringify(parsedValue.data);
            const expectedChecksum = generateChecksum(dataString);
            if (parsedValue.checksum !== expectedChecksum) {
              sendBack({ type: 'STORAGE_ERROR', error: 'Data integrity check failed' });
              return;
            }
          }

          // Run migrations if needed
          let finalData = parsedValue.data;
          if (parsedValue.version < version && migrations.length > 0) {
            try {
              finalData = runMigrations(parsedValue, version);

              // Update stored data with migrated version
              const updatedItem: StorageItem = {
                ...parsedValue,
                data: finalData,
                version,
                timestamp: Date.now(),
              };

              const serialized = JSON.stringify(updatedItem);
              storage.setItem(fullKey, serialized);

              sendBack({
                type: 'STORAGE_SUCCESS',
                operation: 'GET',
                key,
                data: finalData,
                migrated: true,
                fromVersion: parsedValue.version,
                toVersion: version,
              });
            } catch (migrationError) {
              sendBack({
                type: 'STORAGE_ERROR',
                error: 'Migration failed',
                details: migrationError,
              });
            }
          } else {
            sendBack({ type: 'STORAGE_SUCCESS', operation: 'GET', key, data: finalData });
          }
          break;
        }

        case 'SET': {
          if (!key || data === undefined) {
            sendBack({
              type: 'STORAGE_ERROR',
              error: 'Key and data are required for SET operation',
            });
            return;
          }

          const item: StorageItem = {
            data,
            timestamp: Date.now(),
            version,
            expiresAt: maxAge ? Date.now() + maxAge : undefined,
            checksum: generateChecksum(JSON.stringify(data)),
          };

          let serialized = JSON.stringify(item);

          // Compress if enabled
          if (enableCompression) {
            serialized = compress(serialized);
          }

          // Encrypt if enabled
          if (enableEncryption && encryptionKey) {
            serialized = encrypt(serialized, encryptionKey);
          }

          storage.setItem(fullKey, serialized);

          sendBack({
            type: 'STORAGE_SUCCESS',
            operation: 'SET',
            key,
            data,
            size: serialized.length,
          });
          break;
        }

        case 'DELETE': {
          if (!key) {
            sendBack({ type: 'STORAGE_ERROR', error: 'Key is required for DELETE operation' });
            return;
          }

          const existed = storage.getItem(fullKey) !== null;
          storage.removeItem(fullKey);

          sendBack({
            type: 'STORAGE_SUCCESS',
            operation: 'DELETE',
            key,
            existed,
          });
          break;
        }

        case 'CLEAR': {
          const keysToRemove: string[] = [];
          for (let i = 0; i < storage.length; i++) {
            const storageKey = storage.key(i);
            if (storageKey?.startsWith(`${keyPrefix}:`)) {
              keysToRemove.push(storageKey);
            }
          }

          for (const storageKey of keysToRemove) {
            storage.removeItem(storageKey);
          }

          sendBack({
            type: 'STORAGE_SUCCESS',
            operation: 'CLEAR',
            clearedCount: keysToRemove.length,
          });
          break;
        }

        default:
          sendBack({ type: 'STORAGE_ERROR', error: `Unknown operation: ${operation}` });
      }
    } catch (error) {
      sendBack({ type: 'STORAGE_ERROR', error: 'Storage operation failed', details: error });
    }

    // Handle external events
    receive((event) => {
      if (event.type === 'CANCEL') {
        sendBack({ type: 'STORAGE_CANCELLED' });
      }
    });

    // No cleanup needed for synchronous storage operations
    return () => {};
  });
};

// ===== SYNC SERVICE =====

/**
 * Create a cross-tab synchronization service
 * Syncs storage changes across browser tabs/windows
 *
 * @example
 * ```typescript
 * const syncService = createSyncService();
 *
 * const machine = setup({
 *   actors: { sync: syncService }
 * }).createMachine({
 *   states: {
 *     syncing: {
 *       invoke: {
 *         src: 'sync',
 *         input: {
 *           keyPrefix: 'app',
 *           storageType: 'localStorage'
 *         }
 *       },
 *       on: {
 *         STORAGE_CHANGED: { actions: 'handleRemoteChange' },
 *         SYNC_CONNECTED: { actions: 'onSyncReady' }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createSyncService = () => {
  return fromCallback<
    AnyEventObject,
    {
      keyPrefix?: string;
      storageType?: 'localStorage' | 'sessionStorage';
    }
  >(({ sendBack, input, receive }) => {
    const { keyPrefix = 'app', storageType = 'localStorage' } = input;
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Only localStorage supports cross-tab sync
    if (storageType !== 'localStorage') {
      sendBack({ type: 'SYNC_ERROR', error: 'Cross-tab sync only available with localStorage' });
      return;
    }

    // Storage event handler
    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith(`${keyPrefix}:`)) {
        return;
      }

      const syncEvent: SyncEvent = {
        key: e.key.replace(`${keyPrefix}:`, ''),
        newValue: e.newValue,
        oldValue: e.oldValue,
        source: 'external',
      };

      sendBack({
        type: 'STORAGE_CHANGED',
        ...syncEvent,
      });
    };

    // Broadcast channel for enhanced sync (if supported)
    let broadcastChannel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel(`${keyPrefix}-sync`);

      broadcastChannel.addEventListener('message', (event) => {
        if (event.data.tabId !== tabId) {
          sendBack({
            type: 'SYNC_MESSAGE',
            data: event.data,
            source: event.data.tabId,
          });
        }
      });
    }

    // Set up storage listener
    window.addEventListener('storage', handleStorageChange);

    // Announce this tab's presence
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'TAB_CONNECTED',
        tabId,
        timestamp: Date.now(),
      });
    }

    sendBack({
      type: 'SYNC_CONNECTED',
      tabId,
      supportsBroadcast: !!broadcastChannel,
    });

    // Handle external events for broadcasting
    receive((event) => {
      if (event.type === 'BROADCAST' && broadcastChannel) {
        const { data } = event as { type: 'BROADCAST'; data: unknown };
        const message = typeof data === 'object' && data !== null ? data : { value: data };
        broadcastChannel.postMessage({
          ...message,
          tabId,
          timestamp: Date.now(),
        });
      } else if (event.type === 'DISCONNECT') {
        if (broadcastChannel) {
          broadcastChannel.postMessage({
            type: 'TAB_DISCONNECTED',
            tabId,
            timestamp: Date.now(),
          });
        }
        sendBack({ type: 'SYNC_DISCONNECTED' });
      }
    });

    // Cleanup function
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'TAB_DISCONNECTED',
          tabId,
          timestamp: Date.now(),
        });
        broadcastChannel.close();
      }
    };
  });
};

// ===== BATCH OPERATIONS SERVICE =====

/**
 * Create a batch operations service for efficient bulk storage operations
 *
 * @example
 * ```typescript
 * const batchService = createBatchService();
 *
 * const machine = setup({
 *   actors: { batch: batchService }
 * }).createMachine({
 *   states: {
 *     batching: {
 *       invoke: {
 *         src: 'batch',
 *         input: {
 *           operations: [
 *             { type: 'SET', key: 'user1', data: { name: 'Alice' } },
 *             { type: 'SET', key: 'user2', data: { name: 'Bob' } },
 *             { type: 'DELETE', key: 'temp' }
 *           ],
 *           config: { storageType: 'localStorage' }
 *         }
 *       },
 *       on: {
 *         BATCH_COMPLETE: 'idle',
 *         BATCH_ERROR: 'error'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createBatchService = () => {
  return fromPromise<
    {
      results: unknown[];
      errors: unknown[];
      totalOperations: number;
    },
    {
      operations: Array<{
        type: 'GET' | 'SET' | 'DELETE';
        key: string;
        data?: unknown;
      }>;
      config?: PersistenceConfig;
    }
  >(async ({ input }) => {
    const { operations, config = {} } = input;
    const results: unknown[] = [];
    const errors: unknown[] = [];

    // Execute all operations directly using the storage logic
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];

      try {
        // Create a promise for each storage operation
        const result = await new Promise((resolve, reject) => {
          // Create a temporary storage service for this operation
          const storageService = createStorageService();

          // Create an actor to handle the service invocation
          const tempMachine = setup({
            types: {
              context: {} as Record<string, never>,
              events: {} as { type: 'EXECUTE_OPERATION' },
            },
            actors: {
              storage: storageService,
            },
          }).createMachine({
            id: 'batchOperation',
            initial: 'executing',
            context: {},
            states: {
              executing: {
                invoke: {
                  src: 'storage',
                  input: {
                    operation: operation.type,
                    key: operation.key,
                    data: operation.data,
                    config,
                  },
                  onDone: {
                    actions: ({ event }) => resolve(event.output),
                  },
                  onError: {
                    actions: ({ event }) => reject(event.error),
                  },
                },
              },
            },
          });

          // Create and start the temporary actor
          const actor = createActor(tempMachine);
          actor.start();
        });

        results.push(result);
      } catch (error) {
        errors.push(error);
      }
    }

    return {
      results,
      errors,
      totalOperations: operations.length,
    };
  });
};

// ===== EXPORT SERVICES =====

/**
 * Pre-configured persistence services
 */
export const PersistenceServices = {
  storage: createStorageService(),
  sync: createSyncService(),
  batch: createBatchService(),
} as const;

// ===== UTILITY FUNCTIONS =====

/**
 * Create a complete persistence machine with storage and sync
 */
export const createPersistenceMachine = (config: PersistenceConfig) => {
  return setup({
    types: {
      context: {} as PersistenceContext,
    },
    actors: {
      storage: createStorageService(),
      sync: createSyncService(),
    },
  }).createMachine({
    id: 'persistence',
    initial: 'initializing',
    context: {
      config,
      listeners: new Map(),
      migrations: new Map(),
      tabId: `tab-${Date.now()}`,
    },
    states: {
      initializing: {
        invoke: {
          src: 'sync',
          input: {
            keyPrefix: config.keyPrefix,
            storageType: config.storageType,
          },
        },
        on: {
          SYNC_CONNECTED: 'ready',
          SYNC_ERROR: 'ready', // Continue without sync if it fails
        },
      },
      ready: {
        on: {
          STORAGE_CHANGED: {
            actions: ({ context, event }) => {
              if ('key' in event && typeof event.key === 'string') {
                const listener = context.listeners.get(event.key);
                if (listener) {
                  listener(event as unknown as SyncEvent);
                }
              }
            },
          },
        },
      },
    },
  });
};

/**
 * Storage quota utilities
 */
export const StorageUtils = {
  /**
   * Get available storage quota information
   */
  async getQuota(): Promise<{ usage: number; quota: number; percentage: number }> {
    if ('storage' in navigator && navigator.storage && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      return {
        usage,
        quota,
        percentage: quota > 0 ? (usage / quota) * 100 : 0,
      };
    }

    // Fallback: estimate using localStorage size
    let usage = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        usage += key.length + (value ? value.length : 0);
      }
    }

    return {
      usage,
      quota: 5 * 1024 * 1024, // Assume 5MB quota
      percentage: (usage / (5 * 1024 * 1024)) * 100,
    };
  },

  /**
   * Clear old/expired data to free up space
   */
  cleanup(keyPrefix = 'app', maxAge = 30 * 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleanedCount = 0;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${keyPrefix}:`)) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            const parsed: StorageItem = JSON.parse(value);
            const age = now - parsed.timestamp;

            if (age > maxAge || (parsed.expiresAt && now > parsed.expiresAt)) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Invalid data, mark for removal
          keysToRemove.push(key);
        }
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
      cleanedCount++;
    }

    return cleanedCount;
  },
};

// ===== DEFAULT EXPORT =====

export default PersistenceServices;
