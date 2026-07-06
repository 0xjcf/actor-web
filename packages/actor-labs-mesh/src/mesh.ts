import type { RuntimePeerDiscoveryRecord } from '@actor-web/runtime';
import {
  applyMeshDirectoryEntry,
  createMeshDirectoryState,
  exportMeshDirectoryEntries,
  type MeshDirectoryEntry,
  type MeshDirectoryState,
  mergeMeshDirectoryEntries,
  resolveMeshDirectoryLocation,
} from './directory.js';
import {
  createMeshMembershipState,
  type MeshMembershipRecord,
  type MeshMembershipState,
  mergeMeshMembershipRecord,
} from './membership.js';
import {
  type MeshRouteResult,
  type MeshRouterState,
  type MeshRouteToken,
  resolveMeshNextHop,
} from './routing.js';

export interface LabsMeshOptions {
  readonly localNode: string;
  readonly membership?: readonly MeshMembershipRecord[];
  readonly directory?: readonly MeshDirectoryEntry[];
  readonly adjacency?: Readonly<Record<string, readonly string[]>>;
}

export interface LabsMeshPeerRecordOptions {
  readonly seenAt: number;
  readonly state?: MeshMembershipRecord['state'];
}

export class LabsMesh implements MeshRouterState {
  readonly localNode: string;
  private membership: MeshMembershipState;
  private directory: MeshDirectoryState;
  private adjacencyMap: Readonly<Record<string, readonly string[]>>;

  constructor(options: LabsMeshOptions) {
    this.localNode = options.localNode;
    this.membership = createMeshMembershipState(options.membership);
    this.directory = createMeshDirectoryState(options.directory);
    this.adjacencyMap = options.adjacency ?? {};
  }

  get membershipState(): MeshMembershipState {
    return this.membership;
  }

  get directoryState(): MeshDirectoryState {
    return this.directory;
  }

  get adjacency(): Readonly<Record<string, readonly string[]>> {
    return this.adjacencyMap;
  }

  applyMembership(record: MeshMembershipRecord): void {
    this.membership = mergeMeshMembershipRecord(this.membership, record).state;
  }

  recordPeer(peer: RuntimePeerDiscoveryRecord, options: LabsMeshPeerRecordOptions): void {
    this.applyMembership({
      nodeAddress: peer.nodeAddress,
      incarnation: peer.incarnation ?? 0,
      state: options.state ?? 'alive',
      seenAt: options.seenAt,
      ...(peer.metadata ? { metadata: peer.metadata } : {}),
    });
  }

  applyDirectoryEntry(entry: MeshDirectoryEntry): void {
    this.directory = applyMeshDirectoryEntry(this.directory, entry).state;
  }

  mergeDirectoryEntries(entries: readonly MeshDirectoryEntry[]): void {
    this.directory = mergeMeshDirectoryEntries(this.directory, entries);
  }

  exportDirectoryEntries(): MeshDirectoryEntry[] {
    return exportMeshDirectoryEntries(this.directory);
  }

  resolveDirectoryLocation(
    address: MeshDirectoryEntry['address'],
    now: number = Date.now()
  ): string | undefined {
    return resolveMeshDirectoryLocation(this.directory, address, { now });
  }

  setAdjacency(nodeAddress: string, peers: readonly string[]): void {
    this.adjacencyMap = {
      ...this.adjacencyMap,
      [nodeAddress]: [...peers],
    };
  }

  resolveNextHop(
    targetNode: string,
    connectedNodes: readonly string[],
    routeToken?: MeshRouteToken
  ): MeshRouteResult {
    return resolveMeshNextHop({
      localNode: this.localNode,
      targetNode,
      connectedNodes,
      membership: this.membership,
      adjacency: this.adjacencyMap,
      ...(routeToken ? { routeToken } : {}),
    });
  }
}

export function createLabsMesh(options: LabsMeshOptions): LabsMesh {
  return new LabsMesh(options);
}
