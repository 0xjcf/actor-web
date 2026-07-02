import type { ActorToolExecutor } from '@actor-web/runtime';
import { defineBehavior } from '@actor-web/runtime';
import { startActorWebNode } from '@actor-web/runtime/browser';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
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

type AsyncProbeInput =
  | { readonly mode: 'delay'; readonly value: string }
  | { readonly mode: 'hang' };
type AsyncProbeResult = {
  readonly value: string;
  readonly signalProvided: boolean;
};
type AsyncProbeCommand =
  | { readonly type: 'RUN_ASYNC_TOOL'; readonly value: string }
  | { readonly type: 'RUN_HUNG_TOOL' }
  | { readonly type: 'PING' };
type AsyncProbeReply =
  | AsyncProbeResult
  | { readonly code: string | undefined }
  | { readonly pong: true };
type AsyncProbeTools = {
  readonly 'fas.async_probe': ActorToolExecutor<AsyncProbeInput, AsyncProbeResult>;
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

function createAsyncProbeBehavior() {
  return defineBehavior<AsyncProbeCommand, AsyncProbeReply>()
    .onMessage(async ({ message, tools }) => {
      const executeWithOptions = tools.execute as <TOutput, TInput>(
        name: string,
        input: TInput,
        options: { readonly timeoutMs: number }
      ) => Promise<TOutput>;

      if (message.type === 'PING') {
        return { reply: { pong: true } };
      }

      if (message.type === 'RUN_ASYNC_TOOL') {
        const result = await executeWithOptions<AsyncProbeResult, AsyncProbeInput>(
          'fas.async_probe',
          { mode: 'delay', value: message.value },
          { timeoutMs: 250 }
        );
        return { reply: result };
      }

      try {
        await executeWithOptions<AsyncProbeResult, AsyncProbeInput>(
          'fas.async_probe',
          { mode: 'hang' },
          { timeoutMs: 25 }
        );
      } catch (error) {
        return {
          reply: {
            code: (error as { readonly code?: string }).code,
          },
        };
      }

      throw new Error('Expected hung async probe tool to time out.');
    })
    .build();
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
    expect(fasAgentLoop.actors.taskBoard.address).toBe(
      'actor://fas-coordinator-runtime/fas-task-board'
    );
    expect(fasAgentLoop.actors.taskBoard.gateway).toEqual({
      scope: { kind: 'taskBoard' },
    });
    expect(fasAgentLoop.actors.taskRun.resolveAddress(TEST_TASK)).toBe(
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

  it('keeps a spawned actor responsive after a hung async tool times out', async () => {
    const asyncProbeActor = actor.withTools<AsyncProbeTools>()({
      id: 'fas-async-probe',
      node: 'worker',
      tools: ['fas.async_probe'] as const,
      behavior: createAsyncProbeBehavior,
    });
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('fas-async-tool-worker'),
      },
      tools: [tool('fas.async_probe')],
      actors: {
        asyncProbe: asyncProbeActor,
      },
    });
    let delayedToolRan = false;
    let hungToolSignal: AbortSignal | undefined;
    let hungToolAborted = false;
    const asyncProbeTools: AsyncProbeTools = {
      'fas.async_probe': async (input, context) => {
        if (input.mode === 'delay') {
          await new Promise((resolve) => setTimeout(resolve, 5));
          delayedToolRan = true;
          return {
            value: `async:${input.value}`,
            signalProvided: context.signal instanceof AbortSignal,
          };
        }

        hungToolSignal = context.signal;
        context.signal.addEventListener('abort', () => {
          hungToolAborted = true;
        });
        return new Promise<AsyncProbeResult>(() => {});
      },
    };
    const worker = await startActorWebNode(topology, {
      node: 'worker',
      tools: asyncProbeTools,
    });

    try {
      const probe = worker.requireActor('asyncProbe');

      await expect(
        probe.ask<AsyncProbeReply>({ type: 'RUN_ASYNC_TOOL', value: 'fas' }, 500)
      ).resolves.toEqual({
        value: 'async:fas',
        signalProvided: true,
      });
      await expect(probe.ask<AsyncProbeReply>({ type: 'RUN_HUNG_TOOL' }, 500)).resolves.toEqual({
        code: 'ACTOR_TOOL_TIMEOUT',
      });
      await expect(probe.ask<AsyncProbeReply>({ type: 'PING' }, 500)).resolves.toEqual({
        pong: true,
      });
      expect(delayedToolRan).toBe(true);
      expect(hungToolSignal).toBeInstanceOf(AbortSignal);
      expect(hungToolAborted).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it('projects the task board through the coordinator gateway source', async () => {
    runtime = await startFasAgentLoopExample();
    const source = runtime.createTaskBoardSource();

    try {
      await waitFor(
        () => source.transportStatus().state === 'connected',
        'Expected task board source to connect through the coordinator gateway'
      );

      expect(source.address).toBe('actor://fas-coordinator-runtime/fas-task-board');
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

    expect(first?.address).toBe('actor://fas-coordinator-runtime/fas-task-task-1001');
    expect(second?.address).toBe('actor://fas-coordinator-runtime/fas-task-task-2002');
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
