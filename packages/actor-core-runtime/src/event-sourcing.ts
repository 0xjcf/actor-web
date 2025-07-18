/**
 * @module actor-core/runtime/event-sourcing
 * @description Event sourcing implementation for actor state management with time-travel debugging
 */

import { Logger } from './logger.js';

// ========================================================================================
// EVENT SOURCING INTERFACES
// ========================================================================================

/**
 * Base event type for event sourcing
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
 * Event metadata for tracking and debugging
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
 * Event store interface for persistence
 */
export interface EventStore {
  /**
   * Append events to the store
   */
  append(actorId: string, events: BaseEvent[], expectedVersion: number): Promise<void>;

  /**
   * Get events for an actor from a specific version
   */
  getEvents(actorId: string, fromVersion?: number): Promise<BaseEvent[]>;

  /**
   * Get events for an actor within a time range
   */
  getEventsByTimeRange(actorId: string, from: Date, to: Date): Promise<BaseEvent[]>;

  /**
   * Get snapshot of actor state at a specific version
   */
  getSnapshot(actorId: string, version?: number): Promise<unknown>;

  /**
   * Save snapshot of actor state
   */
  saveSnapshot(actorId: string, state: unknown, version: number): Promise<void>;

  /**
   * Get all events of a specific type
   */
  getEventsByType(eventType: string, limit?: number): Promise<BaseEvent[]>;
}

/**
 * Event sourced state reconstruction
 */
export interface EventProjection<TState, TEvent extends BaseEvent> {
  /**
   * Reduce events to build state
   */
  reduce(state: TState, event: TEvent): TState;

  /**
   * Get initial state
   */
  getInitialState(): TState;

  /**
   * Handle event validation
   */
  validateEvent(event: TEvent): boolean;
}

// ========================================================================================
// IN-MEMORY EVENT STORE
// ========================================================================================

/**
 * In-memory event store implementation for development and testing
 */
export class InMemoryEventStore implements EventStore {
  private events = new Map<string, BaseEvent[]>();
  private snapshots = new Map<string, { state: unknown; version: number }>();
  private logger = Logger.namespace('IN_MEMORY_EVENT_STORE');

