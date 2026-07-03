export interface ArtifactRecord {
  readonly artifactId: string;
  readonly type: string;
  readonly key?: string;
  readonly version: number;
  readonly payload: unknown;
  readonly producer: string;
  readonly publishedAt: number;
  readonly contentHash: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ArtifactQuery {
  readonly typeFilter?: string;
  readonly key?: string;
  readonly history?: boolean;
}

export interface ArtifactMatcher {
  readonly type: string;
  readonly key?: string;
  readonly fields?: Record<string, unknown>;
}

export type DependencyMode = 'once' | 'everyVersion';

export interface DependencyDefinition {
  readonly id?: string;
  readonly lattice: string;
  readonly requires: readonly ArtifactMatcher[];
  readonly mode?: DependencyMode;
}

export interface RegisteredDependency extends DependencyDefinition {
  readonly dependencyId: string;
  readonly actorKey: string;
  readonly mode: DependencyMode;
}

export type LatticeMessage =
  | {
      readonly type: 'PUBLISH_ARTIFACT';
      readonly artifact: Omit<ArtifactRecord, 'artifactId' | 'version' | 'contentHash'> & {
        readonly contentHash?: string;
      };
    }
  | {
      readonly type: 'REGISTER_DEPENDENCY';
      readonly dependency: RegisteredDependency;
      readonly registeredAt?: number;
    }
  | {
      readonly type: 'WITHDRAW_DEPENDENCY';
      readonly dependencyId: string;
    }
  | {
      readonly type: 'ACK_ACTIVATION';
      readonly activationId: string;
      readonly acknowledgedAt?: number;
    }
  | {
      readonly type: 'QUERY_ARTIFACTS';
      readonly query?: ArtifactQuery;
    }
  | {
      readonly type: 'CHECK_ACTIVATION_TIMEOUTS';
      readonly now: number;
    };

export type LatticeEvent =
  | { readonly type: 'ARTIFACT_PUBLISHED'; readonly artifact: ArtifactRecord }
  | {
      readonly type: 'DEPENDENCY_SATISFIED';
      readonly activationId: string;
      readonly dependencyId: string;
      readonly actorKey: string;
      readonly lattice: string;
      readonly satisfactionKey: string;
      readonly artifacts: readonly ArtifactRecord[];
    }
  | {
      readonly type: 'ACTIVATION_TIMED_OUT';
      readonly activationId: string;
      readonly dependencyId: string;
      readonly actorKey: string;
      readonly lattice: string;
      readonly timedOutAt: number;
    };

export interface LatticeJournalArtifactPublished {
  readonly kind: 'ARTIFACT_PUBLISHED';
  readonly artifact: ArtifactRecord;
}

export interface LatticeJournalDependencyRegistered {
  readonly kind: 'DEPENDENCY_REGISTERED';
  readonly dependency: RegisteredDependency;
  readonly registeredAt?: number;
}

export interface LatticeJournalDependencyWithdrawn {
  readonly kind: 'DEPENDENCY_WITHDRAWN';
  readonly dependencyId: string;
}

export interface LatticeJournalActivationAcknowledged {
  readonly kind: 'ACTIVATION_ACKNOWLEDGED';
  readonly activationId: string;
  readonly acknowledgedAt: number;
}

export type LatticeJournalEvent =
  | LatticeJournalArtifactPublished
  | LatticeJournalDependencyRegistered
  | LatticeJournalDependencyWithdrawn
  | LatticeJournalActivationAcknowledged;
