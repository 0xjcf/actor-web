import { ACTOR_WEB_LLM_TOOL_NAME } from '@actor-web/agent';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
import { createPlayerSessionBehavior, matchCoordinatorBehavior } from './pong-behaviors';
import {
  createPlayerSessionActorId,
  createPongClientNodeAddress,
  PONG_NODE_ADDRESSES,
} from './pong-contract';
import { createPongControllerBehavior } from './pong-controller';

export interface CreatePongTopologyOptions {
  readonly clientNodeAddress?: string;
}

export function createPongTopology(options: CreatePongTopologyOptions = {}) {
  const clientNodeAddress = options.clientNodeAddress ?? PONG_NODE_ADDRESSES.localClient;

  return defineActorWebTopology({
    nodes: {
      server: node(PONG_NODE_ADDRESSES.server),
      a: node(PONG_NODE_ADDRESSES.a),
      b: node(PONG_NODE_ADDRESSES.b),
      client: node(clientNodeAddress),
    },
    tools: [tool(ACTOR_WEB_LLM_TOOL_NAME)],
    actors: {
      matchCoordinator: actor({
        id: 'match-coordinator',
        node: 'server',
        behavior: matchCoordinatorBehavior,
      }),
      playerSession: actor({
        id: createPlayerSessionActorId,
        node: 'client',
        behavior: createPlayerSessionBehavior,
      }),
      controllerLeft: actor({
        id: 'controller-left',
        node: 'a',
        behavior: createPongControllerBehavior('left'),
        tools: [ACTOR_WEB_LLM_TOOL_NAME],
      }),
      controllerRight: actor({
        id: 'controller-right',
        node: 'b',
        behavior: createPongControllerBehavior('right'),
        tools: [ACTOR_WEB_LLM_TOOL_NAME],
      }),
    },
    subscriptions: [],
  });
}

const basePong = createPongTopology();

type PongCompatibilityActors = typeof basePong.actors & {
  readonly ball: { readonly address: string };
  readonly lobby: { readonly address: string };
  readonly paddleA: { readonly address: string };
  readonly paddleB: { readonly address: string };
  readonly score: { readonly address: string };
};

export const pong = basePong as typeof basePong & {
  readonly actors: PongCompatibilityActors;
};

Object.defineProperties(pong.actors, {
  ball: {
    enumerable: false,
    value: { address: 'actor://pong-server/ball' },
  },
  lobby: {
    enumerable: false,
    value: { address: 'actor://pong-server/lobby' },
  },
  paddleA: {
    enumerable: false,
    value: { address: 'actor://pong-a/paddle-a' },
  },
  paddleB: {
    enumerable: false,
    value: { address: 'actor://pong-b/paddle-b' },
  },
  score: {
    enumerable: false,
    value: { address: 'actor://pong-server/score' },
  },
});

export function createDefaultPongClientNodeAddress(sessionId: string): string {
  return createPongClientNodeAddress(sessionId);
}
