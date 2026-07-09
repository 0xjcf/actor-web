import type { ActorToolRegistry } from '@actor-web/runtime/browser';
import { startRuntime } from '@actor-web/runtime/browser';
import { createPongClientNodeAddress } from '../pong-contract';
import { createPongControllerTools } from '../pong-controller';
import { createPongTopology } from '../pong-topology';

export interface MeshPongLocalOptions {
  readonly sessionId?: string;
  readonly tools?: ActorToolRegistry;
}

export async function startMeshPongLocal(options: MeshPongLocalOptions = {}) {
  const topology = createPongTopology({
    clientNodeAddress: options.sessionId
      ? createPongClientNodeAddress(options.sessionId)
      : undefined,
  });
  return startRuntime(topology, { tools: createPongControllerTools(options.tools) });
}
