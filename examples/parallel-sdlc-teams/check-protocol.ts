import { ok, type Result, refuse } from './definitions.js';
import type { CheckBinding, ReceiptEvent, TaskCheckReply } from './task-check.js';

// A candidate is addressed by its exact bytes within an admitted workspace, never by a host path.
export type CandidateRef = Pick<CheckBinding, 'workspaceId' | 'candidateDigest'>;

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function pinCandidate(workspaceId: string, bytes: Uint8Array): Promise<CandidateRef> {
  return { workspaceId, candidateDigest: await digest(bytes) };
}

// Call after resolving the reference in its workspace and before executing the approved check.
export async function matchesCandidateBytes(
  ref: CandidateRef,
  bytes: Uint8Array
): Promise<boolean> {
  return ref.candidateDigest === (await digest(bytes));
}

export type TestTrace = Readonly<{ teamId: string; testSessionId: string }>;
type CheckAttempt = Readonly<{ binding: CheckBinding; trace: TestTrace }>;

// Task owner → team → Test session → executor. DISPATCH_CHECK, by contrast, is owner-local.
export type ExecuteCheck = CheckAttempt & { type: 'EXECUTE_CHECK'; expectedLabel: string };
// Task owner → executor. No candidate bytes, check input, or implied permission to execute.
export type LookupReceipt = CheckAttempt & { type: 'LOOKUP_RECEIPT' };
export type ReceiptLookupReply =
  | ReceiptEvent
  | { type: 'RECEIPT_UNAVAILABLE'; binding: CheckBinding };

export type ReviewHandoff = CheckAttempt & { type: 'START_REVIEW'; handoffId: string };

// The owner supplies its own FSM's ask reply, never a snapshot offered by a worker.
// A correlation key prevents ambiguous joins; it is not a credential or a deduplication store.
export function reviewHandoff(decision: TaskCheckReply, trace: TestTrace): Result<ReviewHandoff> {
  if (!('value' in decision) || decision.value !== 'reviewReady') return refuse('REVIEW_NOT_READY');
  const binding = decision.context;
  const handoffId = JSON.stringify([
    'review/v1',
    trace.teamId,
    binding.workspaceId,
    binding.taskId,
    binding.taskRevision,
    binding.attemptId,
    binding.checkId,
    binding.executorId,
    binding.executorGeneration,
    binding.candidateDigest,
  ]);
  return ok({ type: 'START_REVIEW', binding: { ...binding }, trace: { ...trace }, handoffId });
}
