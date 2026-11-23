// @vitest-environment node
import { Address } from '@actor-web/runtime';
import { expect, test, vi } from 'vitest';
import {
  DefinitionRegistry,
  expectOk,
  type Role,
  registerDefaults,
  roles,
  type Task,
} from './definitions.js';
import {
  allocateDemoTeams,
  checkout,
  profile,
  publishDemoDefinitions,
  runDemoTeams,
} from './scenario.js';
import { acceptCheck, buildLabel, checkLabel, planLabel, scriptedReview } from './stages.js';
import { type StageProgress, startTeams } from './teams.js';

const notReady = { ok: false, reason: 'NOT_A_READY_TEAM' };

test('definitions preserve revisions, require necessary grants and snapshot task data', () => {
  const registry = new DefinitionRegistry();
  const roster = registerDefaults(registry);
  const original = expectOk(registry.read(roster.review));
  const task: Task = { ...checkout };
  const assignment = expectOk(registry.pin(task, roster));

  for (const evidenceGrants of [['read_test', 'read_target'], []] as const) {
    expect(
      registry.revise(roster.review, { instruction: original.instruction, evidenceGrants })
    ).toEqual({ ok: false, reason: 'INVALID_DEFINITION' });
  }
  const reviewV2 = expectOk(
    registry.revise(roster.review, {
      instruction: 'Use only the check.',
      evidenceGrants: ['read_test'],
    })
  );
  expect(reviewV2).toEqual({ id: roster.review.id, revision: 2 });
  expect(registry.revise(roster.review, original)).toEqual({
    ok: false,
    reason: 'NOT_CURRENT_DEFINITION',
  });

  task.expectedLabel = 'Changed after pinning';
  expectOk(registry.retire(original.id));
  expect(assignment.task).toEqual(checkout);
  expect(assignment.team.review).toEqual(original);
  expect(expectOk(registry.read(roster.review))).toEqual(original);
  expect(registry.list().filter(({ definition }) => definition.id === original.id)).toMatchObject([
    { definition: original, retired: true },
    { definition: { revision: 2, evidenceGrants: ['read_test'] }, retired: true },
  ]);
  expect(registry.pin(profile, { ...roster, review: reviewV2 })).toEqual({
    ok: false,
    reason: 'UNAVAILABLE_ROLE:review',
  });
});

test('publication is data-only; idle pins survive retirement and both Plan sessions actually overlap', async () => {
  let releasePlan = () => {};
  const barrier = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  const paced: [role: Role, taskId: string][] = [];
  const progress: StageProgress[] = [];
  const review = vi.fn(scriptedReview);
  const app = await startTeams({
    review,
    observeStage: (event) => progress.push(event),
    paceStage: async (role, task) => {
      paced.push([role, task.taskId]);
      if (role === 'plan') await barrier;
    },
  });

  let runs: Promise<unknown> = Promise.resolve();
  try {
    const baseline = (await app.system.listActors()).sort();
    expect(baseline).toContain(Address.from({ id: 'orchestrator', node: 'sdlc' }));
    const rosters = publishDemoDefinitions(app.registry);
    expect((await app.system.listActors()).sort()).toEqual(baseline);
    expect(app.registry.list()).toHaveLength(6);
    expect(app.registry.list().every((entry) => !entry.retired)).toBe(true);
    expect(progress).toEqual([]);

    const teams = await allocateDemoTeams(app, rosters);
    const [a, b] = teams;
    expect(a.address).not.toBe(b.address);
    expect((await app.system.listActors()).sort()).toEqual(
      [...baseline, a.address, b.address].sort()
    );
    expect(a.assignment).toMatchObject({
      task: checkout,
      team: {
        review: { id: 'reviewer', revision: 1, evidenceGrants: ['read_candidate', 'read_test'] },
      },
    });
    expect(b.assignment).toMatchObject({
      task: profile,
      team: { review: { id: 'reviewer', revision: 2, evidenceGrants: ['read_test'] } },
    });
    expect(await app.allocateTeam({ ...checkout, id: 'future-task' }, rosters.checkout)).toEqual({
      ok: false,
      reason: 'UNAVAILABLE_ROLE:review',
    });
    expect(paced).toEqual([]);
    expect(progress).toEqual([]);
    expect(review).not.toHaveBeenCalled();

    // An inspectable assignment is a snapshot, not a mutable handle to the team.
    a.assignment.task.expectedLabel = 'Changed in the view';
    a.assignment.team.review.revision = 99;

    const reports = runDemoTeams(app, teams);
    runs = reports;
    await vi.waitFor(() => expect(paced).toHaveLength(2));
    expect(paced.map(([role]) => role)).toEqual(['plan', 'plan']);
    expect(paced.map(([, task]) => task).sort()).toEqual([checkout.id, profile.id]);
    expect(progress).toHaveLength(2);
    expect(progress.every((event) => event.status === 'running' && event.role === 'plan')).toBe(
      true
    );
    const liveAddresses = progress.map((event) => event.sessionAddress);
    expect(await app.system.listActors()).toEqual(expect.arrayContaining(liveAddresses));
    expect(await app.runTeam(a.address)).toEqual(notReady);
    releasePlan();

    const stages = (await reports).flatMap((result, index) => {
      if (result.status === 'rejected') throw result.reason;
      const report = expectOk(result.value);
      const task = index === 0 ? checkout : profile;
      const reviewer = index === 0 ? rosters.checkout.review : rosters.profile.review;
      const { stages } = report;
      expect(report).toMatchObject({ taskId: task.id, taskRevision: task.revision });
      expect(stages.map(({ role, fact }) => [role, fact.kind])).toEqual(
        roles.map((role) => [role, role])
      );
      const build = stages[1]?.fact;
      expect(build).toMatchObject({ kind: 'build', label: task.expectedLabel });
      if (build?.kind !== 'build') throw new Error('Expected a candidate fact');
      const binding = {
        taskId: task.id,
        taskRevision: task.revision,
        candidateId: build.candidateId,
      };
      expect(stages[2]?.fact).toEqual({ ...binding, kind: 'test', passed: true });
      expect(stages[3]).toMatchObject({
        definition: reviewer,
        fact: { ...binding, kind: 'review', decision: 'approve' },
      });
      expect(stages[4]?.fact).toMatchObject({
        ...binding,
        kind: 'document',
        summary: expect.stringContaining(task.expectedLabel),
      });
      const request = review.mock.calls.find(
        ([request]) => request.evidence.check.taskId === task.id
      )?.[0];
      expect(request).toEqual({
        definition: expectOk(app.registry.read(reviewer)),
        taskRequest: task.request,
        evidence: { check: stages[2]?.fact, ...(index === 0 ? { candidate: build } : {}) },
      });
      return stages;
    });
    expect(review).toHaveBeenCalledTimes(2);
    expect(new Set(stages.map((stage) => stage.sessionAddress)).size).toBe(10);
    expect((await app.system.listActors()).sort()).toEqual(baseline);
    expect(await app.runTeam(a.address)).toEqual(notReady);
  } finally {
    releasePlan();
    await runs;
    await app.stop();
  }
});

