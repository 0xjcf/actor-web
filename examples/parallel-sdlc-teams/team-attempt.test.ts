// @vitest-environment node
import { parse } from '@actor-web/runtime';
import { createActorReadModelSource } from '@actor-web/runtime/browser';
import { expect, test, vi } from 'vitest';
import { matchesCandidateBytes, reviewHandoff } from './check-protocol.js';
import { expectOk, roles } from './definitions.js';
import { allocateDemoTeams, publishDemoDefinitions } from './scenario.js';
import { scriptedReview } from './stages.js';
import { type StageProgress, startTeams } from './teams.js';

const local = { workspaceId: 'checkout-workspace', executorId: 'local', executorGeneration: 2 };
const cloud = { workspaceId: 'profile-workspace', executorId: 'cloud', executorGeneration: 1 };

test.each([0, 1] as const)(
  'lane %i waits for its own owner and resumes its pinned reviewer once',
  async (index) => {
    const review = vi.fn(scriptedReview);
    const events: StageProgress[] = [];
    const app = await startTeams({ review, observeStage: (e) => events.push(e) });
    try {
      const teams = await allocateDemoTeams(app, publishDemoDefinitions(app.registry));
      const {
        address,
        assignment: { task },
      } = teams[index];
      const target = index === 0 ? local : cloud;
      const attempt = expectOk(await app.beginAttempt(address, target));
      const { binding, trace } = attempt.execute;
      expect(binding).toMatchObject({ ...target, taskId: task.id, taskRevision: task.revision });
      expect(attempt.execute.expectedLabel).toBe(task.expectedLabel);
      expect(
        await matchesCandidateBytes(binding, new TextEncoder().encode(attempt.candidate.label))
      ).toBe(true);
      const testStart = events.find((e) => e.role === 'test' && e.status === 'running');
      if (!testStart) throw new Error('Missing Test session');
      expect(trace).toEqual({
        teamId: parse(address).id,
        testSessionId: parse(testStart.sessionAddress).id,
      });
      expect(await app.system.listActors()).not.toContain(testStart.sessionAddress);
      expect(await app.beginAttempt(address, target)).toMatchObject({ ok: false });
      expect(await app.runTeam(address)).toMatchObject({ ok: false });

      const owner = await app.system.lookup(attempt.ownerAddress);
      const team = await app.system.lookup(address);
      if (!owner || !team) throw new Error('Missing team or owner');
      expect(
        expectOk(await attempt.deliver({ type: 'RECEIPT_TIMEOUT', attemptId: binding.attemptId }))
      ).toEqual({ phase: 'unknown' });
      expect(createActorReadModelSource(owner).snapshot()).toMatchObject({
        phase: 'unknown',
        context: binding,
      });

      const handoff = expectOk(reviewHandoff({ value: 'reviewReady', context: binding }, trace));
      for (const message of [handoff, { type: 'STAGE_COMPLETED', passed: true }]) {
        expect(await team.ask(message)).toMatchObject({ ok: false });
      }
      for (const wrong of [{ executorGeneration: 0 }, { workspaceId: 'foreign' }]) {
        expect(
          await attempt.deliver({
            type: 'HOST_RECEIPT',
            receipt: { ...binding, ...wrong, passed: true },
          })
        ).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
      }
      expect(events.filter((e) => e.status === 'running').map((e) => e.role)).toEqual([
        'plan',
        'build',
        'test',
      ]);
      expect(events.some((e) => e.role === 'test' && e.status === 'completed')).toBe(false);
      expect(review).not.toHaveBeenCalled();

      const receipt = { type: 'HOST_RECEIPT', receipt: { ...binding, passed: true } } as const;
      attempt.candidate.label = 'Changed in the caller'; // not the retained candidate
      const [first, duplicate] = await Promise.all([
        attempt.deliver(receipt),
        attempt.deliver(receipt),
      ]);
      const completed = expectOk(first);
      if (completed.phase !== 'documented') throw new Error('Expected a completed report');
      expect(completed.handoffId).toBe(handoff.handoffId);
      expect(completed.report.stages.map((stage) => stage.role)).toEqual(roles);
      expect(new Set(completed.report.stages.map((s) => s.sessionAddress)).size).toBe(5);
      expect(completed.report.stages[1]?.fact).toMatchObject({ label: task.expectedLabel });
      expect(review).toHaveBeenCalledTimes(1);
      const request = review.mock.calls[0]?.[0];
      expect(request?.definition).toMatchObject({ id: 'reviewer', revision: index + 1 });
      expect(request?.evidence).toEqual({
        check: completed.report.stages[2]?.fact,
        ...(index === 0 ? { candidate: completed.report.stages[1]?.fact } : {}),
      });
      expect(duplicate.ok).toBe(false);
      expect(createActorReadModelSource(owner).snapshot().phase).toBe('reviewReady');
    } finally {
      await app.stop();
    }
  }
);

test('a matching failed check stops even if a later receipt claims a pass', async () => {
  const review = vi.fn(scriptedReview);
  const events: StageProgress[] = [];
  const app = await startTeams({ review, observeStage: (e) => events.push(e) });
  try {
    const [team] = await allocateDemoTeams(app, publishDemoDefinitions(app.registry));
    const attempt = expectOk(await app.beginAttempt(team.address, local, true));
    const { binding, expectedLabel } = attempt.execute;
    expect(attempt.candidate.label).not.toBe(expectedLabel);
    expect(
      await attempt.deliver({ type: 'HOST_RECEIPT', receipt: { ...binding, passed: false } })
    ).toEqual({ ok: false, reason: 'CHECK_FAILED' });
    expect(
      await attempt.deliver({ type: 'HOST_RECEIPT', receipt: { ...binding, passed: true } })
    ).toMatchObject({ ok: false });
    expect(events.at(-1)).toMatchObject({
      role: 'test',
      status: 'refused',
      reason: 'CHECK_FAILED',
    });
    expect(events.filter((e) => e.status === 'running').map((e) => e.role)).toEqual([
      'plan',
      'build',
      'test',
    ]);
    expect(review).not.toHaveBeenCalled();
    const owner = await app.system.lookup(attempt.ownerAddress);
    if (!owner) throw new Error('Missing owner');
    expect(createActorReadModelSource(owner).snapshot().phase).toBe('checkFailed');
  } finally {
    await app.stop();
  }
});
