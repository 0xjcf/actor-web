import type { ActorAddress } from '@actor-web/runtime';
import { describe, expect, it } from 'vitest';
import {
  applyMeshDirectoryEntry,
  compareMeshIncarnation,
  createLabsMesh,
  createMeshDirectoryState,
  createMeshMembershipState,
  createMeshRemoteMessageRouter,
  mergeMeshMembershipRecord,
  resolveMeshDirectoryLocation,
  resolveMeshNextHop,
} from '../index.js';

const plannerAddress = 'actor://node-b/planner' as ActorAddress;

describe('@actor-web/labs-mesh membership', () => {
  it('uses incarnation ordering so a restarted node supersedes stale liveness', () => {
    const suspected = mergeMeshMembershipRecord(createMeshMembershipState(), {
      nodeAddress: 'node-b',
      incarnation: 1,
      state: 'suspect',
      seenAt: 100,
    }).state;

    const restarted = mergeMeshMembershipRecord(suspected, {
      nodeAddress: 'node-b',
      incarnation: 2,
      state: 'alive',
      seenAt: 110,
    }).state;

    expect(restarted.records['node-b']).toMatchObject({
      incarnation: 2,
      state: 'alive',
      seenAt: 110,
    });
  });

  it('keeps terminal node-down records from being weakened by same-incarnation gossip', () => {
    const dead = mergeMeshMembershipRecord(createMeshMembershipState(), {
      nodeAddress: 'node-b',
      incarnation: 3,
      state: 'dead',
      seenAt: 100,
    }).state;

    const staleAlive = mergeMeshMembershipRecord(dead, {
      nodeAddress: 'node-b',
      incarnation: 3,
      state: 'alive',
      seenAt: 120,
    });

    expect(staleAlive.accepted).toBe(false);
    expect(staleAlive.state.records['node-b']).toMatchObject({
      incarnation: 3,
      state: 'dead',
    });
  });

  it('orders mixed numeric-looking incarnations consistently', () => {
    expect(compareMeshIncarnation('5', '10')).toBe(-1);
    expect(compareMeshIncarnation(5, '10')).toBe(-1);
    expect(compareMeshIncarnation('5', 10)).toBe(-1);
    expect(compareMeshIncarnation('10', 'node-epoch')).toBe(-1);
    expect(compareMeshIncarnation('node-epoch', 10)).toBe(1);
  });
});

describe('@actor-web/labs-mesh directory propagation', () => {
  it('accepts newer owner incarnation and registration versions and rejects stale resurrection', () => {
    const first = applyMeshDirectoryEntry(createMeshDirectoryState(), {
      address: plannerAddress,
      ownerNode: 'node-b',
      ownerIncarnation: 1,
      version: 1,
      updatedAt: 100,
    }).state;
    const tombstoned = applyMeshDirectoryEntry(first, {
      address: plannerAddress,
      ownerNode: 'node-b',
      ownerIncarnation: 2,
      version: 2,
      updatedAt: 120,
      tombstone: true,
    }).state;
    const stale = applyMeshDirectoryEntry(tombstoned, {
      address: plannerAddress,
      ownerNode: 'node-b',
      ownerIncarnation: 1,
      version: 3,
      updatedAt: 130,
    });

    expect(stale.accepted).toBe(false);
    expect(resolveMeshDirectoryLocation(tombstoned, plannerAddress)).toBeUndefined();
    expect(tombstoned.entries[plannerAddress]).toMatchObject({
      ownerIncarnation: 2,
      tombstone: true,
    });
  });

  it('rejects a directory entry from a different owner node', () => {
    const first = applyMeshDirectoryEntry(createMeshDirectoryState(), {
      address: plannerAddress,
      ownerNode: 'node-b',
      ownerIncarnation: 1,
      version: 1,
      updatedAt: 100,
    }).state;

    const conflicting = applyMeshDirectoryEntry(first, {
      address: plannerAddress,
      ownerNode: 'node-c',
      ownerIncarnation: 1,
      version: 2,
      updatedAt: 110,
    });

    expect(conflicting).toMatchObject({ accepted: false, code: 'owner-conflict' });
  });

  it('honors ttl when resolving a directory location through the mesh shell', () => {
    const mesh = createLabsMesh({
      localNode: 'node-a',
      directory: [
        {
          address: plannerAddress,
          ownerNode: 'node-b',
          ownerIncarnation: 1,
          version: 1,
          updatedAt: 100,
          ttl: 150,
        },
      ],
    });

    expect(mesh.resolveDirectoryLocation(plannerAddress, 149)).toBe('node-b');
    expect(mesh.resolveDirectoryLocation(plannerAddress, 150)).toBeUndefined();
  });
});

