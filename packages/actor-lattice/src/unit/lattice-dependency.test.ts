import { describe, expect, it } from 'vitest';
import { createArtifactStore, publishArtifact } from '../artifact.js';
import {
  createRegisteredDependency,
  deriveDependencyId,
  evaluateDependencySatisfaction,
} from '../dependency.js';

describe('lattice dependencies', () => {
  it('derives a stable dependency id and satisfaction key', () => {
    const dependency = createRegisteredDependency({
      lattice: 'workspace',
      actorKey: 'planner',
      requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
      mode: 'once',
    });
    const published = publishArtifact(createArtifactStore(), {
      type: 'research.summary',
      key: 'task-1781273347589',
      payload: { ready: true },
      producer: 'researcher',
      publishedAt: 100,
    });

    const satisfaction = evaluateDependencySatisfaction(published.store.artifacts, dependency);

    expect(dependency.dependencyId).toBe(
      deriveDependencyId('workspace', 'planner', [
        { type: 'research.summary', key: 'task-1781273347589' },
      ])
    );
    expect(satisfaction?.satisfactionKey).toBe('research.summary:task-1781273347589@1');
  });

  it('keeps fallback dependency ids stable when matcher order changes', () => {
    const first = createRegisteredDependency({
      lattice: 'workspace',
      actorKey: 'planner',
      requires: [
        { type: 'research.summary', key: 'task-1781273347589' },
        { type: 'review.finding', fields: { severity: 'high' } },
      ],
      mode: 'once',
    });
    const reordered = createRegisteredDependency({
      lattice: 'workspace',
      actorKey: 'planner',
      requires: [
        { type: 'review.finding', fields: { severity: 'high' } },
        { type: 'research.summary', key: 'task-1781273347589' },
      ],
      mode: 'once',
    });
    const explicit = createRegisteredDependency({
      lattice: 'workspace',
      actorKey: 'planner',
      dependencyId: 'planner-inputs',
      requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
      mode: 'once',
    });

    expect(reordered.dependencyId).toBe(first.dependencyId);
    expect(explicit.dependencyId).toBe('planner-inputs');
  });
});
