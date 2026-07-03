/**
 * @module actor-core/runtime/tests/event-sourcing.test
 * @description Contract tests for the lattice journal seam
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as EventSourcingModule from '../event-sourcing.js';
import { type BaseEvent, createEventStore, type EventStore } from '../event-sourcing.js';

const createEvent = (
  streamId: string,
  version: number,
  overrides: Partial<BaseEvent> = {}
): BaseEvent => ({
  type: `EVENT_${version}`,
  timestamp: version * 1000,
  eventId: `event-${version}`,
  actorId: streamId,
  version,
  ...overrides,
});

describe('event-sourcing journal seam', () => {
  let eventStore: EventStore;

  beforeEach(() => {
    eventStore = createEventStore();
  });

  it('keeps the module surface limited to the journal contract', () => {
    expect(EventSourcingModule).not.toHaveProperty('EventSourcedActor');
    expect(EventSourcingModule).not.toHaveProperty('UserAggregate');
    expect(EventSourcingModule).not.toHaveProperty('EventSourcingUtils');
  });

  it('appends contiguous versions and replays from an exclusive boundary version', async () => {
    const streamId = 'journal-stream';
    const events = [createEvent(streamId, 1), createEvent(streamId, 2), createEvent(streamId, 3)];

    await eventStore.append(streamId, events, 0);

    await expect(eventStore.getEvents(streamId)).resolves.toEqual(events);
    await expect(eventStore.getEvents(streamId, 2)).resolves.toEqual([events[2]]);
  });

  it('rejects appends with stale expected versions', async () => {
    const streamId = 'journal-stream';

    await eventStore.append(streamId, [createEvent(streamId, 1)], 0);

    await expect(eventStore.append(streamId, [createEvent(streamId, 2)], 0)).rejects.toThrow(
      'Concurrency conflict: expected version 0, got 1'
    );
  });

  it('rejects version gaps within an append batch', async () => {
    const streamId = 'journal-stream';
    const invalidBatch = [createEvent(streamId, 1), createEvent(streamId, 3)];

    await expect(eventStore.append(streamId, invalidBatch, 0)).rejects.toThrow(
      'Invalid event version: expected 2, got 3'
    );
  });

  it('round-trips snapshots and ignores mismatched snapshot versions', async () => {
    const streamId = 'journal-stream';
    const snapshot = { cursor: 'v2', state: { count: 2 } };

    await eventStore.saveSnapshot(streamId, snapshot, 2);

    await expect(eventStore.getSnapshot(streamId)).resolves.toEqual(snapshot);
    await expect(eventStore.getSnapshot(streamId, 2)).resolves.toEqual(snapshot);
    await expect(eventStore.getSnapshot(streamId, 3)).resolves.toBeUndefined();
  });
});
