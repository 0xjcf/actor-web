/**
 * @module actor-core/runtime/unit/fas-shared-contracts.test
 * @description Compatibility coverage for Actor-Web to FAS shared-contract mappings.
 */

import { describe, expect, it } from 'vitest';
import {
  actorAddressToFasActorAddress,
  actorCommandExecutionToFasRecord,
  actorMessagePayload,
  actorMessageToFasEventEnvelope,
  actorSnapshotPhase,
  actorSnapshotsToFasTransitionRecord,
  actorSnapshotToFasWorkflowSnapshot,
  type FasCommandExecutionRecord,
  type FasEventEnvelope,
  type FasWorkflowSnapshot,
} from '../integration/fas-shared-contracts.js';
import {
  actorMessageToRuntimeGatewayEventEnvelope,
  actorSnapshotsToRuntimeGatewayTransitionRecord,
  actorSnapshotToRuntimeGatewayWorkflowSnapshot,
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

describe('FAS shared-contracts compatibility', () => {
  it('maps Actor-Web messages to FAS EventEnvelope records', () => {
    const message = {
      type: 'WORKFLOW_COMMAND',
      taskId: 'task-1',
      retry: false,
      _timestamp: 101,
      _version: '1',
      _correlationId: 'corr-1',
      _sender: { id: 'actor-1', type: 'worker', path: '/actor-1' },
    };

    const envelope: FasEventEnvelope = actorMessageToFasEventEnvelope(message, {
      id: 'event-1',
      kind: 'command',
      occurredAt: '2026-04-22T12:00:00.000Z',
      sourceActor: 'actor-1',
      targetActor: 'actor-2',
      workflowId: 'workflow-1',
      taskId: 'task-1',
      causationId: 'cause-1',
    });
    const coreEnvelope = actorMessageToRuntimeGatewayEventEnvelope(message, {
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
    expect(envelope).toEqual(coreEnvelope);
    expect(envelope.payload).toEqual({ taskId: 'task-1', retry: false });
  });

  it('strips Actor-Web envelope fields from FAS payloads', () => {
    expect(
      actorMessagePayload({
        type: 'FACT_RECORDED',
        value: 42,
        _timestamp: 200,
        _version: '1',
        _correlationId: 'corr-2',
        _sender: { id: 'actor-2', type: 'system', path: '/actor-2' },
      })
    ).toEqual({ value: 42 });
  });

  it('maps Actor-Web snapshots to FAS WorkflowSnapshot records', () => {
    const snapshot: FasWorkflowSnapshot = actorSnapshotToFasWorkflowSnapshot({
      snapshot: createSnapshot({ review: 'running' }),
      workflowId: 'workflow-1',
      actorId: 'actor-1',
      taskId: 'task-1',
      taskTitle: 'Align contracts',
      createdAt: '2026-04-22T11:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
      correlationId: 'corr-1',
      branchName: 'codex/fas-contracts',
      baseBranch: 'main',
      lastEventType: 'WORKFLOW_COMMAND',
      notes: ['ready for verification'],
      artifacts: { review: 'docs/spikes/actor-web-adr-003-fas-integration-review.md' },
    });
    const coreSnapshot = actorSnapshotToRuntimeGatewayWorkflowSnapshot({
      snapshot: createSnapshot({ review: 'running' }),
      workflowId: 'workflow-1',
      actorId: 'actor-1',
      taskId: 'task-1',
      taskTitle: 'Align contracts',
      createdAt: '2026-04-22T11:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
      correlationId: 'corr-1',
      branchName: 'codex/fas-contracts',
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
      branchName: 'codex/fas-contracts',
      baseBranch: 'main',
      correlationId: 'corr-1',
      lastEventType: 'WORKFLOW_COMMAND',
      notes: ['ready for verification'],
      artifacts: { review: 'docs/spikes/actor-web-adr-003-fas-integration-review.md' },
    });
    expect(snapshot).toEqual(coreSnapshot);
  });

  it('maps Actor-Web snapshot transitions to FAS transition records', () => {
    const transition = actorSnapshotsToFasTransitionRecord({
      fromSnapshot: createSnapshot('queued', 'idle'),
      toSnapshot: createSnapshot('running', 'running'),
    });
    const coreTransition = actorSnapshotsToRuntimeGatewayTransitionRecord({
      fromSnapshot: createSnapshot('queued', 'idle'),
      toSnapshot: createSnapshot('running', 'running'),
    });

    expect(transition).toEqual({
      fromPhase: 'queued',
      toPhase: 'running',
      fromStatus: 'idle',
      toStatus: 'running',
    });
    expect(transition).toEqual(coreTransition);
  });

  it('maps Actor-Web command execution metadata to FAS command execution records', () => {
    const record: FasCommandExecutionRecord = actorCommandExecutionToFasRecord({
      commandType: 'pnpm architecture:check',
      requestedAt: '2026-04-22T12:00:00.000Z',
      completedAt: '2026-04-22T12:00:03.000Z',
      status: 'completed',
      actor: { id: 'actor-1', type: 'runtime', path: '/actor-1' },
      correlationId: 'corr-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
      artifacts: [{ key: 'stdout', path: 'artifacts/check.log' }],
      details: { exitCode: 0 },
    });

    expect(record).toEqual({
      commandType: 'pnpm architecture:check',
      requestedAt: '2026-04-22T12:00:00.000Z',
      completedAt: '2026-04-22T12:00:03.000Z',
      status: 'completed',
      actor: { id: 'actor-1', kind: 'runtime' },
      correlationId: 'corr-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
      artifacts: [{ key: 'stdout', path: 'artifacts/check.log' }],
      details: { exitCode: 0 },
    });
  });

  it('derives FAS actor addresses and readable phases without runtime effects', () => {
    expect(
      actorAddressToFasActorAddress({ id: 'actor-1', type: 'worker', path: '/actor-1' })
    ).toEqual({
      id: 'actor-1',
      kind: 'worker',
    });
    expect(actorSnapshotPhase({ parent: { child: 'ready' } })).toBe('parent.child.ready');
    expect(actorSnapshotPhase(null)).toBe('unknown');
  });
});
