import { startRuntime } from '@actor-web/runtime/browser';
import { fasOrchestration } from './fas-orchestration-topology';
import { createFasTaskLoop } from './fas-task-loop';
import { createDeterministicFasTools } from './fas-tool-adapters';

export async function startFasBrowserRuntime() {
  const tools = createDeterministicFasTools();
  const runtime = await startRuntime(fasOrchestration, { tools: tools.registry });

  try {
    const { coordinator, worker } = runtime.nodes;
    if (!coordinator || !worker) throw new Error('The example requires both topology nodes.');
    return createFasTaskLoop({
      coordinator,
      worker,
      agents: {
        planner: runtime.requireActor('plannerAgent'),
        implementer: runtime.requireActor('implementerAgent'),
        verifier: runtime.requireActor('verifierAgent'),
        reviewer: runtime.requireActor('reviewerAgent'),
      },
      createTaskBoardSource: () => runtime.actors.taskBoard.source(),
      stop: () => runtime.stop(),
    });
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
