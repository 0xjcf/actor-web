import { defineBehavior } from '@actor-web/runtime/browser';
import {
  createInitialPongRoom,
  type PongRoomCommand,
  type PongRoomEvent,
  type PongRoomState,
  reducePongRoom,
} from './pong-room-contract';

export const roomBehavior = defineBehavior<PongRoomCommand, PongRoomEvent>()
  .withContext(createInitialPongRoom('mesh-pong-room'))
  .onMessage(({ message, actor }) => {
    const current = actor.getSnapshot().context as PongRoomState;
    const transition = reducePongRoom(current, message);
    return {
      context: transition.state,
      reply: transition.result,
      emit: [...transition.events],
    };
  })
  .build();
