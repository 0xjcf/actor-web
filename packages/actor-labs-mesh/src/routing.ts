import type { ActorAddress, RemoteMessageRouter } from '@actor-web/runtime';
import {
  createMeshMembershipState,
  isMeshNodeRouteable,
  type MeshMembershipRecord,
  type MeshMembershipState,
} from './membership.js';

export interface MeshRouteToken {
  readonly visitedNodes: readonly string[];
  readonly hopLimit: number;
}

export type MeshRouteFailureCode =
  | 'hop-limit-exhausted'
  | 'route-loop'
  | 'unsafe-node'
  | 'unreachable';

export type MeshRouteResult =
  | {
      readonly ok: true;
      readonly nextHop: string;
      readonly routeToken: MeshRouteToken;
    }
  | {
      readonly ok: false;
      readonly code: MeshRouteFailureCode;
      readonly message: string;
    };

export interface MeshRouteInput {
  readonly localNode: string;
  readonly targetNode: string;
  readonly connectedNodes: readonly string[];
  readonly membership: MeshMembershipState;
  readonly adjacency?: Readonly<Record<string, readonly string[]>>;
  readonly routeToken?: MeshRouteToken;
  readonly maxHops?: number;
}

export interface MeshRouterState {
  resolveNextHop(
    targetNode: string,
    connectedNodes: readonly string[],
    routeToken?: MeshRouteToken
  ): MeshRouteResult;
}

export interface MeshRemoteMessageRouterOptions {
  readonly routeToken?: MeshRouteToken;
}

export function createMeshRouteToken(localNode: string, maxHops = 16): MeshRouteToken {
  return {
    visitedNodes: [localNode],
    hopLimit: maxHops,
  };
}

export function resolveMeshNextHop(input: MeshRouteInput): MeshRouteResult {
  const token = input.routeToken ?? createMeshRouteToken(input.localNode, input.maxHops ?? 16);

  if (token.hopLimit <= 0) {
    return failRoute(
      'hop-limit-exhausted',
      `Mesh route from ${input.localNode} to ${input.targetNode} exhausted its hop limit.`
    );
  }

  if (token.visitedNodes.includes(input.targetNode)) {
    return failRoute(
      'route-loop',
      `Mesh route from ${input.localNode} to ${input.targetNode} would revisit ${input.targetNode}.`
    );
  }

  if (!isMeshNodeRouteable(input.membership, input.targetNode)) {
    return failRoute('unsafe-node', `Mesh target node ${input.targetNode} is not routeable.`);
  }

  const connected = new Set(input.connectedNodes);
  const visited = new Set(token.visitedNodes);

  if (connected.has(input.targetNode)) {
    return advanceRoute(input.targetNode, token);
  }

  const path = findRoutePath({
    localNode: input.localNode,
    targetNode: input.targetNode,
    connected,
    visited,
    membership: input.membership,
    adjacency: input.adjacency ?? {},
  });

  if (!path) {
    return failRoute(
      'unreachable',
      `Mesh target node ${input.targetNode} has no safe next hop from ${input.localNode}.`
    );
  }

  return advanceRoute(path[1] as string, token);
}

export function createMeshRemoteMessageRouter(
  mesh: MeshRouterState,
  options: MeshRemoteMessageRouterOptions = {}
): RemoteMessageRouter {
  return {
    async resolveNextHop(
      location: string,
      _address: ActorAddress,
      connectedNodes: readonly string[]
    ): Promise<string> {
      const route = mesh.resolveNextHop(location, connectedNodes, options.routeToken);
      if (!route.ok) {
        throw new Error(route.message);
      }

      return route.nextHop;
    },
  };
}

export function createMembershipFromRecords(
  records: readonly MeshMembershipRecord[]
): MeshMembershipState {
  return createMeshMembershipState(records);
}

function findRoutePath(input: {
  readonly localNode: string;
  readonly targetNode: string;
  readonly connected: ReadonlySet<string>;
  readonly visited: ReadonlySet<string>;
  readonly membership: MeshMembershipState;
  readonly adjacency: Readonly<Record<string, readonly string[]>>;
}): readonly string[] | undefined {
  const queue: string[][] = [];
  const seen = new Set<string>(input.visited);

  for (const neighbor of input.adjacency[input.localNode] ?? []) {
    if (!input.connected.has(neighbor) || input.visited.has(neighbor)) {
      continue;
    }

    if (!isMeshNodeRouteable(input.membership, neighbor)) {
      continue;
    }

    queue.push([input.localNode, neighbor]);
    seen.add(neighbor);
  }

  while (queue.length > 0) {
    const path = queue.shift() as string[];
    const node = path[path.length - 1] as string;
    if (node === input.targetNode) {
      return path;
    }

    for (const neighbor of input.adjacency[node] ?? []) {
      if (seen.has(neighbor) || input.visited.has(neighbor)) {
        continue;
      }

      if (!isMeshNodeRouteable(input.membership, neighbor)) {
        continue;
      }

      seen.add(neighbor);
      queue.push([...path, neighbor]);
    }
  }

  return undefined;
}

function advanceRoute(nextHop: string, token: MeshRouteToken): MeshRouteResult {
  // Safety net for unexpected findRoutePath hops; direct target revisits are guarded earlier.
  if (token.visitedNodes.includes(nextHop)) {
    return failRoute('route-loop', `Mesh route would revisit ${nextHop}.`);
  }

  return {
    ok: true,
    nextHop,
    routeToken: {
      visitedNodes: [...token.visitedNodes, nextHop],
      hopLimit: token.hopLimit - 1,
    },
  };
}

function failRoute(code: MeshRouteFailureCode, message: string): MeshRouteResult {
  return { ok: false, code, message };
}
