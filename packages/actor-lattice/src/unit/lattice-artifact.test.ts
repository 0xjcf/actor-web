import { describe, expect, it } from 'vitest';
import { createArtifactStore, publishArtifact, queryArtifacts } from '../artifact.js';

describe('lattice artifact store', () => {
  it('stores typed, keyed, versioned artifacts and keeps the latest-per-key head', () => {
    const first = publishArtifact(createArtifactStore(), {
      type: 'research.summary',
      key: 'task-1781273347589',
      payload: { value: 1 },
      producer: 'planner',
      publishedAt: 100,
    });
    const second = publishArtifact(first.store, {
      type: 'research.summary',
      key: 'task-1781273347589',
      payload: { value: 2 },
      producer: 'planner',
      publishedAt: 200,
    });

    expect(first.artifact.version).toBe(1);
    expect(second.artifact.version).toBe(2);
    expect(queryArtifacts(second.store, { history: true })).toHaveLength(2);
    expect(queryArtifacts(second.store).at(-1)?.payload).toEqual({ value: 2 });
  });

  it('idempotently ignores republishing the same content hash for the same identity', () => {
    const first = publishArtifact(createArtifactStore(), {
      type: 'research.summary',
      key: 'task-1781273347589',
      payload: { value: 1 },
      producer: 'planner',
      publishedAt: 100,
      contentHash: 'same',
    });
    const second = publishArtifact(first.store, {
      type: 'research.summary',
      key: 'task-1781273347589',
      payload: { value: 1 },
      producer: 'planner',
      publishedAt: 200,
      contentHash: 'same',
    });

    expect(second.published).toBe(false);
    expect(queryArtifacts(second.store, { history: true })).toHaveLength(1);
  });
});