  async append(actorId: string, events: BaseEvent[], expectedVersion: number): Promise<void> {
    const existingEvents = this.events.get(actorId) || [];
    const currentVersion = existingEvents.length;

    if (currentVersion !== expectedVersion) {
      throw new Error(
        `Concurrency conflict: expected version ${expectedVersion}, got ${currentVersion}`
      );
    }

    // Validate event versions
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.version !== currentVersion + i + 1) {
        throw new Error(
          `Invalid event version: expected ${currentVersion + i + 1}, got ${event.version}`
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
    const events = this.events.get(actorId) || [];
    return events.slice(fromVersion);
  }

  async getEventsByTimeRange(actorId: string, from: Date, to: Date): Promise<BaseEvent[]> {
    const events = this.events.get(actorId) || [];
    return events.filter(
      (event) => event.timestamp >= from.getTime() && event.timestamp <= to.getTime()
    );
  }

  async getSnapshot(actorId: string, version?: number): Promise<unknown> {
    const snapshot = this.snapshots.get(actorId);
    if (!snapshot) {
      return undefined;
    }

    if (version && snapshot.version !== version) {
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

  /**
   * Get statistics about the event store
   */
  getStats() {
    const totalEvents = Array.from(this.events.values()).reduce(
      (sum, events) => sum + events.length,
      0
    );
    const totalActors = this.events.size;
    const totalSnapshots = this.snapshots.size;

    return {
      totalEvents,
      totalActors,
      totalSnapshots,
    };
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.events.clear();
    this.snapshots.clear();
  }
}

// ========================================================================================
// EVENT SOURCED ACTOR BASE CLASS
// ========================================================================================

/**
 * Base class for event sourced actors
 */
export abstract class EventSourcedActor<TState, TEvent extends BaseEvent> {
  protected state: TState;
  protected version = 0;
  protected logger = Logger.namespace('EVENT_SOURCED_ACTOR');

  constructor(
    protected actorId: string,
    protected eventStore: EventStore,
    protected projection: EventProjection<TState, TEvent>
  ) {
    this.state = projection.getInitialState();
  }

  /**
   * Initialize actor by replaying events
   */
  async initialize(): Promise<void> {
    // Try to load from snapshot first
    const snapshot = await this.eventStore.getSnapshot(this.actorId);
    if (snapshot) {
      this.state = snapshot as TState;
      this.logger.debug('Loaded from snapshot', { actorId: this.actorId });
    }

    // Replay events from last snapshot
    const events = await this.eventStore.getEvents(this.actorId, this.version);
    for (const event of events) {
      this.applyEvent(event as TEvent);
    }

    this.logger.debug('Actor initialized', {
      actorId: this.actorId,
      version: this.version,
      eventCount: events.length,
    });
  }

  /**
   * Apply an event to the actor state
   */
  protected applyEvent(event: TEvent): void {
    if (!this.projection.validateEvent(event)) {
      throw new Error(`Invalid event: ${event.type}`);
    }

    this.state = this.projection.reduce(this.state, event);
    this.version = event.version;

    this.logger.debug('Event applied', {
      actorId: this.actorId,
      eventType: event.type,
      version: this.version,
    });
  }

  /**
   * Emit events and update state
   */
  protected async emitEvents(events: Partial<TEvent>[]): Promise<void> {
    const fullEvents: TEvent[] = events.map((event, index) => ({
      ...event,
      timestamp: Date.now(),
      eventId: this.generateEventId(),
      actorId: this.actorId,
      version: this.version + index + 1,
    })) as TEvent[];

    // Persist events
    await this.eventStore.append(this.actorId, fullEvents, this.version);

    // Apply events to state
    for (const event of fullEvents) {
      this.applyEvent(event);
    }
  }

  /**
   * Get current state
   */
  getState(): TState {
    return this.state;
  }

  /**
   * Get current version
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Save snapshot of current state
   */
  async saveSnapshot(): Promise<void> {
    await this.eventStore.saveSnapshot(this.actorId, this.state, this.version);
  }

  /**
   * Replay events to reconstruct state at specific version
   */
  async replayToVersion(targetVersion: number): Promise<TState> {
    const events = await this.eventStore.getEvents(this.actorId, 0);
    const relevantEvents = events.filter((event) => event.version <= targetVersion);

    let tempState = this.projection.getInitialState();
    for (const event of relevantEvents) {
      tempState = this.projection.reduce(tempState, event as TEvent);
    }

    return tempState;
  }

  /**
   * Get event history
   */
  async getEventHistory(): Promise<TEvent[]> {
    const events = await this.eventStore.getEvents(this.actorId);
    return events as TEvent[];
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

// ========================================================================================
// EXAMPLE IMPLEMENTATIONS
// ========================================================================================

/**
 * Example: User aggregate events
 */
export namespace UserAggregate {
  export interface UserState {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  }

  export type UserEvent =
    | UserCreatedEvent
    | UserNameChangedEvent
    | UserEmailChangedEvent
    | UserActivatedEvent
    | UserDeactivatedEvent;

  export interface UserCreatedEvent extends BaseEvent {
    type: 'USER_CREATED';
    name: string;
    email: string;
  }

  export interface UserNameChangedEvent extends BaseEvent {
    type: 'USER_NAME_CHANGED';
    previousName: string;
    newName: string;
  }

  export interface UserEmailChangedEvent extends BaseEvent {
    type: 'USER_EMAIL_CHANGED';
    previousEmail: string;
    newEmail: string;
  }

  export interface UserActivatedEvent extends BaseEvent {
    type: 'USER_ACTIVATED';
  }

  export interface UserDeactivatedEvent extends BaseEvent {
    type: 'USER_DEACTIVATED';
    reason?: string;
  }

  export class UserProjection implements EventProjection<UserState, UserEvent> {
    getInitialState(): UserState {
      return {
        id: '',
        name: '',
        email: '',
        isActive: false,
        createdAt: 0,
        updatedAt: 0,
      };
    }

    reduce(state: UserState, event: UserEvent): UserState {
      switch (event.type) {
        case 'USER_CREATED':
          return {
            ...state,
            id: event.actorId,
            name: event.name,
            email: event.email,
            isActive: true,
            createdAt: event.timestamp,
            updatedAt: event.timestamp,
          };

        case 'USER_NAME_CHANGED':
          return {
            ...state,
            name: event.newName,
            updatedAt: event.timestamp,
          };

        case 'USER_EMAIL_CHANGED':
          return {
            ...state,
            email: event.newEmail,
            updatedAt: event.timestamp,
          };

        case 'USER_ACTIVATED':
          return {
            ...state,
            isActive: true,
            updatedAt: event.timestamp,
          };

        case 'USER_DEACTIVATED':
          return {
            ...state,
            isActive: false,
            updatedAt: event.timestamp,
          };

        default:
          return state;
      }
    }

    validateEvent(event: UserEvent): boolean {
      // Basic validation
      if (!event.type || !event.actorId || !event.timestamp) {
        return false;
      }

      switch (event.type) {
        case 'USER_CREATED':
          return !!(event.name && event.email);
        case 'USER_NAME_CHANGED':
          return !!(event.previousName && event.newName);
        case 'USER_EMAIL_CHANGED':
          return !!(event.previousEmail && event.newEmail);
        default:
          return true;
      }
    }
  }

  export class UserActor extends EventSourcedActor<UserState, UserEvent> {
    constructor(userId: string, eventStore: EventStore) {
      super(userId, eventStore, new UserProjection());
    }

    async createUser(name: string, email: string): Promise<void> {
      if (this.state.id) {
        throw new Error('User already exists');
      }

      await this.emitEvents([
        {
          type: 'USER_CREATED',
          name,
          email,
        },
      ]);
    }

    async changeName(newName: string): Promise<void> {
      if (!this.state.id) {
        throw new Error('User does not exist');
      }

      if (this.state.name === newName) {
        return; // No change
      }

      await this.emitEvents([
        {
          type: 'USER_NAME_CHANGED',
          previousName: this.state.name,
          newName,
        },
      ]);
    }

    async changeEmail(newEmail: string): Promise<void> {
      if (!this.state.id) {
        throw new Error('User does not exist');
      }

      if (this.state.email === newEmail) {
        return; // No change
      }

      await this.emitEvents([
        {
          type: 'USER_EMAIL_CHANGED',
          previousEmail: this.state.email,
          newEmail,
        },
      ]);
    }

    async activate(): Promise<void> {
      if (!this.state.id) {
        throw new Error('User does not exist');
      }

      if (this.state.isActive) {
        return; // Already active
      }

      await this.emitEvents([
        {
          type: 'USER_ACTIVATED',
        },
      ]);
    }

    async deactivate(reason?: string): Promise<void> {
      if (!this.state.id) {
        throw new Error('User does not exist');
      }

      if (!this.state.isActive) {
        return; // Already inactive
      }

      await this.emitEvents([
        {
          type: 'USER_DEACTIVATED',
          reason,
        },
      ]);
    }

    getUser(): UserState {
      return this.getState();
    }
  }
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Create event store factory
 */
export function createEventStore(): EventStore {
  return new InMemoryEventStore();
}

/**
 * Event sourcing utilities
 */
export namespace EventSourcingUtils {
  /**
   * Validate event ordering
   */
  export function validateEventOrder(events: BaseEvent[]): boolean {
    for (let i = 1; i < events.length; i++) {
      if (events[i].version !== events[i - 1].version + 1) {
        return false;
      }
    }
    return true;
  }

  /**
   * Group events by actor
   */
  export function groupEventsByActor(events: BaseEvent[]): Map<string, BaseEvent[]> {
    const groups = new Map<string, BaseEvent[]>();

    for (const event of events) {
      const existing = groups.get(event.actorId) || [];
      existing.push(event);
      groups.set(event.actorId, existing);
    }

    return groups;
  }

  /**
   * Create event with metadata
   */
  export function createEvent<T extends BaseEvent>(
    type: T['type'],
    data: Omit<T, 'type' | 'timestamp' | 'eventId' | 'actorId' | 'version'>,
    actorId: string,
    version: number,
    metadata?: EventMetadata
  ): T {
    return {
      type,
      ...data,
      timestamp: Date.now(),
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      actorId,
      version,
      metadata,
    } as T;
  }

  /**
   * Time-travel debugging: get state at specific point in time
   */
  export async function getStateAtTime<TState, TEvent extends BaseEvent>(
    actorId: string,
    eventStore: EventStore,
    projection: EventProjection<TState, TEvent>,
    timestamp: number
  ): Promise<TState> {
    const events = await eventStore.getEvents(actorId);
    const relevantEvents = events.filter((event) => event.timestamp <= timestamp);

    let state = projection.getInitialState();
    for (const event of relevantEvents) {
      state = projection.reduce(state, event as TEvent);
    }

    return state;
  }
}
