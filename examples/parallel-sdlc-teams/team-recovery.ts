import type { ReviewHandoff } from './check-protocol.js';
import type { Assignment } from './definitions.js';
import type { StageRecord } from './stage-sessions.js';
import type { PendingAttempt } from './team-attempt.js';

export type Decision = 'awaitingReceipt' | 'unknown' | 'reviewReady' | 'checkFailed';
export type TeamCheckpoint = {
  assignment: Assignment;
  pending: PendingAttempt;
  records: StageRecord[];
  decision: Decision;
  handoff: ReviewHandoff | null;
  claimed: string | null;
  reviewSessions: number;
};

// Each lane has one trusted writer. A claimed but interrupted Review is not retried.
export interface TeamRecovery {
  load(): TeamCheckpoint | null;
  open(assignment: Assignment, pending: PendingAttempt, records: StageRecord[]): void;
  decide(decision: Decision, handoff: ReviewHandoff | null): void;
  claim(handoff: ReviewHandoff): boolean;
  spawned(): void;
  finish(records: StageRecord[]): void;
}
