/**
 * @module actor-core/runtime/unit/runtime-gateway-projection.test
 * @description Coverage for the neutral runtime projection/envelope mappings.
 */

import { describe, expect, it } from 'vitest';
import {
  actorMessageToRuntimeGatewayEventEnvelope,
  actorSnapshotsToRuntimeGatewayTransitionRecord,
  actorSnapshotToRuntimeGatewayWorkflowSnapshot,
  deriveRuntimeGatewayPhase,
  runtimeGatewayEventEnvelopeToActorMessage,
  runtimeGatewayEventPayload,
} from '../runtime-gateway-projection.js';
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

describe('runtime gateway projection mappings', () => {
  it('maps Actor-Web messages to runtime event envelopes', () => {
    const message = {
      type: 'WORKFLOW_COMMAND',
      taskId: 'task-1',
      retry: false,
      _timestamp: 101,
      _version: '1',
      _correlationId: 'corr-1',
      _sender: { id: 'actor-1', type: 'worker', path: '/actor-1' },
    };

    const envelope = actorMessageToRuntimeGatewayEventEnvelope(message, {
      id: 'event-1',
      kind: 'command',
      occurredAt: '2026-04-22T12:00:00.000Z',
      sourceActor: 'actor-1',
      targetActor: 'actor-2',
      workflowId: 'workflow-1',
      taskId: 'task-1',
      causationId: 'cause-1',
    });

    expect(envelope).toMatchObject({
      id: 'event-1',
      kind: 'command',
      type: 'WORKFLOW_COMMAND',
      schemaVersion: 1,
      occurredAt: '2026-04-22T12:00:00.000Z',
      sourceActor: 'actor-1',
      targetActor: 'actor-2',
      workflowId: 'workflow-1',
      taskId: 'task-1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
    });
    expect(envelope.payload).toEqual({ taskId: 'task-1', retry: false });
  });

  it('round-trips an envelope back to an Actor-Web message', () => {
    const message = {
      type: 'FACT_RECORDED',
      value: 42,
      _timestamp: 200,
      _version: '1',
      _correlationId: 'corr-2',
      _sender: { id: 'actor-2', type: 'system', path: '/actor-2' },
    };
    const envelope = actorMessageToRuntimeGatewayEventEnvelope(message, {
      id: 'event-2',
      kind: 'fact',
      occurredAt: '2026-04-22T12:00:00.000Z',
      sourceActor: 'actor-2',
    });
    const restored = runtimeGatewayEventEnvelopeToActorMessage(envelope);

    expect(restored).toMatchObject({ type: 'FACT_RECORDED', value: 42, _correlationId: 'corr-2' });
  });

  it('strips Actor-Web envelope fields from event payloads', () => {
    expect(
      runtimeGatewayEventPayload({
        type: 'FACT_RECORDED',
        value: 42,
        _timestamp: 200,
        _version: '1',
        _correlationId: 'corr-2',
        _sender: { id: 'actor-2', type: 'system', path: '/actor-2' },
      })
    ).toEqual({ value: 42 });
  });

  it('maps Actor-Web snapshots to runtime workflow snapshots', () => {
    const snapshot = actorSnapshotToRuntimeGatewayWorkflowSnapshot({
      snapshot: createSnapshot({ review: 'running' }),
      workflowId: 'workflow-1',
      actorId: 'actor-1',
      taskId: 'task-1',
      taskTitle: 'Align contracts',
      createdAt: '2026-04-22T11:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
      correlationId: 'corr-1',
      branchName: 'fas/contracts',
      baseBranch: 'main',
      lastEventType: 'WORKFLOW_COMMAND',
      notes: ['ready for verification'],
      artifacts: { review: 'docs/spikes/actor-web-adr-003-fas-integration-review.md' },
    });

    expect(snapshot).toEqual({
      workflowId: 'workflow-1',
      actorId: 'actor-1',
      taskId: 'task-1',
      taskTitle: 'Align contracts',
      phase: 'review.running',
      status: 'running',
      createdAt: '2026-04-22T11:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
      branchName: 'fas/contracts',
      baseBranch: 'main',
      correlationId: 'corr-1',
      lastEventType: 'WORKFLOW_COMMAND',
      notes: ['ready for verification'],
      artifacts: { review: 'docs/spikes/actor-web-adr-003-fas-integration-review.md' },
    });
  });

  it('maps Actor-Web snapshot transitions to runtime transition records', () => {
    const transition = actorSnapshotsToRuntimeGatewayTransitionRecord({
      fromSnapshot: createSnapshot('queued', 'idle'),
      toSnapshot: createSnapshot('running', 'running'),
    });

    expect(transition).toEqual({
      fromPhase: 'queued',
      toPhase: 'running',
      fromStatus: 'idle',
      toStatus: 'running',
    });
  });

  it('derives readable phases without runtime effects', () => {
    expect(deriveRuntimeGatewayPhase({ parent: { child: 'ready' } })).toBe('parent.child.ready');
    expect(deriveRuntimeGatewayPhase(null)).toBe('unknown');
  });
});
