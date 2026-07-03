import { startRuntime } from '@actor-web/runtime';
import { defineActorWebTopology, node } from '@actor-web/runtime/topology';
import { describe, expect, it } from 'vitest';
import {
  createEventStoreLatticeJournal,
  createLatticeState,
  reduceLatticeMessage,
  replayLatticeState,
} from '../lattice-actor.js';
import type { ArtifactRecord, LatticeMessage, RegisteredDependency } from '../protocol.js';
import { lattice } from '../topology.js';

describe('lattice journal seam', () => {
  const dependency: RegisteredDependency = {
    dependencyId: 'workspace:planner:0',
    lattice: 'workspace',
    actorKey: 'planner',
    requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
    mode: 'once',
  };
  const artifact: ArtifactRecord = {
    artifactId: 'research.summary:task-1781273347589@1',
    type: 'research.summary',
    key: 'task-1781273347589',
    version: 1,
    payload: { ready: true },
    producer: 'researcher',
    publishedAt: 100,
    contentHash: 'hash',
  };

  it('replays artifact and dependency journal events into the same delivered activation state', async () => {
    const journal = createEventStoreLatticeJournal();
    const initial = createLatticeState('workspace');
    const registered = reduceLatticeMessage(initial, {
      type: 'REGISTER_DEPENDENCY',
      dependency,
      registeredAt: 50,
    });
    const published = reduceLatticeMessage(registered.state, {
      type: 'PUBLISH_ARTIFACT',
      artifact,
    });

    await journal.append(
      'workspace',
      [...registered.journalEvents, ...published.journalEvents],
      initial.journalVersion
    );

    const replayed = await replayLatticeState('workspace', journal);

    expect(replayed.dependencies).toEqual(published.state.dependencies);
    expect(replayed.artifacts.artifacts).toEqual(published.state.artifacts.artifacts);
    expect(replayed.activations).toEqual(published.state.activations);
    expect(replayed.deliveredSatisfactionKeys).toEqual(published.state.deliveredSatisfactionKeys);
    expect(replayed.journalVersion).toBe(2);
  });

  it('replays dependency registrations in the same sorted order as the live reducer', async () => {
    const journal = createEventStoreLatticeJournal();
    const initial = createLatticeState('workspace');
    const laterSortedDependency: RegisteredDependency = {
      dependencyId: 'z-dependency',
      lattice: 'workspace',
      actorKey: 'planner',
      requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
      mode: 'once',
    };
    const earlierSortedDependency: RegisteredDependency = {
      dependencyId: 'a-dependency',
      lattice: 'workspace',
      actorKey: 'planner',
      requires: [{ type: 'review.finding', key: 'task-1781273347589' }],
      mode: 'once',
    };
    const liveLater = reduceLatticeMessage(initial, {
      type: 'REGISTER_DEPENDENCY',
      dependency: laterSortedDependency,
      registeredAt: 50,
    });
    const liveEarlier = reduceLatticeMessage(liveLater.state, {
      type: 'REGISTER_DEPENDENCY',
      dependency: earlierSortedDependency,
      registeredAt: 60,
    });

    await journal.append(
      'workspace',
      [
        {
          kind: 'DEPENDENCY_REGISTERED',
          dependency: laterSortedDependency,
          registeredAt: 50,
        },
        {
          kind: 'DEPENDENCY_REGISTERED',
          dependency: earlierSortedDependency,
          registeredAt: 60,
        },
      ],
      initial.journalVersion
    );

    const replayed = await replayLatticeState('workspace', journal);

    expect(replayed.dependencies.map((dependency) => dependency.dependencyId)).toEqual(
      liveEarlier.state.dependencies.map((dependency) => dependency.dependencyId)
    );
    expect(replayed.dependencies.map((dependency) => dependency.dependencyId)).toEqual([
      'a-dependency',
      'z-dependency',
    ]);
  });

  it('replays activation acknowledgements after restart-created activations exist', async () => {
    const journal = createEventStoreLatticeJournal();
    const initial = createLatticeState('workspace');
    const registered = reduceLatticeMessage(initial, {
      type: 'REGISTER_DEPENDENCY',
      dependency,
      registeredAt: 50,
    });
    const published = reduceLatticeMessage(registered.state, {
      type: 'PUBLISH_ARTIFACT',
      artifact,
    });
    const activationId = published.state.activations[0]?.activationId;
    const acknowledged = reduceLatticeMessage(published.state, {
      type: 'ACK_ACTIVATION',
      activationId: activationId ?? 'missing',
      acknowledgedAt: 110,
    });

    await journal.append(
      'workspace',
      [...registered.journalEvents, ...published.journalEvents, ...acknowledged.journalEvents],
      initial.journalVersion
    );

    const replayed = await replayLatticeState('workspace', journal);

    expect(replayed.activations).toEqual(acknowledged.state.activations);
    expect(replayed.activations[0]?.status).toBe('acknowledged');
    expect(replayed.activations[0]?.acknowledgedAt).toBe(110);
    expect(replayed.journalVersion).toBe(3);
  });

  it('hydrates a topology-created lattice actor from its journal before handling messages', async () => {
    const journal = createEventStoreLatticeJournal();
    await journal.append('workflow-lattice', [{ kind: 'ARTIFACT_PUBLISHED', artifact }], 0);
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        workspace: lattice({ id: 'workflow-lattice', node: 'local', journal }),
      },
    });
    const runtime = await startRuntime(topology);

    try {
      const workspace = runtime.requireActor('workspace') as unknown as {
        ask<TReply>(message: LatticeMessage): Promise<TReply>;
      };
      const artifacts = await workspace.ask<readonly ArtifactRecord[]>({
        type: 'QUERY_ARTIFACTS',
        query: { history: true },
      });

      expect(artifacts).toEqual([artifact]);
    } finally {
      await runtime.stop();
    }
  });
});
