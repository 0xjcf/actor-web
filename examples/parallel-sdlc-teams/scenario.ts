import { type DefinitionRegistry, expectOk, registerDefaults, type Task } from './definitions.js';
import type { AllocatedTeam, startTeams } from './teams.js';

export const checkout = {
  id: 'checkout',
  revision: 3,
  request: 'Clarify checkout.',
  expectedLabel: 'Pay now',
} as const satisfies Task;

export const profile = {
  id: 'profile',
  revision: 1,
  request: 'Clarify profile saving.',
  expectedLabel: 'Save profile',
} as const satisfies Task;

type TeamsHost = Awaited<ReturnType<typeof startTeams>>;

export function publishDemoDefinitions(registry: DefinitionRegistry) {
  const roster = registerDefaults(registry);
  const review = expectOk(
    registry.revise(roster.review, {
      instruction: 'Advise from the check record alone; do not read the candidate artifact.',
      evidenceGrants: ['read_test'],
    })
  );
  return { checkout: roster, profile: { ...roster, review } };
}

export async function allocateDemoTeams(
  app: TeamsHost,
  rosters: ReturnType<typeof publishDemoDefinitions>
) {
  const checkoutTeam = expectOk(await app.allocateTeam(checkout, rosters.checkout));
  const profileTeam = expectOk(await app.allocateTeam(profile, rosters.profile));

  // Neither pinned team changes; only future assignments are affected.
  expectOk(app.registry.retire(rosters.profile.review.id));
  return [checkoutTeam, profileTeam] as const;
}

export function runDemoTeams(
  app: TeamsHost,
  teams: readonly AllocatedTeam[],
  failCheckout = false
) {
  return Promise.allSettled(
    teams.map(({ address, assignment }) =>
      app.runTeam(address, failCheckout && assignment.task.id === checkout.id)
    )
  );
}