test('allocation refuses invalid commands and assignments without starting work', async () => {
  const app = await startTeams();
  try {
    const roster = registerDefaults(app.registry);
    const baseline = await app.system.listActors();
    const address = Address.from({ id: 'orchestrator', node: 'sdlc' });
    const orchestrator = await app.system.lookup(address);
    if (!orchestrator) throw new Error('Orchestrator not found');
    expect(await orchestrator.ask({ type: 'RUN_TEAM', injectWrongCandidate: false })).toEqual({
      ok: false,
      reason: 'UNKNOWN_COMMAND',
    });
    expect(await app.allocateTeam({ ...checkout, revision: 0 }, roster)).toEqual({
      ok: false,
      reason: 'INVALID_TASK',
    });
    expect(await app.allocateTeam(checkout, { ...roster, plan: roster.test })).toEqual({
      ok: false,
      reason: 'UNAVAILABLE_ROLE:plan',
    });
    const { document: _, ...incomplete } = roster;
    expect(
      await orchestrator.ask({ type: 'ALLOCATE_TEAM', task: checkout, roster: incomplete })
    ).toEqual({ ok: false, reason: 'INVALID_ROSTER:document' });
    expect(await app.system.listActors()).toEqual(baseline);

    const team = expectOk(await app.allocateTeam(checkout, roster));
    expect(await app.allocateTeam(checkout, roster)).toEqual({
      ok: false,
      reason: 'TASK_ALREADY_ASSIGNED',
    });
    expect(await app.runTeam(address)).toEqual(notReady);
    const idle = await app.system.lookup(team.address);
    if (!idle) throw new Error('Allocated team not found');
    expect(await idle.ask({ type: 'RUN_STAGE' })).toEqual({
      ok: false,
      reason: 'INVALID_TEAM_RUN',
    });
    expect((await app.system.listActors()).sort()).toEqual([...baseline, team.address].sort());
  } finally {
    await app.stop();
  }
});

