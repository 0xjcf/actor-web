/**
 * @module actor-core/runtime/tests/event-sourcing.test
 * @description Tests for event sourcing implementation
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BaseEvent,
  EventSourcingUtils,
  type EventStore,
  type InMemoryEventStore,
  UserAggregate,
  createEventStore,
} from '../event-sourcing.js';

describe('Event Sourcing', () => {
  let eventStore: EventStore;

  beforeEach(() => {
    eventStore = createEventStore();
  });

  describe('InMemoryEventStore', () => {
    it('should append and retrieve events', async () => {
      const actorId = 'test-actor';
      const events: BaseEvent[] = [
        {
          type: 'TEST_EVENT',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId,
          version: 1,
        },
        {
          type: 'ANOTHER_EVENT',
          timestamp: Date.now(),
          eventId: 'event-2',
          actorId,
          version: 2,
        },
      ];

      await eventStore.append(actorId, events, 0);
      const retrievedEvents = await eventStore.getEvents(actorId);

      expect(retrievedEvents).toEqual(events);
    });

    it('should handle concurrency conflicts', async () => {
      const actorId = 'test-actor';
      const events: BaseEvent[] = [
        {
          type: 'TEST_EVENT',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId,
          version: 1,
        },
      ];

      await eventStore.append(actorId, events, 0);

      // Try to append with wrong expected version
      await expect(eventStore.append(actorId, events, 0)).rejects.toThrow(
        'Concurrency conflict: expected version 0, got 1'
      );
    });

    it('should validate event versions', async () => {
      const actorId = 'test-actor';
      const events: BaseEvent[] = [
        {
          type: 'TEST_EVENT',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId,
          version: 2, // Wrong version - should be 1
        },
      ];

      await expect(eventStore.append(actorId, events, 0)).rejects.toThrow(
        'Invalid event version: expected 1, got 2'
      );
    });

    it('should retrieve events from specific version', async () => {
      const actorId = 'test-actor';
      const events: BaseEvent[] = [
        {
          type: 'EVENT_1',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId,
          version: 1,
        },
        {
          type: 'EVENT_2',
          timestamp: Date.now(),
          eventId: 'event-2',
          actorId,
          version: 2,
        },
        {
          type: 'EVENT_3',
          timestamp: Date.now(),
          eventId: 'event-3',
          actorId,
          version: 3,
        },
      ];

      await eventStore.append(actorId, events, 0);
      const eventsFromVersion2 = await eventStore.getEvents(actorId, 2);

      expect(eventsFromVersion2).toEqual([events[2]]);
    });

    it('should retrieve events by time range', async () => {
      const actorId = 'test-actor';
      const now = Date.now();
      const events: BaseEvent[] = [
        {
          type: 'EVENT_1',
          timestamp: now - 2000,
          eventId: 'event-1',
          actorId,
          version: 1,
        },
        {
          type: 'EVENT_2',
          timestamp: now - 1000,
          eventId: 'event-2',
          actorId,
          version: 2,
        },
        {
          type: 'EVENT_3',
          timestamp: now,
          eventId: 'event-3',
          actorId,
          version: 3,
        },
      ];

      await eventStore.append(actorId, events, 0);
      const eventsInRange = await eventStore.getEventsByTimeRange(
        actorId,
        new Date(now - 1500),
        new Date(now - 500)
      );

      expect(eventsInRange).toEqual([events[1]]);
    });

    it('should save and retrieve snapshots', async () => {
      const actorId = 'test-actor';
      const state = { name: 'test', count: 42 };

      await eventStore.saveSnapshot(actorId, state, 5);
      const retrievedState = await eventStore.getSnapshot(actorId);

      expect(retrievedState).toEqual(state);
    });

    it('should retrieve events by type', async () => {
      const actorId1 = 'actor-1';
      const actorId2 = 'actor-2';
      const events1: BaseEvent[] = [
        {
          type: 'USER_CREATED',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: actorId1,
          version: 1,
        },
      ];
      const events2: BaseEvent[] = [
        {
          type: 'USER_CREATED',
          timestamp: Date.now(),
          eventId: 'event-2',
          actorId: actorId2,
          version: 1,
        },
        {
          type: 'USER_UPDATED',
          timestamp: Date.now(),
          eventId: 'event-3',
          actorId: actorId2,
          version: 2,
        },
      ];

      await eventStore.append(actorId1, events1, 0);
      await eventStore.append(actorId2, events2, 0);

      const userCreatedEvents = await eventStore.getEventsByType('USER_CREATED');
      expect(userCreatedEvents).toHaveLength(2);
      expect(userCreatedEvents.every((e) => e.type === 'USER_CREATED')).toBe(true);
    });

    it('should provide statistics', async () => {
      const store = eventStore as InMemoryEventStore;

      const actorId = 'test-actor';
      const events: BaseEvent[] = [
        {
          type: 'TEST_EVENT',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId,
          version: 1,
        },
      ];

      await store.append(actorId, events, 0);
      await store.saveSnapshot(actorId, { test: true }, 1);

      const stats = store.getStats();
      expect(stats.totalEvents).toBe(1);
      expect(stats.totalActors).toBe(1);
      expect(stats.totalSnapshots).toBe(1);
    });
  });

  describe('UserAggregate', () => {
    let userActor: UserAggregate.UserActor;

    beforeEach(async () => {
      userActor = new UserAggregate.UserActor('user-123', eventStore);
      await userActor.initialize();
    });

    describe('UserActor', () => {
      it('should create user', async () => {
        await userActor.createUser('John Doe', 'john@example.com');

        const user = userActor.getUser();
        expect(user.id).toBe('user-123');
        expect(user.name).toBe('John Doe');
        expect(user.email).toBe('john@example.com');
        expect(user.isActive).toBe(true);
      });

      it('should prevent duplicate user creation', async () => {
        await userActor.createUser('John Doe', 'john@example.com');

        await expect(userActor.createUser('Jane Doe', 'jane@example.com')).rejects.toThrow(
          'User already exists'
        );
      });

      it('should change user name', async () => {
        await userActor.createUser('John Doe', 'john@example.com');
        await userActor.changeName('Jane Doe');

        const user = userActor.getUser();
        expect(user.name).toBe('Jane Doe');
      });

      it('should change user email', async () => {
        await userActor.createUser('John Doe', 'john@example.com');
        await userActor.changeEmail('john.doe@example.com');

        const user = userActor.getUser();
        expect(user.email).toBe('john.doe@example.com');
      });

      it('should deactivate user', async () => {
        await userActor.createUser('John Doe', 'john@example.com');
        await userActor.deactivate('User requested deactivation');

        const user = userActor.getUser();
        expect(user.isActive).toBe(false);
      });

      it('should reactivate user', async () => {
        await userActor.createUser('John Doe', 'john@example.com');
        await userActor.deactivate();
        await userActor.activate();

        const user = userActor.getUser();
        expect(user.isActive).toBe(true);
      });

      it('should handle idempotent operations', async () => {
        await userActor.createUser('John Doe', 'john@example.com');

        // These should not throw or create additional events
        await userActor.changeName('John Doe'); // Same name
        await userActor.changeEmail('john@example.com'); // Same email
        await userActor.activate(); // Already active
        await userActor.deactivate();
        await userActor.deactivate(); // Already inactive

        const user = userActor.getUser();
        expect(user.isActive).toBe(false);
      });

      it('should track event history', async () => {
        await userActor.createUser('John Doe', 'john@example.com');
        await userActor.changeName('Jane Doe');
        await userActor.changeEmail('jane@example.com');

        const history = await userActor.getEventHistory();
        expect(history).toHaveLength(3);
        expect(history[0].type).toBe('USER_CREATED');
        expect(history[1].type).toBe('USER_NAME_CHANGED');
        expect(history[2].type).toBe('USER_EMAIL_CHANGED');
      });

      it('should support time-travel debugging', async () => {
        await userActor.createUser('John Doe', 'john@example.com');
        await userActor.changeName('Jane Doe');
        await userActor.changeEmail('jane@example.com');

        // Replay to version 1 (after user creation)
        const stateAtVersion1 = await userActor.replayToVersion(1);
        expect(stateAtVersion1.name).toBe('John Doe');
        expect(stateAtVersion1.email).toBe('john@example.com');

        // Replay to version 2 (after name change)
        const stateAtVersion2 = await userActor.replayToVersion(2);
        expect(stateAtVersion2.name).toBe('Jane Doe');
        expect(stateAtVersion2.email).toBe('john@example.com');
      });

      it('should save and restore from snapshots', async () => {
        await userActor.createUser('John Doe', 'john@example.com');
        await userActor.changeName('Jane Doe');
        await userActor.saveSnapshot();

        // Create new actor instance
        const newUserActor = new UserAggregate.UserActor('user-123', eventStore);
        await newUserActor.initialize();

        const restoredUser = newUserActor.getUser();
        expect(restoredUser.name).toBe('Jane Doe');
        expect(restoredUser.email).toBe('john@example.com');
      });
    });

    describe('UserProjection', () => {
      let projection: UserAggregate.UserProjection;

      beforeEach(() => {
        projection = new UserAggregate.UserProjection();
      });

      it('should provide initial state', () => {
        const initialState = projection.getInitialState();
        expect(initialState.id).toBe('');
        expect(initialState.name).toBe('');
        expect(initialState.email).toBe('');
        expect(initialState.isActive).toBe(false);
      });

      it('should validate events', () => {
        const validCreatedEvent: UserAggregate.UserCreatedEvent = {
          type: 'USER_CREATED',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: 'user-123',
          version: 1,
          name: 'John Doe',
          email: 'john@example.com',
        };

        const invalidCreatedEvent: UserAggregate.UserCreatedEvent = {
          type: 'USER_CREATED',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: 'user-123',
          version: 1,
          name: '', // Invalid - empty name
          email: 'john@example.com',
        };

        expect(projection.validateEvent(validCreatedEvent)).toBe(true);
        expect(projection.validateEvent(invalidCreatedEvent)).toBe(false);
      });

      it('should reduce USER_CREATED events', () => {
        const initialState = projection.getInitialState();
        const event: UserAggregate.UserCreatedEvent = {
          type: 'USER_CREATED',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: 'user-123',
          version: 1,
          name: 'John Doe',
          email: 'john@example.com',
        };

        const newState = projection.reduce(initialState, event);
        expect(newState.id).toBe('user-123');
        expect(newState.name).toBe('John Doe');
        expect(newState.email).toBe('john@example.com');
        expect(newState.isActive).toBe(true);
      });

      it('should reduce USER_NAME_CHANGED events', () => {
        const state: UserAggregate.UserState = {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const event: UserAggregate.UserNameChangedEvent = {
          type: 'USER_NAME_CHANGED',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: 'user-123',
          version: 2,
          previousName: 'John Doe',
          newName: 'Jane Doe',
        };

        const newState = projection.reduce(state, event);
        expect(newState.name).toBe('Jane Doe');
        expect(newState.updatedAt).toBe(event.timestamp);
      });
    });
  });

  describe('EventSourcingUtils', () => {
    it('should validate event ordering', () => {
      const validEvents: BaseEvent[] = [
        {
          type: 'EVENT_1',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: 'actor-1',
          version: 1,
        },
        {
          type: 'EVENT_2',
          timestamp: Date.now(),
          eventId: 'event-2',
          actorId: 'actor-1',
          version: 2,
        },
        {
          type: 'EVENT_3',
          timestamp: Date.now(),
          eventId: 'event-3',
          actorId: 'actor-1',
          version: 3,
        },
      ];

      const invalidEvents: BaseEvent[] = [
        {
          type: 'EVENT_1',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: 'actor-1',
          version: 1,
        },
        {
          type: 'EVENT_2',
          timestamp: Date.now(),
          eventId: 'event-2',
          actorId: 'actor-1',
          version: 3, // Gap in version
        },
      ];

      expect(EventSourcingUtils.validateEventOrder(validEvents)).toBe(true);
      expect(EventSourcingUtils.validateEventOrder(invalidEvents)).toBe(false);
    });

    it('should group events by actor', () => {
      const events: BaseEvent[] = [
        {
          type: 'EVENT_1',
          timestamp: Date.now(),
          eventId: 'event-1',
          actorId: 'actor-1',
          version: 1,
        },
        {
          type: 'EVENT_2',
          timestamp: Date.now(),
          eventId: 'event-2',
          actorId: 'actor-2',
          version: 1,
        },
        {
          type: 'EVENT_3',
          timestamp: Date.now(),
          eventId: 'event-3',
          actorId: 'actor-1',
          version: 2,
        },
      ];

      const groups = EventSourcingUtils.groupEventsByActor(events);
      expect(groups.size).toBe(2);
      expect(groups.get('actor-1')).toHaveLength(2);
      expect(groups.get('actor-2')).toHaveLength(1);
    });

    it('should create events with metadata', () => {
      const event = EventSourcingUtils.createEvent<UserAggregate.UserCreatedEvent>(
        'USER_CREATED',
        { name: 'John Doe', email: 'john@example.com' },
        'user-123',
        1,
        { correlationId: 'corr-123' }
      );

      expect(event.type).toBe('USER_CREATED');
      expect(event.name).toBe('John Doe');
      expect(event.email).toBe('john@example.com');
      expect(event.actorId).toBe('user-123');
      expect(event.version).toBe(1);
      expect(event.metadata?.correlationId).toBe('corr-123');
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.eventId).toMatch(/^evt-\d+-\w+$/);
    });

    it('should support time-travel debugging', async () => {
      const actorId = 'user-123';
      const projection = new UserAggregate.UserProjection();

      // Create user and make changes
      const userActor = new UserAggregate.UserActor(actorId, eventStore);
      await userActor.initialize();

      const creationTime = Date.now();
      await userActor.createUser('John Doe', 'john@example.com');

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await userActor.changeName('Jane Doe');

      // Get user state at creation time (should only include USER_CREATED event)
      const stateAtCreation = await EventSourcingUtils.getStateAtTime(
        actorId,
        eventStore,
        projection,
        creationTime + 5 // Just after creation but before name change
      );

      expect(stateAtCreation.name).toBe('John Doe');
      expect(stateAtCreation.email).toBe('john@example.com');
    });
  });
});
