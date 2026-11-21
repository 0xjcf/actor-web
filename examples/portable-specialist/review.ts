import {
  ACTOR_WEB_LLM_TOOL_NAME,
  type ActorAgentLlmProvider,
  type ActorAgentLoopReply,
  createActorAgentToolRegistry,
  createAgentLoopBehavior,
} from '@actor-web/agent';
import { type AgentRuntime, createAgent } from '@actor-web/agent/portable';
import { structured } from '@actor-web/agent/zod';
import { createActorToolbox, startRuntime } from '@actor-web/runtime';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
import { z } from 'zod';

type Assignment = {
  readonly request: string;
  readonly files: readonly { readonly path: string; readonly source: string }[];
};

type ReviewOptions = {
  readonly provider: ActorAgentLlmProvider;
  readonly signal?: AbortSignal;
  readonly onTool?: (name: 'read_source' | 'list_sources') => void;
};

const nodeAddress = 'portable-specialist';
const providerTimeoutMs = 500;
const askTimeoutMs = 1000;
const toolTimeoutMs = 250;

const readSourceInput = z.strictObject({ path: z.string().min(1) });
const readSource = {
  name: 'read_source' as const,
  description: 'Read one source file from the assigned inventory.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', minLength: 1 } },
    required: ['path'],
    additionalProperties: false,
  },
};

const grant = [readSource.name] as const;
const topology = defineActorWebTopology({
  nodes: { local: node(nodeAddress) },
  tools: [tool(ACTOR_WEB_LLM_TOOL_NAME), tool(readSource.name), tool('list_sources')],
  actors: {
    reviewer: actor({
      id: 'reviewer',
      node: 'local',
      tools: [ACTOR_WEB_LLM_TOOL_NAME, ...grant],
      supervision: { strategy: 'stop' },
      behavior: createAgentLoopBehavior({
        llmTimeoutMs: providerTimeoutMs,
        toolDefinitions: [
          {
            name: readSource.name,
            description: readSource.description,
            inputSchema: readSource.parameters,
          },
        ],
      }),
    }),
  },
});

function reviewFailure(code: string, message: string, cause?: unknown) {
  return Object.assign(new Error(message, { cause }), { code });
}

function requireStep(reply: ActorAgentLoopReply) {
  if (!reply.ok) {
    throw reviewFailure(reply.error.code, reply.error.message, reply.error.cause);
  }
  if (reply.status === 'reconciled' || reply.message.role !== 'assistant') {
    throw reviewFailure('UNEXPECTED_REPLY', 'Expected an assistant step.');
  }
  return reply;
}

export async function runSourceReview(
  assignment: Assignment,
  { provider, signal = new AbortController().signal, onTool }: ReviewOptions
): Promise<{ path: string; excerpt: string }> {
  signal.throwIfAborted();
  const snapshot = {
    request: assignment.request,
    files: assignment.files.map(({ path, source }) => ({ path, source })),
  };
  const sources = new Map(snapshot.files.map(({ path, source }) => [path, source]));
  if (sources.size !== snapshot.files.length) {
    throw reviewFailure('INVALID_ASSIGNMENT', 'Assigned paths must be unique.');
  }

  const applicationTools = {
    read_source: ({ path }: z.infer<typeof readSourceInput>) => {
      const source = sources.get(path);
      if (source === undefined) {
        throw reviewFailure('PATH_DENIED', 'The path is not in the assigned inventory.');
      }
      onTool?.('read_source');
      return source;
    },
    // This registered probe is never granted or advertised to the provider.
    list_sources: () => {
      onTool?.('list_sources');
      return [...sources.keys()];
    },
  };
  const tools = createActorToolbox(
    applicationTools,
    { actorId: topology.actors.reviewer.address, nodeAddress },
    grant,
    { defaultTimeoutMs: toolTimeoutMs }
  );
  const host = await startRuntime(topology, {
    tools: { ...createActorAgentToolRegistry({ llm: provider }), ...applicationTools },
  });

  const runtime: AgentRuntime<Assignment, 'review'> = {
    async run(turn) {
      turn.signal.throwIfAborted();
      const actor = host.requireActor('reviewer');
      const first = requireStep(
        await actor.ask<ActorAgentLoopReply>(
          {
            type: 'START_AGENT',
            system: turn.systemPrompt,
            prompt: JSON.stringify({
              request: turn.task.request,
              paths: turn.task.files.map(({ path }) => path),
            }),
          },
          askTimeoutMs
        )
      );
      turn.signal.throwIfAborted();
      const [call] = first.toolCalls;
      if (first.status !== 'waiting-for-tool' || first.toolCalls.length !== 1 || !call?.id) {
        throw reviewFailure('UNEXPECTED_REPLY', 'The first turn must request exactly one tool.');
      }
      if (call.name !== readSource.name || !tools.has(call.name)) {
        throw reviewFailure('TOOL_DENIED', 'The tool is not granted for this assignment.');
      }
      const input = readSourceInput.safeParse(call.input);
      if (!input.success) {
        throw reviewFailure('INVALID_TOOL_INPUT', 'Expected one source path.');
      }
      const output = await tools.execute(readSource.name, input.data);
      turn.signal.throwIfAborted();
      const last = requireStep(
        await actor.ask<ActorAgentLoopReply>(
          { type: 'OBSERVE_TOOL_RESULT', toolCallId: call.id, name: call.name, ok: true, output },
          askTimeoutMs
        )
      );
      if (last.status !== 'responded' || last.toolCalls.length !== 0) {
        throw reviewFailure('UNEXPECTED_REPLY', 'The second turn must finish the review.');
      }
      turn.signal.throwIfAborted();
      return last.message.content;
    },
  };

  let finding: { path: string; excerpt: string };
  try {
    const reviewer = createAgent(runtime, {
      purpose: 'review',
      systemPrompt: 'Review the supplied sources and cite the relevant excerpt.',
      tools: [readSource],
      output: structured(z.strictObject({ path: z.string(), excerpt: z.string().trim().min(1) }), {
        check: (finding, task: Assignment) =>
          task.files.some(
            ({ path, source }) => path === finding.path && source.includes(finding.excerpt)
          )
            ? undefined
            : 'The citation is not in the assigned source.',
      }),
    });
    finding = await reviewer.run({ ...snapshot, signal });
  } finally {
    await host.stop();
  }
  signal.throwIfAborted();
  return finding;
}
