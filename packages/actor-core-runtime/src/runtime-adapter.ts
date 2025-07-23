/**
 * @module actor-core/runtime/runtime-adapter
 * @description Cross-environment runtime adapters for the Actor-Web Framework
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorRef } from './actor-ref.js';
import { createActorRef } from './create-actor-ref.js';
import { Logger } from './logger.js';
import type { ActorRefOptions, BaseEventObject } from './types.js';

// ========================================================================================
// GLOBAL TYPE GUARDS
// ========================================================================================

/**
 * Type guard for localStorage availability
 */
function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Type guard for window availability
 */
function getWindow(): Window | null {
  try {
    return typeof window !== 'undefined' ? window : null;
  } catch {
    return null;
  }
}

/**
 * Type guard for web worker self availability
 */
function getWorkerSelf(): typeof self | null {
  try {
    return typeof self !== 'undefined' ? self : null;
  } catch {
    return null;
  }
}

/**
 * Type guard for importScripts availability
 */
function hasImportScripts(): boolean {
  try {
    return typeof globalThis !== 'undefined' && 'importScripts' in globalThis;
  } catch {
    return false;
  }
}

/**
 * Type guard for document availability
 */
function hasDocument(): boolean {
  try {
    return typeof document !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Type guard for BroadcastChannel availability
 */
function getBroadcastChannelClass(): typeof BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null;
  } catch {
    return null;
  }
}

// ========================================================================================
// RUNTIME ADAPTER INTERFACES
// ========================================================================================

/**
 * Storage interface for cross-environment persistence
 */
export interface RuntimeStorage {
  /**
   * Get a value from storage
   */
  get(key: string): Promise<unknown>;

  /**
   * Set a value in storage
   */
  set(key: string, value: unknown): Promise<void>;

  /**
   * Remove a value from storage
   */
  remove(key: string): Promise<void>;

  /**
   * Clear all values from storage
   */
  clear(): Promise<void>;

  /**
   * Get all keys from storage
   */
  keys(): Promise<string[]>;
}

/**
 * Message transport interface for cross-environment communication
 */
export interface MessageTransport {
  /**
   * Send a message to another actor
   */
  send<T extends BaseEventObject>(
    targetId: string,
    message: T,
    options?: { timeout?: number }
  ): Promise<void>;

  /**
   * Subscribe to messages for an actor
   */
  subscribe<T extends BaseEventObject>(
    actorId: string,
    handler: (message: T) => Promise<void>
  ): () => void;

  /**
   * Broadcast a message to all actors
   */
  broadcast<T extends BaseEventObject>(message: T): Promise<void>;

  /**
   * Get transport statistics
   */
  getStats(): {
    messagesSent: number;
    messagesReceived: number;
    activeSubscriptions: number;
  };
}

/**
 * Timer interface for cross-environment scheduling
 */
export interface RuntimeTimer {
  /**
   * Schedule a callback to run after a delay
   */
  setTimeout(callback: () => void, delay: number): unknown;

  /**
   * Cancel a scheduled timeout
   */
  clearTimeout(id: unknown): void;

  /**
   * Schedule a callback to run repeatedly
   */
  setInterval(callback: () => void, interval: number): unknown;

  /**
   * Cancel a scheduled interval
   */
  clearInterval(id: unknown): void;

  /**
   * Get current timestamp
   */
  now(): number;
}

/**
 * Core runtime adapter interface
 */
export interface RuntimeAdapter {
  /**
   * Environment identifier
   */
  readonly environment: string;

  /**
   * Storage adapter
   */
  readonly storage: RuntimeStorage;

  /**
   * Message transport adapter
   */
  readonly transport: MessageTransport;

  /**
   * Timer adapter
   */
  readonly timer: RuntimeTimer;

  /**
   * Spawn a new actor
   */
  spawn<TEvent extends BaseEventObject = BaseEventObject>(
    machine: AnyStateMachine,
    options?: ActorRefOptions
  ): ActorRef<TEvent>;

  /**
   * Get adapter capabilities
   */
  getCapabilities(): {
    supportsWorkers: boolean;
    supportsStreaming: boolean;
    supportsPersistence: boolean;
    supportsNetworking: boolean;
  };

  /**
   * Initialize the adapter
   */
  initialize(): Promise<void>;

