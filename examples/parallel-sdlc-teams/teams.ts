import type { ActorAddress } from '@actor-web/runtime';
import { type ActorSystem, defineBehavior, startRuntime } from '@actor-web/runtime/browser';
import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';
import {
  type Assignment,
  DefinitionRegistry,
  ok,
  type Result,
  type Role,
  type Roster,
  refuse,
  type Task,
  type Version,
} from './definitions.js';
import {
  acceptCheck,
  acceptReview,
  buildLabel,
  checkLabel,
  documentLabel,
  planLabel,
  type ReviewAdvisor,
  type StageFact,
  scriptedReview,
  type TaskRevision,
} from './stages.js';

function specialistBehavior<T>(work: () => T | Promise<T>) {
  return defineBehavior<{ type: 'RUN_STAGE' }>()
    .withContext({ used: false })
    .onMessage(async ({ message, context }) => {
      if (message?.type !== 'RUN_STAGE' || context.used) {
        return { reply: refuse('INVALID_STAGE_RUN') };
      }
      try {
        return { context: { used: true }, reply: ok(await work()) };
      } catch {
        return { context: { used: true }, reply: refuse('STAGE_FAILED') };
      }
    });
}

type StageSession = {
  role: Role;
  definition: Version;
  sessionAddress: ActorAddress;
};
type StageRecord = StageSession & { fact: StageFact };
export type StageProgress = TaskRevision &
  StageSession &
  (
    | { status: 'running' }
    | { status: 'completed'; fact: StageFact }
    | { status: 'refused'; reason: string }
  );
type StageObserver = (progress: StageProgress) => void;
type TeamReport = TaskRevision & { stages: StageRecord[] };
type RunTeam = { type: 'RUN_TEAM'; injectWrongCandidate: boolean };
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
  return defineBehavior<RunTeam>()
    .withContext({ used: false })
    .onMessage(async ({ message, context }) => {
      if (
        message?.type !== 'RUN_TEAM' ||
        typeof message.injectWrongCandidate !== 'boolean' ||
        context.used
      ) {
        return { reply: refuse('INVALID_TEAM_RUN') };
      }
      const stages: StageRecord[] = [];
      const finish = (reply: Result<TeamReport>) => ({ context: { used: true }, reply });

      // Each dispatch owns one fresh, single-use session, with only its stage's inputs.
      async function step<T, Fact extends StageFact>(
        role: Fact['kind'],
        work: () => T | Promise<T>,
        accept: (value: T) => Result<Fact>
      ): Promise<Result<Fact>> {
        const { id, revision } = team[role];
        const session = await system.spawn(
          specialistBehavior(async () => {
            if (paceStage) await paceStage(role, { ...identity });
            return work();
          }),
          { id: `${runId}-${role}`, supervision: { strategy: 'stop' } }
        );
        const stage = { role, definition: { id, revision }, sessionAddress: session.address };
        const progress = { ...identity, ...stage };
        reportStage({ ...progress, status: 'running' });
        let result: Result<T>;
        try {
          result = await session.ask<Result<T>>({ type: 'RUN_STAGE' }, 2_000);
        } finally {
          await session.stop();
        }
        const accepted = result.ok ? accept(result.value) : result;
        if (!accepted.ok) {
          reportStage({ ...progress, status: 'refused', reason: accepted.reason });
        } else {
          stages.push({ ...stage, fact: accepted.value });
          reportStage({ ...progress, status: 'completed', fact: accepted.value });
        }
        return accepted;
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
      const check = await step(
        'test',
        () => checkLabel(candidate, task.expectedLabel),
        (fact) => acceptCheck(candidate, fact)
      );
      if (!check.ok) return finish(check); // Never dispatch Review on a failed check.

      const reviewer = team.review;
      const reviewed = await step(
        'review',
        () =>
          review(
            structuredClone({
              definition: reviewer,
              taskRequest: task.request,
              evidence: {
                check: check.value,
                ...(reviewer.evidenceGrants.includes('read_candidate') ? { candidate } : {}),
              },
            })
          ),
        (receipt) => acceptReview(candidate, receipt)
      );
      if (!reviewed.ok) return finish(reviewed);

      const documented = await step('document', () => documentLabel(candidate, reviewed.value), ok);
      return finish(documented.ok ? ok({ ...identity, stages }) : documented);
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
