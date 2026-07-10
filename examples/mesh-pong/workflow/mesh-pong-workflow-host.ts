import { projectMeshPongWorkflow } from './mesh-pong-workflow-core';
import type { MeshPongWorkflowRendererPort } from './mesh-pong-workflow-ports';
import type { MeshPongWorkflowSource } from './mesh-pong-workflow-source';

/** Imperative shell: owns subscriptions and rendering, never workflow decisions. */
export function mountMeshPongWorkflowHost(
  source: MeshPongWorkflowSource,
  renderer: MeshPongWorkflowRendererPort
): () => void {
  renderer.render(projectMeshPongWorkflow(source.snapshot().context));
  return source.subscribe((snapshot) => {
    renderer.render(projectMeshPongWorkflow(snapshot.context));
  });
}
