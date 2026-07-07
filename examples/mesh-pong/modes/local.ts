import type { ActorToolRegistry } from '@actor-web/runtime/browser';
import { startRuntime } from '@actor-web/runtime/browser';
import { createPongControllerTools } from '../pong-controller';
import { pong } from '../pong-topology';

export interface MeshPongLocalOptions {
  readonly tools?: ActorToolRegistry;
}

export async function startMeshPongLocal(options: MeshPongLocalOptions = {}) {
  return startRuntime(pong, { tools: createPongControllerTools(options.tools) });
}