test('the wrong candidate fails Test without consulting Review; the peer finishes and cleanup is local', async () => {
  const progress: StageProgress[] = [];
  const review = vi.fn(scriptedReview);
  const app = await startTeams({ review, observeStage: (event) => progress.push(event) });
  try {
    const baseline = await app.system.listActors();
    const teams = await allocateDemoTeams(app, publishDemoDefinitions(app.registry));
    const [failed, passed] = await runDemoTeams(app, teams, true);
    expect(failed).toEqual({ status: 'fulfilled', value: { ok: false, reason: 'CHECK_FAILED' } });
    if (passed.status === 'rejected') throw passed.reason;
    expect(expectOk(passed.value).stages.map((stage) => stage.role)).toEqual(roles);
    expect(review.mock.calls.map(([request]) => request.evidence.check.taskId)).toEqual([
      profile.id,
    ]);
    const events = progress.filter((event) => event.taskId === checkout.id);
    expect(events.filter((event) => event.status === 'running').map((event) => event.role)).toEqual(
      ['plan', 'build', 'test']
    );
    expect(
      events.find((event) => event.status === 'completed' && event.role === 'build')
    ).toMatchObject({ fact: { label: 'Not Pay now' } });
    expect(events.at(-1)).toMatchObject({
      status: 'refused',
      role: 'test',
      reason: 'CHECK_FAILED',
    });
    expect(await app.system.listActors()).toEqual(baseline);
  } finally {
    await app.stop();
  }
});

test('a passing check for another candidate or task revision cannot be reused', () => {
  const plan = planLabel(checkout);
  const candidate = buildLabel(plan, 'candidate-a', false);
  const valid = checkLabel(candidate, checkout.expectedLabel);
  expect(acceptCheck(candidate, valid)).toEqual({ ok: true, value: valid });
  for (const wrong of [
    { candidateId: 'candidate-b' },
    { taskRevision: 2 },
    { taskId: 'profile' },
  ]) {
    expect(acceptCheck(candidate, { ...valid, ...wrong })).toEqual({
      ok: false,
      reason: 'CHECK_EVIDENCE_MISMATCH',
    });
  }
});

test.each([
  { change: { decision: 'reject' }, reason: 'REVIEW_REFUSED' },
  { change: { taskId: profile.id }, reason: 'REVIEW_EVIDENCE_MISMATCH' },
  { change: { taskRevision: checkout.revision - 1 }, reason: 'REVIEW_EVIDENCE_MISMATCH' },
  { change: { candidateId: 'different-candidate' }, reason: 'REVIEW_EVIDENCE_MISMATCH' },
])(
  'rejects invalid advisory receipts ($change) without blocking the peer',
  async ({ change, reason }) => {
    const progress: StageProgress[] = [];
    const app = await startTeams({
      review: (request) => {
        const receipt = scriptedReview(request);
        return receipt.taskId === checkout.id ? { ...receipt, ...change } : receipt;
      },
      observeStage: (event) => progress.push(event),
    });
    try {
      const baseline = await app.system.listActors();
      const teams = await allocateDemoTeams(app, publishDemoDefinitions(app.registry));
      const [failed, passed] = await runDemoTeams(app, teams);
      expect(failed).toEqual({ status: 'fulfilled', value: { ok: false, reason } });
      if (passed.status === 'rejected') throw passed.reason;
      expect(expectOk(passed.value).stages.map((stage) => stage.role)).toEqual(roles);
      expect(progress.filter((event) => event.taskId === checkout.id).at(-1)).toMatchObject({
        status: 'refused',
        role: 'review',
        reason,
      });
      expect(await app.system.listActors()).toEqual(baseline);
    } finally {
      await app.stop();
    }
  }
);

test('a projection that throws and mutates its copy cannot change the team outcome', async () => {
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = await startTeams({
    observeStage: (event) => {
      if (event.status !== 'completed' || event.fact.kind !== 'build') return;
      event.fact.label = 'Wrong observation';
      throw new Error('projection failed');
    },
  });
  try {
    const { address } = expectOk(await app.allocateTeam(checkout, registerDefaults(app.registry)));
    const report = expectOk(await app.runTeam(address));
    expect(report.stages[1]?.fact).toMatchObject({ label: checkout.expectedLabel });
    expect(report.stages.map(({ role }) => role)).toEqual(roles);
    expect(diagnostic).toHaveBeenCalledWith('SDLC stage observation failed.');
  } finally {
    await app.stop();
    diagnostic.mockRestore();
  }
});

test('reset stops idle teams; publishing again cannot reuse their addresses or run state', async () => {
  const first = await startTeams();
  const oldTeams = await (async () => {
    try {
      return await allocateDemoTeams(first, publishDemoDefinitions(first.registry));
    } finally {
      await first.stop();
    }
  })();
  expect(await first.system.listActors()).toEqual([]);
  expect(await first.runTeam(oldTeams[0].address)).toEqual(notReady);

  const fresh = await startTeams();
  try {
    expect(fresh.registry.list()).toEqual([]);
    const next = await allocateDemoTeams(fresh, publishDemoDefinitions(fresh.registry));
    expect(await fresh.runTeam(oldTeams[0].address)).toEqual(notReady);
    expect(next[0].address).not.toBe(oldTeams[0].address);
    expect(next[1].address).not.toBe(oldTeams[1].address);
    const results = await runDemoTeams(fresh, next);
    expect(results).toMatchObject([
      { status: 'fulfilled', value: { ok: true } },
      { status: 'fulfilled', value: { ok: true } },
    ]);
  } finally {
    await fresh.stop();
  }
});
