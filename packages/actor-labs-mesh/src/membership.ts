export type MeshIncarnation = number | string;

export type MeshMembershipStatus = 'alive' | 'suspect' | 'dead' | 'left';

export interface MeshMembershipRecord {
  readonly nodeAddress: string;
  readonly incarnation: MeshIncarnation;
  readonly state: MeshMembershipStatus;
  readonly seenAt: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface MeshMembershipState {
  readonly records: Readonly<Record<string, MeshMembershipRecord>>;
}

export type MeshMembershipMergeCode =
  | 'accepted'
  | 'stale-incarnation'
  | 'weaker-state'
  | 'same-record';

export interface MeshMembershipMergeResult {
  readonly accepted: boolean;
  readonly code: MeshMembershipMergeCode;
  readonly state: MeshMembershipState;
}

const MEMBERSHIP_STATE_RANK: Record<MeshMembershipStatus, number> = {
  alive: 0,
  suspect: 1,
  dead: 2,
  left: 3,
};

export function createMeshMembershipState(
  records: readonly MeshMembershipRecord[] = []
): MeshMembershipState {
  return records.reduce<MeshMembershipState>(
    (state, record) => mergeMeshMembershipRecord(state, record).state,
    { records: {} }
  );
}

export function mergeMeshMembershipRecord(
  state: MeshMembershipState,
  record: MeshMembershipRecord
): MeshMembershipMergeResult {
  const current = state.records[record.nodeAddress];

  if (!current) {
    return acceptMembershipRecord(state, record, 'accepted');
  }

  const incarnationOrder = compareMeshIncarnation(record.incarnation, current.incarnation);
  if (incarnationOrder < 0) {
    return { accepted: false, code: 'stale-incarnation', state };
  }

  if (incarnationOrder === 0) {
    const nextRank = MEMBERSHIP_STATE_RANK[record.state];
    const currentRank = MEMBERSHIP_STATE_RANK[current.state];
    if (nextRank < currentRank) {
      return { accepted: false, code: 'weaker-state', state };
    }

    if (nextRank === currentRank && record.seenAt <= current.seenAt) {
      return { accepted: false, code: 'same-record', state };
    }
  }

  return acceptMembershipRecord(state, record, 'accepted');
}

export function getMeshMembershipRecord(
  state: MeshMembershipState,
  nodeAddress: string
): MeshMembershipRecord | undefined {
  return state.records[nodeAddress];
}

export function isMeshNodeRouteable(state: MeshMembershipState, nodeAddress: string): boolean {
  return state.records[nodeAddress]?.state === 'alive';
}

export function compareMeshIncarnation(left: MeshIncarnation, right: MeshIncarnation): number {
  const leftOrder = toIncarnationOrder(left);
  const rightOrder = toIncarnationOrder(right);

  if (leftOrder.numeric !== undefined && rightOrder.numeric !== undefined) {
    const numericOrder = Math.sign(leftOrder.numeric - rightOrder.numeric);
    return numericOrder === 0 ? leftOrder.text.localeCompare(rightOrder.text) : numericOrder;
  }

  if (leftOrder.numeric !== undefined) {
    return -1;
  }

  if (rightOrder.numeric !== undefined) {
    return 1;
  }

  return leftOrder.text.localeCompare(rightOrder.text);
}

function acceptMembershipRecord(
  state: MeshMembershipState,
  record: MeshMembershipRecord,
  code: MeshMembershipMergeCode
): MeshMembershipMergeResult {
  return {
    accepted: true,
    code,
    state: {
      records: {
        ...state.records,
        [record.nodeAddress]: cloneMembershipRecord(record),
      },
    },
  };
}

function cloneMembershipRecord(record: MeshMembershipRecord): MeshMembershipRecord {
  return {
    nodeAddress: record.nodeAddress,
    incarnation: record.incarnation,
    state: record.state,
    seenAt: record.seenAt,
    ...(record.metadata ? { metadata: { ...record.metadata } } : {}),
  };
}

function toIncarnationOrder(value: MeshIncarnation): { numeric?: number; text: string } {
  const text = String(value);
  const candidate = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(candidate)) {
    return { text };
  }

  return { numeric: candidate, text };
}
