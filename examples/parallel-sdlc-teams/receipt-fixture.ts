import { createActorReadModelSource } from '@actor-web/runtime/browser';
import { expectOk } from './definitions.js';
import { startMemoryExecutor } from './memory-executor.js';
import { allocateDemoTeams, publishDemoDefinitions } from './scenario.js';
import type { CheckBinding } from './task-check.js';
import type { CheckTarget } from './team-attempt.js';
import { type AllocatedTeam, startTeams } from './teams.js';

const local: CheckTarget = {
  workspaceId: 'checkout-workspace',
  executorId: 'local',
  executorGeneration: 2,
};
const cloud: CheckTarget = {
  workspaceId: 'profile-workspace',
  executorId: 'cloud',
  executorGeneration: 1,
};

export async function startHeldReceiptFixture(failCheckout = false) {
  const planning = new Set<string>();
  let releasePlans = () => {};
  const bothPlanning = new Promise<void>((resolve) => {
    releasePlans = resolve;
  });
  const app = await startTeams({
    async paceStage(role, task) {
      if (role !== 'plan') return;
      planning.add(task.taskId);
      if (planning.size === 2) releasePlans();
      await bothPlanning;
    },
  });

  async function connect(team: AllocatedTeam, target: CheckTarget, wrongLabel = false) {
    const attempt = expectOk(await app.beginAttempt(team.address, target, wrongLabel));
    const { execute, ownerAddress, candidate } = attempt;
    const owner = await app.system.lookup<CheckBinding>(ownerAddress);
    if (!owner) throw new Error(`Missing task owner: ${ownerAddress}`);
    const executor = await startMemoryExecutor(
      app.system,
      execute.binding,
      team.assignment.task.expectedLabel,
      new TextEncoder().encode(candidate.label)
    );
    const stored = expectOk(await executor.execute(execute));
    return {
      stored,
      deliver: attempt.deliver,
      lookup: () =>
        executor.lookup({ type: 'LOOKUP_RECEIPT', binding: execute.binding, trace: execute.trace }),
      openReader() {
        const source = createActorReadModelSource(owner);
        return () => {
          const { phase, context } = source.snapshot();
          return {
            binding: { ...context },
            ownerPhase: phase,
            executions: executor.executions(),
            ...attempt.readStages(),
          };
        };
      },
    };
  }

  try {
    const [checkoutTeam, profileTeam] = await allocateDemoTeams(
      app,
      publishDemoDefinitions(app.registry)
    );
    const [checkout, profile] = await Promise.all([
      connect(checkoutTeam, local, failCheckout),
      connect(profileTeam, cloud),
    ]);
    // Both checks already ran. Withhold delivery of Checkout's receipt, not the check.
    expectOk(
      await checkout.deliver({
        type: 'RECEIPT_TIMEOUT',
        attemptId: checkout.stored.receipt.attemptId,
      })
    );
    expectOk(await profile.deliver(profile.stored));
    return {
      openDashboard() {
        const readCheckout = checkout.openReader();
        const readProfile = profile.openReader();
        return { snapshot: () => ({ checkout: readCheckout(), profile: readProfile() }) };
      },
      // Trusted fixture driver only. The dashboard receives none of these capabilities.
      lookupCheckout: checkout.lookup,
      lookupProfile: profile.lookup,
      deliverCheckout: checkout.deliver,
      stop: app.stop,
    };
  } catch (error) {
    releasePlans();
    await app.stop();
    throw error;
  }
}