  /**
   * Cleanup the adapter
   */
  cleanup(): Promise<void>;
}

// ========================================================================================
// NODE.JS ADAPTER
// ========================================================================================

/**
 * Node.js runtime storage implementation
 */
export class NodeStorage implements RuntimeStorage {
  private data = new Map<string, unknown>();
  private logger = Logger.namespace('NODE_STORAGE');

  async get(key: string): Promise<unknown> {
    this.logger.debug('Getting value', { key });
    return this.data.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.logger.debug('Setting value', { key, type: typeof value });
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.logger.debug('Removing value', { key });
    this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.logger.debug('Clearing all values');
    this.data.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }
}

/**
 * Node.js runtime transport implementation
 */
export class NodeTransport implements MessageTransport {
  private subscribers = new Map<string, Set<(message: BaseEventObject) => Promise<void>>>();
  private stats = {
    messagesSent: 0,
    messagesReceived: 0,
    activeSubscriptions: 0,
  };
  private logger = Logger.namespace('NODE_TRANSPORT');

  async send<T extends BaseEventObject>(
    targetId: string,
    message: T,
    options?: { timeout?: number }
  ): Promise<void> {
    this.logger.debug('Sending message', { targetId, type: message.type });

    const handlers = this.subscribers.get(targetId);
    if (handlers) {
      const promises = Array.from(handlers).map((handler) => handler(message));

      // Apply timeout if specified
      if (options?.timeout) {
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Message send timeout after ${options.timeout}ms`)),
            options.timeout
          );
        });
        await Promise.race([Promise.all(promises), timeoutPromise]);
      } else {
        await Promise.all(promises);
      }

      this.stats.messagesSent++;
    }
  }

  subscribe<T extends BaseEventObject>(
    actorId: string,
    handler: (message: T) => Promise<void>
  ): () => void {
    this.logger.debug('Subscribing to messages', { actorId });

    if (!this.subscribers.has(actorId)) {
      this.subscribers.set(actorId, new Set());
    }

    const handlers = this.subscribers.get(actorId);
    if (!handlers) {
      throw new Error(`No handlers found for actor ${actorId}`);
    }
    handlers.add(handler as (message: BaseEventObject) => Promise<void>);
    this.stats.activeSubscriptions++;

    return () => {
      handlers.delete(handler as (message: BaseEventObject) => Promise<void>);
      this.stats.activeSubscriptions--;
      if (handlers.size === 0) {
        this.subscribers.delete(actorId);
      }
    };
  }

  async broadcast<T extends BaseEventObject>(message: T): Promise<void> {
    this.logger.debug('Broadcasting message', { type: message.type });

    const allHandlers: Array<(message: BaseEventObject) => Promise<void>> = [];
    for (const handlers of Array.from(this.subscribers.values())) {
      allHandlers.push(...Array.from(handlers));
    }

    await Promise.all(allHandlers.map((handler) => handler(message)));
    this.stats.messagesSent += allHandlers.length;
  }

  getStats() {
    return { ...this.stats };
  }
}

/**
 * Node.js runtime timer implementation
 */
export class NodeTimer implements RuntimeTimer {
  setTimeout(callback: () => void, delay: number): unknown {
    return global.setTimeout(callback, delay);
  }

  clearTimeout(id: unknown): void {
    global.clearTimeout(id as NodeJS.Timeout);
  }

  setInterval(callback: () => void, interval: number): unknown {
    return global.setInterval(callback, interval);
  }

  clearInterval(id: unknown): void {
    global.clearInterval(id as NodeJS.Timeout);
  }

  now(): number {
    return Date.now();
  }
}

/**
 * Node.js runtime adapter implementation
 */
export class NodeAdapter implements RuntimeAdapter {
  readonly environment = 'node';
  readonly storage = new NodeStorage();
  readonly transport = new NodeTransport();
  readonly timer = new NodeTimer();

  private logger = Logger.namespace('NODE_ADAPTER');

  spawn<TEvent extends BaseEventObject = BaseEventObject>(
    machine: AnyStateMachine,
    options?: ActorRefOptions
  ): ActorRef<TEvent> {
    this.logger.debug('Spawning actor', { machineId: machine.id });
    return createActorRef(machine, options);
  }

  getCapabilities() {
    return {
      supportsWorkers: true,
      supportsStreaming: true,
      supportsPersistence: true,
      supportsNetworking: true,
    };
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing Node.js adapter');
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Node.js adapter');
    await this.storage.clear();
  }
}

// ========================================================================================
// BROWSER ADAPTER
// ========================================================================================

/**
 * Browser runtime storage implementation using localStorage
 */
export class BrowserStorage implements RuntimeStorage {
  private prefix = 'actor-web-';
  private logger = Logger.namespace('BROWSER_STORAGE');

  async get(key: string): Promise<unknown> {
    this.logger.debug('Getting value', { key });
    const storage = getLocalStorage();
    if (!storage) {
      throw new Error('localStorage is not available in this environment');
    }
    const item = storage.getItem(this.prefix + key);
    return item ? JSON.parse(item) : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.logger.debug('Setting value', { key, type: typeof value });
    const storage = getLocalStorage();
    if (!storage) {
      throw new Error('localStorage is not available in this environment');
    }
    storage.setItem(this.prefix + key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.logger.debug('Removing value', { key });
    const storage = getLocalStorage();
    if (!storage) {
      throw new Error('localStorage is not available in this environment');
    }
    storage.removeItem(this.prefix + key);
  }

  async clear(): Promise<void> {
    this.logger.debug('Clearing all values');
    const storage = getLocalStorage();
    if (!storage) {
      throw new Error('localStorage is not available in this environment');
    }
    const keys = await this.keys();
    keys.forEach((key) => storage.removeItem(this.prefix + key));
  }

  async keys(): Promise<string[]> {
    const storage = getLocalStorage();
    if (!storage) {
      throw new Error('localStorage is not available in this environment');
    }
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(this.prefix)) {
        keys.push(key.substring(this.prefix.length));
      }
    }
    return keys;
  }
}

/**
 * Browser runtime transport implementation using BroadcastChannel
 */
export class BrowserTransport implements MessageTransport {
  private channels = new Map<string, BroadcastChannel>();
  private subscribers = new Map<string, Set<(message: BaseEventObject) => Promise<void>>>();
  private stats = {
    messagesSent: 0,
    messagesReceived: 0,
    activeSubscriptions: 0,
  };
  private logger = Logger.namespace('BROWSER_TRANSPORT');

  async send<T extends BaseEventObject>(
    targetId: string,
    message: T,
    _options?: { timeout?: number }
  ): Promise<void> {
    this.logger.debug('Sending message', { targetId, type: message.type });

    const BroadcastChannelClass = getBroadcastChannelClass();
    if (!BroadcastChannelClass) {
      throw new Error('BroadcastChannel is not available in this environment');
    }

    let channel = this.channels.get(targetId);
    if (!channel) {
      channel = new BroadcastChannelClass(`actor-${targetId}`);
      this.channels.set(targetId, channel);
    }

    channel.postMessage(message);
    this.stats.messagesSent++;
  }

  subscribe<T extends BaseEventObject>(
    actorId: string,
    handler: (message: T) => Promise<void>
  ): () => void {
    this.logger.debug('Subscribing to messages', { actorId });

    const BroadcastChannelClass = getBroadcastChannelClass();
    if (!BroadcastChannelClass) {
      throw new Error('BroadcastChannel is not available in this environment');
    }

    if (!this.subscribers.has(actorId)) {
      this.subscribers.set(actorId, new Set());
    }

    const handlers = this.subscribers.get(actorId);
    if (!handlers) {
      throw new Error(`No handlers found for actor ${actorId}`);
    }
    handlers.add(handler as (message: BaseEventObject) => Promise<void>);
    this.stats.activeSubscriptions++;

    let channel = this.channels.get(actorId);
    if (!channel) {
      channel = new BroadcastChannelClass(`actor-${actorId}`);
      this.channels.set(actorId, channel);

      channel.addEventListener('message', (event: MessageEvent) => {
        const message = event.data;
        handlers.forEach((h) => h(message));
        this.stats.messagesReceived++;
      });
    }

    return () => {
      handlers.delete(handler as (message: BaseEventObject) => Promise<void>);
      this.stats.activeSubscriptions--;
      if (handlers.size === 0) {
        this.subscribers.delete(actorId);
        channel?.close();
        this.channels.delete(actorId);
      }
    };
  }

  async broadcast<T extends BaseEventObject>(message: T): Promise<void> {
    this.logger.debug('Broadcasting message', { type: message.type });

    const BroadcastChannelClass = getBroadcastChannelClass();
    if (!BroadcastChannelClass) {
      throw new Error('BroadcastChannel is not available in this environment');
    }

    const broadcastChannel = new BroadcastChannelClass('actor-broadcast');
    broadcastChannel.postMessage(message);
    broadcastChannel.close();
    this.stats.messagesSent++;
  }

  getStats() {
    return { ...this.stats };
  }

  /**
   * Clean up all broadcast channels
   */
  cleanup(): void {
    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();
  }
}

/**
 * Browser runtime timer implementation
 */
export class BrowserTimer implements RuntimeTimer {
  setTimeout(callback: () => void, delay: number): unknown {
    const win = getWindow();
    if (win) {
      return win.setTimeout(callback, delay);
    }
    return setTimeout(callback, delay);
  }

  clearTimeout(id: unknown): void {
    const win = getWindow();
    if (win) {
      win.clearTimeout(id as number);
    } else {
      clearTimeout(id as NodeJS.Timeout);
    }
  }

  setInterval(callback: () => void, interval: number): unknown {
    const win = getWindow();
    if (win) {
      return win.setInterval(callback, interval);
    }
    return setInterval(callback, interval);
  }

  clearInterval(id: unknown): void {
    const win = getWindow();
    if (win) {
      win.clearInterval(id as number);
    } else {
      clearInterval(id as NodeJS.Timeout);
    }
  }

  now(): number {
    return Date.now();
  }
}

/**
 * Browser runtime adapter implementation
 */
export class BrowserAdapter implements RuntimeAdapter {
  readonly environment = 'browser';
  readonly storage = new BrowserStorage();
  readonly transport = new BrowserTransport();
  readonly timer = new BrowserTimer();

  private logger = Logger.namespace('BROWSER_ADAPTER');

  spawn<TEvent extends BaseEventObject = BaseEventObject>(
    machine: AnyStateMachine,
    options?: ActorRefOptions
  ): ActorRef<TEvent> {
    this.logger.debug('Spawning actor', { machineId: machine.id });
    return createActorRef(machine, options);
  }

  getCapabilities() {
    return {
      supportsWorkers: true,
      supportsStreaming: false,
      supportsPersistence: true,
      supportsNetworking: true,
    };
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing browser adapter');
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up browser adapter');
    await this.storage.clear();

    // Close all broadcast channels
    if (this.transport instanceof BrowserTransport) {
      this.transport.cleanup();
    }
  }
}

// ========================================================================================
// WEB WORKER ADAPTER
// ========================================================================================

/**
 * Web Worker runtime storage implementation using in-memory storage
 */
export class WorkerStorage implements RuntimeStorage {
  private data = new Map<string, unknown>();
  private logger = Logger.namespace('WORKER_STORAGE');

  async get(key: string): Promise<unknown> {
    this.logger.debug('Getting value', { key });
    return this.data.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.logger.debug('Setting value', { key, type: typeof value });
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.logger.debug('Removing value', { key });
    this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.logger.debug('Clearing all values');
    this.data.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }
}

/**
 * Web Worker runtime transport implementation using postMessage
 */
export class WorkerTransport implements MessageTransport {
  private subscribers = new Map<string, Set<(message: BaseEventObject) => Promise<void>>>();
  private stats = {
    messagesSent: 0,
    messagesReceived: 0,
    activeSubscriptions: 0,
  };
  private logger = Logger.namespace('WORKER_TRANSPORT');

  constructor() {
    // Listen for messages from main thread
    const workerSelf = getWorkerSelf();
    if (workerSelf) {
      workerSelf.addEventListener('message', (event: MessageEvent) => {
        const { targetId, message } = event.data;
        if (targetId && message) {
          const handlers = this.subscribers.get(targetId);
          if (handlers) {
            handlers.forEach((handler) => handler(message));
            this.stats.messagesReceived++;
          }
        }
      });
    }
  }

  async send<T extends BaseEventObject>(
    targetId: string,
    message: T,
    _options?: { timeout?: number }
  ): Promise<void> {
    this.logger.debug('Sending message', { targetId, type: message.type });

    const workerSelf = getWorkerSelf();
    if (workerSelf) {
      workerSelf.postMessage({ targetId, message });
      this.stats.messagesSent++;
    } else {
      throw new Error('Web Worker postMessage is not available in this environment');
    }
  }

  subscribe<T extends BaseEventObject>(
    actorId: string,
    handler: (message: T) => Promise<void>
  ): () => void {
    this.logger.debug('Subscribing to messages', { actorId });

    if (!this.subscribers.has(actorId)) {
      this.subscribers.set(actorId, new Set());
    }

    const handlers = this.subscribers.get(actorId);
    if (!handlers) {
      throw new Error(`No handlers found for actor ${actorId}`);
    }
    handlers.add(handler as (message: BaseEventObject) => Promise<void>);
    this.stats.activeSubscriptions++;

    return () => {
      handlers.delete(handler as (message: BaseEventObject) => Promise<void>);
      this.stats.activeSubscriptions--;
      if (handlers.size === 0) {
        this.subscribers.delete(actorId);
      }
    };
  }

  async broadcast<T extends BaseEventObject>(message: T): Promise<void> {
    this.logger.debug('Broadcasting message', { type: message.type });

    const workerSelf = getWorkerSelf();
    if (workerSelf) {
      workerSelf.postMessage({ broadcast: true, message });
      this.stats.messagesSent++;
    } else {
      throw new Error('Web Worker postMessage is not available in this environment');
    }
  }

  getStats() {
    return { ...this.stats };
  }
}

/**
 * Web Worker runtime timer implementation
 */
export class WorkerTimer implements RuntimeTimer {
  setTimeout(callback: () => void, delay: number): unknown {
    return setTimeout(callback, delay);
  }

  clearTimeout(id: unknown): void {
    clearTimeout(id as number);
  }

  setInterval(callback: () => void, interval: number): unknown {
    return setInterval(callback, interval);
  }

  clearInterval(id: unknown): void {
    clearInterval(id as number);
  }

  now(): number {
    return Date.now();
  }
}

/**
 * Web Worker runtime adapter implementation
 */
export class WorkerAdapter implements RuntimeAdapter {
  readonly environment = 'worker';
  readonly storage = new WorkerStorage();
  readonly transport = new WorkerTransport();
  readonly timer = new WorkerTimer();

  private logger = Logger.namespace('WORKER_ADAPTER');

  spawn<TEvent extends BaseEventObject = BaseEventObject>(
    machine: AnyStateMachine,
    options?: ActorRefOptions
  ): ActorRef<TEvent> {
    this.logger.debug('Spawning actor', { machineId: machine.id });
    return createActorRef(machine, options);
  }

  getCapabilities() {
    return {
      supportsWorkers: false,
      supportsStreaming: false,
      supportsPersistence: false,
      supportsNetworking: false,
    };
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing worker adapter');
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up worker adapter');
    await this.storage.clear();
  }
}

// ========================================================================================
// ADAPTER FACTORY AND DETECTION
// ========================================================================================

/**
 * Detect the current runtime environment
 */
export function detectEnvironment(): string {
  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }

  // Check for browser
  if (getWindow() && hasDocument()) {
    return 'browser';
  }

  // Check for web worker
  if (getWorkerSelf() && hasImportScripts()) {
    return 'worker';
  }

  return 'unknown';
}

/**
 * Create the appropriate runtime adapter for the current environment
 */
export function createRuntimeAdapter(): RuntimeAdapter {
  const environment = detectEnvironment();

  switch (environment) {
    case 'node':
      return new NodeAdapter();
    case 'browser':
      return new BrowserAdapter();
    case 'worker':
      return new WorkerAdapter();
    default:
      throw new Error(`Unsupported environment: ${environment}`);
  }
}

/**
 * Global runtime adapter instance
 */
export const runtime = createRuntimeAdapter();

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Initialize the runtime adapter
 */
export async function initializeRuntime(): Promise<void> {
  await runtime.initialize();
}

/**
 * Cleanup the runtime adapter
 */
export async function cleanupRuntime(): Promise<void> {
  await runtime.cleanup();
}

/**
 * Get runtime capabilities
 */
export function getRuntimeCapabilities() {
  return runtime.getCapabilities();
}

/**
 * Get runtime environment information
 */
export function getRuntimeInfo() {
  return {
    environment: runtime.environment,
    capabilities: runtime.getCapabilities(),
    transportStats: runtime.transport.getStats(),
  };
}
