/**
 * @module actor-core/runtime/unit/runtime-projection.test
 * @description Coverage for the neutral runtime projection/envelope mappings.
 */

import { describe, expect, it } from 'vitest';
import {
  actorEventPayload,
  actorMessageToEventEnvelope,
  actorSnapshotsToTransitionRecord,
  actorSnapshotToRuntimeSnapshot,
  deriveStateLabel,
  eventEnvelopeToActorMessage,
} from '../runtime-projection.js';
import type { ActorSnapshot } from '../types.js';

function createSnapshot(
  value: unknown,
  status: ActorSnapshot['status'] = 'running'
): ActorSnapshot {
  return {
    context: {},
    value,
    status,
    matches: () => false,
    can: () => false,
    hasTag: () => false,
    toJSON: () => ({ value, status }),
  };
}

describe('runtime projection mappings', () => {
  it('maps Actor-Web messages to neutral event envelopes', () => {
    const message = {
      type: 'SHIPMENT_DISPATCHED',
      lane: 'east',
      retry: false,
      _timestamp: 101,
      _version: '1',
      _correlationId: 'corr-1',
      _sender: { id: 'actor-1', kind: 'actor' as const, path: '/actor-1' },
    };

    const envelope = actorMessageToEventEnvelope(message, {
      id: 'event-1',
      kind: 'command',
      occurredAt: '2026-04-22T12:00:00.000Z',
      sourceActor: 'actor-1',
      targetActor: 'actor-2',
      causationId: 'cause-1',
    });

    expect(envelope).toEqual({
      id: 'event-1',
      kind: 'command',
      type: 'SHIPMENT_DISPATCHED',
      schemaVersion: 1,
      occurredAt: '2026-04-22T12:00:00.000Z',
      sourceActor: 'actor-1',
      targetActor: 'actor-2',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      payload: { lane: 'east', retry: false },
    });
  });

  it('round-trips an envelope back to an Actor-Web message', () => {
    const message = {
      type: 'FACT_RECORDED',
      value: 42,
      _timestamp: 200,
      _version: '1',
      _correlationId: 'corr-2',
      _sender: { id: 'actor-2', kind: 'actor' as const, path: '/actor-2' },
    };
    const envelope = actorMessageToEventEnvelope(message, {
      id: 'event-2',
      kind: 'fact',
      occurredAt: '2026-04-22T12:00:00.000Z',
      sourceActor: 'actor-2',
    });
    const restored = eventEnvelopeToActorMessage(envelope);

    expect(restored).toMatchObject({ type: 'FACT_RECORDED', value: 42, _correlationId: 'corr-2' });
  });

  it('strips Actor-Web envelope fields from event payloads', () => {
    expect(
      actorEventPayload({
        type: 'FACT_RECORDED',
        value: 42,
        _timestamp: 200,
        _version: '1',
        _correlationId: 'corr-2',
        _sender: { id: 'actor-2', kind: 'actor', path: '/actor-2' },
      })
    ).toEqual({ value: 42 });
  });

  it('maps Actor-Web snapshots to neutral runtime snapshots', () => {
    const snapshot = actorSnapshotToRuntimeSnapshot({
      snapshot: createSnapshot({ review: 'running' }),
      actorId: 'actor-1',
      createdAt: '2026-04-22T11:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
      correlationId: 'corr-1',
      lastEventType: 'SHIPMENT_DISPATCHED',
    });

    expect(snapshot).toEqual({
      actorId: 'actor-1',
      status: 'running',
      stateLabel: 'review.running',
      createdAt: '2026-04-22T11:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
      correlationId: 'corr-1',
      lastEventType: 'SHIPMENT_DISPATCHED',
    });
  });

  it('maps Actor-Web snapshot transitions to neutral transition records', () => {
    const transition = actorSnapshotsToTransitionRecord({
      fromSnapshot: createSnapshot('queued', 'idle'),
      toSnapshot: createSnapshot('running', 'running'),
    });

    expect(transition).toEqual({
      fromState: 'queued',
      toState: 'running',
      fromStatus: 'idle',
      toStatus: 'running',
    });
  });

  it('derives readable state labels without runtime effects', () => {
    expect(deriveStateLabel({ parent: { child: 'ready' } })).toBe('parent.child.ready');
    expect(deriveStateLabel(null)).toBe('unknown');
  });
});