describe('@actor-web/labs-mesh routing', () => {
  it('selects the first safe next hop toward an indirectly reachable owner', () => {
    const membership = createMeshMembershipState([
      { nodeAddress: 'node-a', incarnation: 1, state: 'alive', seenAt: 1 },
      { nodeAddress: 'node-relay', incarnation: 1, state: 'alive', seenAt: 1 },
      { nodeAddress: 'node-b', incarnation: 1, state: 'alive', seenAt: 1 },
    ]);

    const route = resolveMeshNextHop({
      localNode: 'node-a',
      targetNode: 'node-b',
      connectedNodes: ['node-relay'],
      membership,
      adjacency: {
        'node-a': ['node-relay'],
        'node-relay': ['node-a', 'node-b'],
        'node-b': ['node-relay'],
      },
      routeToken: { visitedNodes: ['node-a'], hopLimit: 4 },
    });

    expect(route).toEqual({
      ok: true,
      nextHop: 'node-relay',
      routeToken: { visitedNodes: ['node-a', 'node-relay'], hopLimit: 3 },
    });
  });

  it('fails closed when routing would revisit a node or exhaust the hop limit', () => {
    const membership = createMeshMembershipState([
      { nodeAddress: 'node-a', incarnation: 1, state: 'alive', seenAt: 1 },
      { nodeAddress: 'node-relay', incarnation: 1, state: 'alive', seenAt: 1 },
      { nodeAddress: 'node-b', incarnation: 1, state: 'alive', seenAt: 1 },
    ]);

    expect(
      resolveMeshNextHop({
        localNode: 'node-a',
        targetNode: 'node-b',
        connectedNodes: ['node-relay'],
        membership,
        adjacency: {
          'node-a': ['node-relay'],
          'node-relay': ['node-a', 'node-b'],
        },
        routeToken: { visitedNodes: ['node-a', 'node-relay'], hopLimit: 4 },
      })
    ).toMatchObject({ ok: false, code: 'route-loop' });

    expect(
      resolveMeshNextHop({
        localNode: 'node-a',
        targetNode: 'node-b',
        connectedNodes: ['node-relay'],
        membership,
        adjacency: {
          'node-a': ['node-relay'],
          'node-relay': ['node-b'],
        },
        routeToken: { visitedNodes: ['node-a'], hopLimit: 0 },
      })
    ).toMatchObject({ ok: false, code: 'hop-limit-exhausted' });
  });

  it('reports unreachable instead of a loop when no explored path revisits a node', () => {
    const membership = createMeshMembershipState([
      { nodeAddress: 'node-a', incarnation: 1, state: 'alive', seenAt: 1 },
      { nodeAddress: 'node-relay', incarnation: 1, state: 'alive', seenAt: 1 },
      { nodeAddress: 'node-b', incarnation: 1, state: 'alive', seenAt: 1 },
      { nodeAddress: 'node-old', incarnation: 1, state: 'alive', seenAt: 1 },
    ]);

    expect(
      resolveMeshNextHop({
        localNode: 'node-a',
        targetNode: 'node-b',
        connectedNodes: ['node-relay', 'node-old'],
        membership,
        adjacency: {
          'node-a': ['node-relay'],
          'node-relay': [],
        },
        routeToken: { visitedNodes: ['node-a', 'node-old'], hopLimit: 4 },
      })
    ).toMatchObject({ ok: false, code: 'unreachable' });
  });

  it('adapts route facts to the runtime RemoteMessageRouter seam', async () => {
    const mesh = createLabsMesh({
      localNode: 'node-a',
      membership: [
        { nodeAddress: 'node-a', incarnation: 1, state: 'alive', seenAt: 1 },
        { nodeAddress: 'node-relay', incarnation: 1, state: 'alive', seenAt: 1 },
        { nodeAddress: 'node-b', incarnation: 1, state: 'alive', seenAt: 1 },
      ],
      adjacency: {
        'node-a': ['node-relay'],
        'node-relay': ['node-b'],
      },
    });
    const router = createMeshRemoteMessageRouter(mesh);

    await expect(router.resolveNextHop('node-b', plannerAddress, ['node-relay'])).resolves.toBe(
      'node-relay'
    );
  });

  it('rejects through the runtime RemoteMessageRouter seam when no route exists', async () => {
    const mesh = createLabsMesh({
      localNode: 'node-a',
      membership: [
        { nodeAddress: 'node-a', incarnation: 1, state: 'alive', seenAt: 1 },
        { nodeAddress: 'node-b', incarnation: 1, state: 'alive', seenAt: 1 },
      ],
      adjacency: {},
    });
    const router = createMeshRemoteMessageRouter(mesh);

    await expect(router.resolveNextHop('node-b', plannerAddress, [])).rejects.toThrow(
      'Mesh target node node-b has no safe next hop from node-a.'
    );
  });
});
