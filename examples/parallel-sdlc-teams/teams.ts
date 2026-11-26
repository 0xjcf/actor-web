import type { ActorAddress } from '@actor-web/runtime';
import { type ActorSystem, defineBehavior, startRuntime } from '@actor-web/runtime/browser';
import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';
import { reviewHandoff } from './check-protocol.js';
import {
  type Assignment,
  DefinitionRegistry,
  ok,
  type Result,
  type Role,
  type Roster,
  refuse,
  type Task,
} from './definitions.js';
import { type StageProgress, type StageRecord, stageSessions } from './stage-sessions.js';
import {
  acceptCheck,
  acceptReview,
  buildLabel,
  type Candidate,
  type Check,
  checkLabel,
  documentLabel,
  planLabel,
  type ReviewAdvisor,
  scriptedReview,
  type TaskRevision,
} from './stages.js';
import type { ReceiptSignal, TaskCheckReply } from './task-check.js';
import {
  type CheckTarget,
  type OpenAttempt,
  openAttempt,
  type PendingAttempt,
  validTarget,
} from './team-attempt.js';

export type { StageProgress } from './stage-sessions.js';

type StageObserver = (progress: StageProgress) => void;
type TeamReport = TaskRevision & { stages: StageRecord[] };
type RunTeam = { type: 'RUN_TEAM'; injectWrongCandidate: boolean };
type BeginAttempt = { type: 'BEGIN_ATTEMPT'; target: CheckTarget; injectWrongCandidate: boolean };
type Delivery =
  | { phase: 'unknown' }
  | { phase: 'documented'; handoffId: string; report: TeamReport };
type AllocateTeam = { type: 'ALLOCATE_TEAM'; task: Task; roster: Roster };
export type AllocatedTeam = { address: ActorAddress; assignment: Assignment };

type TeamOptions = {
  registry?: DefinitionRegistry;
  review?: ReviewAdvisor;
  observeStage?: StageObserver;
  // For a readable presentation and for measuring overlap; never supplies stage facts.
  paceStage?: (role: Role, task: TaskRevision) => Promise<void>;
};

function teamBehavior(
  system: ActorSystem,
  assignment: Assignment,
  runId: string,
  review: ReviewAdvisor,
  reportStage: StageObserver,
  paceStage: TeamOptions['paceStage']
) {
  const { task, team } = assignment;
  const identity: TaskRevision = { taskId: task.id, taskRevision: task.revision };
  const sessions = stageSessions(system, assignment, runId, reportStage, paceStage);
  const { step, records: stages } = sessions;
  const finish = <T>(reply: Result<T>) => ({ context: { used: true, pending: null }, reply });

  async function reviewAndDocument(
    candidate: Candidate,
    check: Check
  ): Promise<Result<TeamReport>> {
    const reviewer = team.review;
    const reviewed = await step(
      'review',
      () =>
        review(
          structuredClone({
            definition: reviewer,
            taskRequest: task.request,
            evidence: {
              check,
              ...(reviewer.evidenceGrants.includes('read_candidate') ? { candidate } : {}),
            },
          })
        ),
      (receipt) => acceptReview(candidate, receipt)
    );
    if (!reviewed.ok) return reviewed;
    const documented = await step('document', () => documentLabel(candidate, reviewed.value), ok);
    return documented.ok ? ok({ ...identity, stages }) : documented;
  }

  return defineBehavior<RunTeam | BeginAttempt | ReceiptSignal>()
    .withContext<{ used: boolean; pending: PendingAttempt | null }>({ used: false, pending: null })
    .onMessage(async ({ message, context }) => {
      if (message?.type === 'HOST_RECEIPT' || message?.type === 'RECEIPT_TIMEOUT') {
        const pending = context.pending;
        if (!pending) return { reply: refuse('NO_PENDING_CHECK') };
        const owner = await system.lookup(pending.ownerAddress);
        if (!owner) return { reply: refuse('OWNER_UNAVAILABLE') };
        const decision = await owner.ask<TaskCheckReply>(message);
        if (!('value' in decision)) return { reply: refuse(decision.error.code) };
        if (decision.value === 'unknown')
          return { reply: ok({ phase: 'unknown' } satisfies Delivery) };
        if (decision.value === 'checkFailed') {
          const failure = refuse('CHECK_FAILED');
          sessions.settle(pending.test, failure);
          return finish(failure);
        }
        // Never accept a caller-supplied START_REVIEW. Derive it from this owner's reply.
        const handoff = reviewHandoff(decision, pending.execute.trace);
        if (!handoff.ok) return { reply: handoff };
        const { candidate } = pending;
        const check: Check = {
          ...identity,
          candidateId: candidate.candidateId,
          kind: 'test',
          passed: true,
        };
        sessions.settle(pending.test, ok(check));
        const report = await reviewAndDocument(candidate, check);
        return finish(
          report.ok
            ? ok({
                phase: 'documented',
                handoffId: handoff.value.handoffId,
                report: report.value,
              } satisfies Delivery)
            : report
        );
      }
      if (
        (message?.type !== 'RUN_TEAM' && message?.type !== 'BEGIN_ATTEMPT') ||
        typeof message.injectWrongCandidate !== 'boolean' ||
        context.used
      )
        return { reply: refuse('INVALID_TEAM_RUN') };
      if (message.type === 'BEGIN_ATTEMPT' && !validTarget(message.target)) {
        return { reply: refuse('INVALID_CHECK_TARGET') };
      }

      const plan = await step('plan', () => planLabel(task), ok);
      if (!plan.ok) return finish(plan);
      const build = await step(
        'build',
        () => buildLabel(plan.value, `${runId}-candidate`, message.injectWrongCandidate),
        ok
      );
      if (!build.ok) return finish(build);

      const candidate = build.value;
      if (message.type === 'BEGIN_ATTEMPT') {
        const opened = await openAttempt(system, sessions, runId, task, candidate, message.target);
        if (!opened.ok) return finish(opened);
        const { ownerAddress, execute } = opened.value;
        return {
          context: { used: true, pending: opened.value },
          reply: ok(structuredClone({ ownerAddress, execute, candidate } satisfies OpenAttempt)),
        };
      }
      const check = await step(
        'test',
        () => checkLabel(candidate, task.expectedLabel),
        (fact) => acceptCheck(candidate, fact)
      );
      return finish(check.ok ? await reviewAndDocument(candidate, check.value) : check);
    });
}

