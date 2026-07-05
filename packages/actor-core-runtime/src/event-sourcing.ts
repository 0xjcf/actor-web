/**
 * @module actor-core/runtime/event-sourcing
 * @description Journal storage contract for lattice durability experiments
 */

import { Logger } from './logger.js';

/**
 * Base event type for journaled state changes.
 */
export interface BaseEvent {
  type: string;
  timestamp: number;
  eventId: string;
  actorId: string;
  version: number;
  metadata?: Record<string, unknown>;
}

/**
 * Optional metadata attached to journal entries.
 */
export interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  userId?: string;
  source?: string;
  traceId?: string;
  [key: string]: unknown;
}

/**
 * Append/replay/snapshot contract retained as the public journal seam.
 */
export interface EventStore {
  append(actorId: string, events: BaseEvent[], expectedVersion: number): Promise<void>;
  getEvents(actorId: string, fromVersion?: number): Promise<BaseEvent[]>;
  getEventsByTimeRange(actorId: string, from: Date, to: Date): Promise<BaseEvent[]>;
  getSnapshot(actorId: string, version?: number): Promise<unknown>;
  saveSnapshot(actorId: string, state: unknown, version: number): Promise<void>;
  getEventsByType(eventType: string, limit?: number): Promise<BaseEvent[]>;
}

/**
 * Reducer contract for consumers that rebuild state from a journal.
 */
export interface EventProjection<TState, TEvent extends BaseEvent> {
  reduce(state: TState, event: TEvent): TState;
  getInitialState(): TState;
  validateEvent(event: TEvent): boolean;
}

/**
 * In-memory journal implementation for tests and local experiments.
 */
export class InMemoryEventStore implements EventStore {
  private events = new Map<string, BaseEvent[]>();
  private snapshots = new Map<string, { state: unknown; version: number }>();
  private logger = Logger.namespace('IN_MEMORY_EVENT_STORE');

  async append(actorId: string, events: BaseEvent[], expectedVersion: number): Promise<void> {
    const existingEvents = this.events.get(actorId) ?? [];
    const currentVersion = existingEvents.length;

    if (currentVersion !== expectedVersion) {
      throw new Error(
        `Concurrency conflict: expected version ${expectedVersion}, got ${currentVersion}`
      );
    }

    for (const [index, event] of events.entries()) {
      const expectedEventVersion = currentVersion + index + 1;
      if (event.version !== expectedEventVersion) {
        throw new Error(
          `Invalid event version: expected ${expectedEventVersion}, got ${event.version}`
        );
      }
    }

    const updatedEvents = [...existingEvents, ...events];
    this.events.set(actorId, updatedEvents);

    this.logger.debug('Events appended', {
      actorId,
      eventCount: events.length,
      newVersion: updatedEvents.length,
    });
  }

  async getEvents(actorId: string, fromVersion = 0): Promise<BaseEvent[]> {
    const events = this.events.get(actorId) ?? [];
    return events.slice(fromVersion);
  }

  async getEventsByTimeRange(actorId: string, from: Date, to: Date): Promise<BaseEvent[]> {
    const events = this.events.get(actorId) ?? [];
    return events.filter(
      (event) => event.timestamp >= from.getTime() && event.timestamp <= to.getTime()
    );
  }

  async getSnapshot(actorId: string, version?: number): Promise<unknown> {
    const snapshot = this.snapshots.get(actorId);
    if (!snapshot) {
      return undefined;
    }

    if (version !== undefined && snapshot.version !== version) {
      return undefined;
    }

    return snapshot.state;
  }

  async saveSnapshot(actorId: string, state: unknown, version: number): Promise<void> {
    this.snapshots.set(actorId, { state, version });
    this.logger.debug('Snapshot saved', { actorId, version });
  }

  async getEventsByType(eventType: string, limit = 100): Promise<BaseEvent[]> {
    const allEvents: BaseEvent[] = [];

    for (const events of this.events.values()) {
      allEvents.push(...events.filter((event) => event.type === eventType));
    }

    return allEvents.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  getStats() {
    const totalEvents = Array.from(this.events.values()).reduce(
      (sum, events) => sum + events.length,
      0
    );

    return {
      totalEvents,
      totalActors: this.events.size,
      totalSnapshots: this.snapshots.size,
    };
  }

  clear(): void {
    this.events.clear();
    this.snapshots.clear();
  }
}

export function createEventStore(): EventStore {
  return new InMemoryEventStore();
}
