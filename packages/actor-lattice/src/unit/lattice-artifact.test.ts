import { describe, expect, it } from 'vitest';
import {
  createArtifactStore,
  createContentHash,
  publishArtifact,
  queryArtifacts,
} from '../artifact.js';

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
      payload: { value: 1, nested: { alpha: true, beta: ['x', 'y'] } },
      producer: 'planner',
      publishedAt: 100,
    });
    const second = publishArtifact(first.store, {
      type: 'research.summary',
      key: 'task-1781273347589',
      payload: { nested: { beta: ['x', 'y'], alpha: true }, value: 1 },
      producer: 'planner',
      publishedAt: 200,
    });

    expect(second.published).toBe(false);
    expect(queryArtifacts(second.store, { history: true })).toHaveLength(1);
  });

  it('creates the same content hash for semantically identical payloads with reordered keys', () => {
    const first = createContentHash(
      { value: 1, nested: { alpha: true, beta: ['x', 'y'] } },
      { tags: { phase: 'draft', owner: 'planner' } }
    );
    const second = createContentHash(
      { nested: { beta: ['x', 'y'], alpha: true }, value: 1 },
      { tags: { owner: 'planner', phase: 'draft' } }
    );

    expect(first).toBe(second);
  });

  it('creates a different content hash when the semantic payload changes', () => {
    const first = createContentHash(
      { value: 1, nested: { alpha: true, beta: ['x', 'y'] } },
      { tags: { owner: 'planner' } }
    );
    const second = createContentHash(
      { value: 2, nested: { alpha: true, beta: ['x', 'y'] } },
      { tags: { owner: 'planner' } }
    );

    expect(first).not.toBe(second);
  });
});
