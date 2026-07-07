import { ACTOR_WEB_LLM_TOOL_NAME } from '@actor-web/agent';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
import {
  ballBehavior,
  createPaddleBehavior,
  createPlayerSessionBehavior,
  lobbyBehavior,
  scoreBehavior,
} from './pong-behaviors';
import { createPlayerSessionActorId, PONG_NODE_ADDRESSES } from './pong-contract';
import { createPongControllerBehavior } from './pong-controller';

export const pong = defineActorWebTopology({
  nodes: {
    server: node(PONG_NODE_ADDRESSES.server),
    a: node(PONG_NODE_ADDRESSES.a),
    b: node(PONG_NODE_ADDRESSES.b),
  },
  tools: [tool(ACTOR_WEB_LLM_TOOL_NAME)],
  actors: {
    ball: actor({ id: 'ball', node: 'server', behavior: ballBehavior }),
    score: actor({ id: 'score', node: 'server', behavior: scoreBehavior }),
    lobby: actor({ id: 'lobby', node: 'server', behavior: lobbyBehavior }),
    playerSession: actor({
      id: createPlayerSessionActorId,
      node: 'server',
      behavior: createPlayerSessionBehavior,
    }),
    controllerLeft: actor({
      id: 'controller-left',
      node: 'server',
      behavior: createPongControllerBehavior('left'),
      tools: [ACTOR_WEB_LLM_TOOL_NAME],
    }),
    controllerRight: actor({
      id: 'controller-right',
      node: 'server',
      behavior: createPongControllerBehavior('right'),
      tools: [ACTOR_WEB_LLM_TOOL_NAME],
    }),
    paddleA: actor({ id: 'paddle-a', node: 'a', behavior: createPaddleBehavior('left') }),
    paddleB: actor({ id: 'paddle-b', node: 'b', behavior: createPaddleBehavior('right') }),
  },
  subscriptions: [{ from: 'ball', to: ['score'], events: ['SCORED'] }],
});
