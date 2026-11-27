import { ok, type PinnedDefinition, type Result, refuse, type Task } from './definitions.js';

export type TaskRevision = { taskId: string; taskRevision: number };
export type CandidateBinding = TaskRevision & { candidateId: string };

type Plan = TaskRevision & { kind: 'plan'; label: string };
export type Candidate = CandidateBinding & { kind: 'build'; label: string };
export type Check = CandidateBinding & { kind: 'test'; passed: boolean };
type Review = CandidateBinding & { kind: 'review'; decision: 'approve' };
type Document = CandidateBinding & { kind: 'document'; summary: string };
export type StageFact = Plan | Candidate | Check | Review | Document;

export type ReviewRequest = {
  definition: PinnedDefinition;
  taskRequest: string;
  evidence: { check: Check; candidate?: Candidate };
};
type ReviewReceipt = CandidateBinding & { decision: 'approve' | 'reject' };
export type ReviewAdvisor = (request: ReviewRequest) => unknown;

// This fixture does not interpret prompts or talk to a provider.
export function scriptedReview({ evidence: { check } }: ReviewRequest): ReviewReceipt {
  return { ...bindingOf(check), decision: check.passed ? 'approve' : 'reject' };
}

function bindingOf({ taskId, taskRevision, candidateId }: CandidateBinding): CandidateBinding {
  return { taskId, taskRevision, candidateId };
}

function matchesCandidate(binding: CandidateBinding, fact: unknown): boolean {
  return (
    typeof fact === 'object' &&
    fact !== null &&
    'taskId' in fact &&
    fact.taskId === binding.taskId &&
    'taskRevision' in fact &&
    fact.taskRevision === binding.taskRevision &&
    'candidateId' in fact &&
    fact.candidateId === binding.candidateId
  );
}

export function planLabel({ id, revision, expectedLabel }: Task): Plan {
  return { kind: 'plan', taskId: id, taskRevision: revision, label: expectedLabel };
}

export function buildLabel(
  { taskId, taskRevision, label }: Plan,
  candidateId: string,
  injectWrongCandidate: boolean
): Candidate {
  return {
    kind: 'build',
    taskId,
    taskRevision,
    candidateId,
    label: injectWrongCandidate ? `Not ${label}` : label,
  };
}

export function checkLabel(candidate: Candidate, expectedLabel: string): Check {
  return { ...bindingOf(candidate), kind: 'test', passed: candidate.label === expectedLabel };
}

export function acceptCheck(candidate: Candidate, check: Check): Result<Check> {
  if (!matchesCandidate(candidate, check)) return refuse('CHECK_EVIDENCE_MISMATCH');
  return check.passed ? ok(check) : refuse('CHECK_FAILED');
}

export function acceptReview(candidate: Candidate, receipt: unknown): Result<Review> {
  if (!matchesCandidate(candidate, receipt)) return refuse('REVIEW_EVIDENCE_MISMATCH');
  if (
    typeof receipt !== 'object' ||
    receipt === null ||
    !('decision' in receipt) ||
    receipt.decision !== 'approve'
  ) {
    return refuse('REVIEW_REFUSED');
  }
  return ok({ ...bindingOf(candidate), kind: 'review', decision: 'approve' });
}

export function documentLabel(candidate: Candidate, review: Review): Document {
  return {
    ...bindingOf(review),
    kind: 'document',
    summary: `Changed the label to “${candidate.label}” (check passed; scripted review accepted).`,
  };
}

export function describeFact(fact: StageFact): string {
  switch (fact.kind) {
    case 'plan':
      return `Set label to “${fact.label}”.`;
    case 'build':
      return `Candidate label: “${fact.label}”.`;
    case 'test':
      return `Candidate ${fact.candidateId}: ${fact.passed ? 'check passed' : 'check failed'}.`;
    case 'review':
      return `Scripted advisory approval accepted for candidate ${fact.candidateId}.`;
    case 'document':
      return fact.summary;
  }
}
