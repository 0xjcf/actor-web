import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';

export const lanes = ['checkout', 'profile'] as const;
export type Lane = (typeof lanes)[number];
export const targets = {
  checkout: { workspaceId: 'checkout-workspace', executorId: 'local', executorGeneration: 2 },
  profile: { workspaceId: 'profile-workspace', executorId: 'cloud', executorGeneration: 1 },
} as const;

const view = (lane: Lane) =>
  actor({
    id: `${lane}-view`,
    node: 'control',
    gateway: { scope: { kind: 'progress', params: { workspace: targets[lane].workspaceId } } },
  } as const);

const nodes = {
  control: node('sdlc-control'),
  checkout: node('checkout-host'),
  profile: node('profile-host'),
};
export const topology = defineActorWebTopology({ nodes, actors: {} });
export const views = defineActorWebTopology({
  nodes,
  actors: { checkout: view('checkout'), profile: view('profile') },
});
