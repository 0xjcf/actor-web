import { afterEach, describe, expect, it } from 'vitest';
import {
  type FasAgentLoopExampleRuntime,
  type SubmitFasTaskInput,
  startFasAgentLoopExample,
} from './fas-example-runtime';
import { FAS_COORDINATOR_NODE, FAS_WORKER_NODE, fasAgentLoop } from './fas-topology';

const TEST_TASK: SubmitFasTaskInput = {
  taskId: 'task-1001',
  title: 'Implement deterministic FAS loop',
  prompt: 'Build a headless Actor-Web workflow loop with fake tools.',
};

async function waitFor(
  predicate: () => boolean,
  message = 'Timed out waiting for condition'
): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

describe('fas-agent-loop example', () => {
  let runtime: FasAgentLoopExampleRuntime | undefined;

  afterEach(async () => {
    if (runtime) {
      await runtime.stop();
      runtime = undefined;
    }
  });

  it('declares coordinator and worker topology with least-privilege agent tools', () => {
    expect(fasAgentLoop.actors.taskBoard.address.path).toBe(
      'actor://fas-coordinator-runtime/fas-task-board'
    );
    expect(fasAgentLoop.actors.taskBoard.gateway).toEqual({
      scope: { kind: 'taskBoard' },
    });
    expect(fasAgentLoop.actors.taskRun.resolveAddress(TEST_TASK).path).toBe(
      'actor://fas-coordinator-runtime/fas-task-task-1001'
    );
    expect(fasAgentLoop.actors.plannerAgent.tools).toEqual([]);
    expect(fasAgentLoop.actors.implementerAgent.tools).toEqual(['codex.generate_patch']);
    expect(fasAgentLoop.actors.verifierAgent.tools).toEqual(['repo.diff', 'verification.run']);
    expect(fasAgentLoop.actors.reviewerAgent.tools).toEqual(['review.diff', 'memory.write']);
    expect(fasAgentLoop.supervisors.coordinatorWorkflow.children).toEqual([
      'supervisor',
      'taskBoard',
      'taskRun',
    ]);
  });

  it('runs a deterministic FAS workflow through completion', async () => {
    runtime = await startFasAgentLoopExample();
    const topology = runtime.getRuntimeTopology();

    expect(topology).toMatchObject({
      coordinatorNode: FAS_COORDINATOR_NODE,
      workerNode: FAS_WORKER_NODE,
      workerPeer: {
        nodeAddress: FAS_WORKER_NODE,
        connected: true,
        fresh: true,
      },
      toolPorts: {
        supervisor: [],
        planner: [],
        implementer: ['codex.generate_patch'],
        verifier: ['repo.diff', 'verification.run'],
        reviewer: ['review.diff', 'memory.write'],
      },
    });
    expect(topology.gatewayUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);
    expect(topology.coordinatorTransportUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);
    expect(topology.workerTransportUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);

    const summary = await runtime.runTaskToCompletion(TEST_TASK);

    expect(summary).toMatchObject({
      taskId: 'task-1001',
      phase: 'completed',
      activeAgent: 'reviewer',
    });
    expect(summary.plan?.steps).toContain('prepare patch');
    expect(summary.patch?.patchId).toBe('task-1001-patch-1');
    expect(summary.validation?.ok).toBe(true);
    expect(summary.review?.approved).toBe(true);
    expect(summary.timeline.map((entry) => entry.label)).toEqual([
      'Review approved',
      'Validation passed',
      'Patch created',
      'Plan created',
      'Task submitted',
    ]);
    expect(runtime.taskBoard.getSnapshot().context.completedCount).toBe(1);
    expect(runtime.tools.state.invocations.map((call) => call.tool)).toContain('memory.write');
  });

  it('projects the task board through the coordinator gateway source', async () => {
    runtime = await startFasAgentLoopExample();
    const source = runtime.createTaskBoardSource();

    try {
      await waitFor(
        () => source.transportStatus().state === 'connected',
        'Expected task board source to connect through the coordinator gateway'
      );

      expect(source.address.path).toBe('actor://fas-coordinator-runtime/fas-task-board');
      await source.send({ type: 'SUBMIT_TASK', ...TEST_TASK });
      await waitFor(
        () => source.snapshot().context.activeTaskId === TEST_TASK.taskId,
        'Expected gateway source command to update the task board projection'
      );
      expect(source.snapshot().context.tasks).toHaveLength(1);
    } finally {
      source.close();
    }
  });

  it('routes validation failures back through implementation before completing', async () => {
    runtime = await startFasAgentLoopExample({
      tools: {
        validationResults: [
          {
            ok: false,
            command: 'pnpm test:examples',
            failures: ['expected retry after failing example test'],
          },
          {
            ok: true,
            command: 'pnpm test:examples',
            failures: [],
          },
        ],
      },
    });

    const summary = await runtime.runTaskToCompletion(TEST_TASK);

    expect(summary.phase).toBe('completed');
    expect(summary.timeline.map((entry) => entry.label)).toContain('Validation failed');
    expect(summary.patch?.patchId).toBe('task-1001-patch-2');
  });

  it('routes review rejection back through implementation before completing', async () => {
    runtime = await startFasAgentLoopExample({
      tools: {
        reviewResults: [
          {
            approved: false,
            findings: ['reviewer requested a narrower patch'],
          },
          {
            approved: true,
            findings: [],
          },
        ],
      },
    });

    const summary = await runtime.runTaskToCompletion(TEST_TASK);

    expect(summary.phase).toBe('completed');
    expect(summary.timeline.map((entry) => entry.label)).toContain('Review rejected');
    expect(
      runtime.tools.state.invocations.filter((call) => call.tool === 'codex.generate_patch')
    ).toHaveLength(2);
  });

  it('blocks the task when a deterministic tool fails unrecoverably', async () => {
    runtime = await startFasAgentLoopExample({
      tools: {
        failTool: 'verification.run',
      },
    });

    const summary = await runtime.runTaskToCompletion(TEST_TASK);

    expect(summary.phase).toBe('blocked');
    expect(summary.timeline[0]).toMatchObject({
      label: 'Task blocked',
      agent: 'supervisor',
    });
    expect(runtime.taskBoard.getSnapshot().context.blockedCount).toBe(1);
  });

  it('keeps dynamic task actors isolated by task id', async () => {
    runtime = await startFasAgentLoopExample();

    await runtime.submitTask(TEST_TASK);
    await runtime.submitTask({
      taskId: 'task-2002',
      title: 'Verify isolated task actor',
      prompt: 'Run a second task without mutating the first task actor.',
    });

    const first = await runtime.getTask('task-1001');
    const second = await runtime.getTask('task-2002');

    expect(first?.address.path).toBe('actor://fas-coordinator-runtime/fas-task-task-1001');
    expect(second?.address.path).toBe('actor://fas-coordinator-runtime/fas-task-task-2002');
    expect(first?.getSnapshot().context.title).toBe('Implement deterministic FAS loop');
    expect(second?.getSnapshot().context.title).toBe('Verify isolated task actor');
    expect(runtime.taskBoard.getSnapshot().context.tasks).toHaveLength(2);
  });

  it('projects TaskBoardActor state through Ignite Element headless runtime', async () => {
    runtime = await startFasAgentLoopExample();
    const dashboard = runtime.createDashboard();
    const phases: string[] = [];
    const unsubscribe = dashboard.watchView((view) => {
      phases.push(view.phase);
    });

    try {
      expect(dashboard.getView()).toMatchObject({
        phase: 'idle',
        activeAgent: 'none',
        taskCount: 0,
      });

      await runtime.submitTask(TEST_TASK);
      await waitFor(
        () => dashboard.getView().phase === 'submitted',
        'Expected Actor-Web source submission to reach Ignite dashboard view'
      );

      await dashboard.execute('runTask', TEST_TASK);
      await waitFor(
        () => dashboard.getView().phase === 'completed',
        'Expected completed task to project into Ignite dashboard view'
      );

      expect(dashboard.getView()).toMatchObject({
        activeTaskId: 'task-1001',
        phase: 'completed',
        activeAgent: 'reviewer',
        validationStatus: 'passed',
        reviewStatus: 'approved',
        completedCount: 1,
      });
      expect(phases).toContain('submitted');
      expect(phases).toContain('completed');

      const story = dashboard.record('fas dashboard evidence');
      story.execute('submitTask', {
        taskId: 'task-story',
        title: 'Record deterministic story',
        prompt: 'Capture command, state, and view evidence.',
      });

      expect(story.trace().some((entry) => entry.kind === 'command')).toBe(true);
      expect(story.trace().some((entry) => entry.kind === 'state')).toBe(true);
      expect(story.trace().some((entry) => entry.kind === 'view')).toBe(true);
    } finally {
      unsubscribe.unsubscribe();
    }
  });

  it('renders a thin Ignite Element dashboard over the headless FAS runtime', async () => {
    const { FAS_AGENT_LOOP_ELEMENT_NAME, stopFasAgentLoopElementRuntime } = await import(
      './fas-agent-loop-element'
    );
    const element = document.createElement(FAS_AGENT_LOOP_ELEMENT_NAME);
    document.body.appendChild(element);

    try {
      await waitFor(
        () =>
          element.shadowRoot?.textContent?.includes('Headless-first agent workflow dashboard') ??
          false,
        'Expected FAS agent loop element to render'
      );

      expect(element.shadowRoot?.textContent).toContain('Phase');
      expect(element.shadowRoot?.textContent).toContain('idle');
      const submitButton = element.shadowRoot?.querySelector<HTMLButtonElement>('button');
      if (!submitButton) {
        throw new Error('Expected FAS agent loop submit button.');
      }

      submitButton.click();

      await waitFor(
        () => element.shadowRoot?.textContent?.includes('completed') ?? false,
        'Expected UI command to run the FAS agent loop'
      );

      expect(element.shadowRoot?.textContent).toContain('reviewer');
      expect(element.shadowRoot?.textContent).toContain('Review approved');
      expect(element.shadowRoot?.textContent).toContain('review.diff');
    } finally {
      element.remove();
      await stopFasAgentLoopElementRuntime();
    }
  });
});
