import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';
import {
  ballBehavior,
  createPaddleBehavior,
  createPlayerSessionBehavior,
  lobbyBehavior,
  scoreBehavior,
} from './pong-behaviors';
import { createPlayerSessionActorId, PONG_NODE_ADDRESSES } from './pong-contract';

export const pong = defineActorWebTopology({
  nodes: {
    server: node(PONG_NODE_ADDRESSES.server),
    a: node(PONG_NODE_ADDRESSES.a),
    b: node(PONG_NODE_ADDRESSES.b),
  },
  actors: {
    ball: actor({ id: 'ball', node: 'server', behavior: ballBehavior }),
    score: actor({ id: 'score', node: 'server', behavior: scoreBehavior }),
    lobby: actor({ id: 'lobby', node: 'server', behavior: lobbyBehavior }),
    playerSession: actor({
      id: createPlayerSessionActorId,
      node: 'server',
      behavior: createPlayerSessionBehavior,
    }),
    paddleA: actor({ id: 'paddle-a', node: 'a', behavior: createPaddleBehavior('left') }),
    paddleB: actor({ id: 'paddle-b', node: 'b', behavior: createPaddleBehavior('right') }),
  },
  subscriptions: [{ from: 'ball', to: ['score'], events: ['SCORED'] }],
});