export async function startTeams({
  registry = new DefinitionRegistry(),
  review = scriptedReview,
  observeStage,
  paceStage,
}: TeamOptions = {}) {
  const admittedTasks = new Set<string>();
  const readyTeams = new Set<ActorAddress>();
  // One-way, detached projection; observer errors and mutations cannot affect stage acceptance.
  const reportStage: StageObserver = (progress) => {
    if (!observeStage) return;
    void Promise.resolve()
      .then(() => observeStage(structuredClone(progress)))
      .catch(() => console.error('SDLC stage observation failed.'));
  };
  const orchestrator = defineBehavior<AllocateTeam>().onMessage(async ({ message }) => {
    if (message?.type !== 'ALLOCATE_TEAM') return { reply: refuse('UNKNOWN_COMMAND') };
    const assignment = registry.pin(message.task, message.roster);
    if (!assignment.ok) return { reply: assignment };
    const { task } = assignment.value;
    if (admittedTasks.has(task.id)) return { reply: refuse('TASK_ALREADY_ASSIGNED') };
    const runId = crypto.randomUUID();
    const ref = await system.spawn(
      teamBehavior(system, assignment.value, runId, review, reportStage, paceStage),
      { id: runId, supervision: { strategy: 'stop' } }
    );
    admittedTasks.add(task.id);
    readyTeams.add(ref.address);
    const allocated: AllocatedTeam = {
      address: ref.address,
      assignment: structuredClone(assignment.value),
    };
    return { reply: ok(allocated) }; // Allocation creates an idle actor; it never sends Run.
  });

  const topology = defineActorWebTopology({
    nodes: { local: node('sdlc') },
    actors: { orchestrator: actor({ id: 'orchestrator', node: 'local', behavior: orchestrator }) },
  });
  const runtime = await startRuntime(topology);
  const local = runtime.nodes.local;
  if (!local) {
    await runtime.stop();
    throw new Error('The SDLC node did not start');
  }
  const system: ActorSystem = local.system;
  const allocator = runtime.requireActor('orchestrator');

  return {
    registry,
    system, // Trusted host access for this local demo and for directory inspection in tests.
    allocateTeam: (task: Task, roster: Roster) =>
      allocator.ask<Result<AllocatedTeam>>({ type: 'ALLOCATE_TEAM', task, roster }),
    async beginAttempt(address: ActorAddress, target: CheckTarget, injectWrongCandidate = false) {
      if (!validTarget(target)) return refuse('INVALID_CHECK_TARGET');
      if (!readyTeams.delete(address)) return refuse('NOT_A_READY_TEAM');
      const team = await system.lookup(address);
      if (!team) return refuse('TEAM_NOT_FOUND');
      const opened = await team.ask<Result<OpenAttempt>>(
        { type: 'BEGIN_ATTEMPT', target: structuredClone(target), injectWrongCandidate },
        15_000
      );
      if (!opened.ok) return opened;
      // Local host capability, not part of the serializable executor request.
      return ok({
        ...opened.value,
        deliver: (event: ReceiptSignal) => team.ask<Result<Delivery>>(event, 15_000),
      });
    },
    async runTeam(
      address: ActorAddress,
      injectWrongCandidate = false
    ): Promise<Result<TeamReport>> {
      if (!readyTeams.delete(address)) return refuse('NOT_A_READY_TEAM');
      const team = await system.lookup(address);
      if (!team) return refuse('TEAM_NOT_FOUND');
      try {
        return await team.ask<Result<TeamReport>>(
          { type: 'RUN_TEAM', injectWrongCandidate },
          15_000
        );
      } finally {
        await team.stop();
      }
    },
    stop() {
      readyTeams.clear();
      return runtime.stop();
    },
  };
}
