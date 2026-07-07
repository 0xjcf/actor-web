import { startRuntime } from '@actor-web/runtime/browser';
import { pong } from '../pong-topology';

export async function startMeshPongLocal() {
  return startRuntime(pong);
}
