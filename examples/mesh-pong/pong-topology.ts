import { ACTOR_WEB_LLM_TOOL_NAME } from '@actor-web/agent';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
import { createPlayerSessionBehavior, matchCoordinatorBehavior } from './pong-behaviors';
import { createPlayerSessionActorId, PONG_NODE_ADDRESSES } from './pong-contract';
import { createPongControllerBehavior } from './pong-controller';
import { roomBehavior } from './pong-room-behaviors';

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
      room: actor({
        id: 'room-lobby',
        node: 'server',
        behavior: roomBehavior,
      }),
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

export const pong = createPongTopology();
