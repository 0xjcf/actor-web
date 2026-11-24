import type { ActorAgentLlmProvider } from '@actor-web/agent';
import { createAgent } from '@actor-web/agent/portable';
import {
  type AgentRunEvidenceBinding,
  AgentRunnerError,
  createAgentRunner,
} from '@actor-web/agent/runner';
import { structured } from '@actor-web/agent/zod';
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

const definition = {
  purpose: 'review' as const,
  systemPrompt: 'Review the supplied sources and cite the relevant excerpt.',
  tools: [readSource],
  output: structured(z.strictObject({ path: z.string(), excerpt: z.string().trim().min(1) }), {
    check: (finding, task: Assignment) =>
      task.files.some(
        ({ path, source }) => path === finding.path && source.includes(finding.excerpt)
      )
        ? undefined
        : 'The citation is not in the assigned inventory.',
  }),
};

function prepareReview(
  assignment: Assignment,
  { provider, signal = new AbortController().signal, onTool }: ReviewOptions
) {
  signal.throwIfAborted();
  const snapshot = {
    request: assignment.request,
    files: assignment.files.map(({ path, source }) => ({ path, source })),
  };
  const sources = new Map(snapshot.files.map(({ path, source }) => [path, source]));
  if (sources.size !== snapshot.files.length) {
    throw new AgentRunnerError('INVALID_ASSIGNMENT', 'Assigned paths must be unique.');
  }

  const runner = createAgentRunner<Assignment, 'review'>({
    definition,
    provider,
    grants: [readSource.name],
    tools: [
      {
        name: readSource.name,
        validateInput(input) {
          const result = readSourceInput.safeParse(input);
          if (!result.success) {
            throw new AgentRunnerError('INVALID_TOOL_INPUT', 'Expected one source path.');
          }
          if (!sources.has(result.data.path)) {
            throw new AgentRunnerError('PATH_DENIED', 'The path is not in the assigned inventory.');
          }
          return { value: result.data.path };
        },
        execute(path) {
          if (typeof path !== 'string') throw new Error('Expected a validated source path.');
          onTool?.('read_source');
          return sources.get(path);
        },
      },
      // This registered probe is never granted or advertised to the provider.
      {
        name: 'list_sources',
        validateInput: () => ({ value: undefined }),
        execute() {
          onTool?.('list_sources');
          return [...sources.keys()];
        },
      },
    ],
    encodeTask: (task) =>
      JSON.stringify({ request: task.request, paths: task.files.map(({ path }) => path) }),
    limits: {
      providerTimeoutMs: 500,
      askTimeoutMs: 1000,
      toolTimeoutMs: 250,
      runTimeoutMs: 3000,
      maxToolCallsPerBatch: 1,
      maxModelTurns: 2,
      maxToolAttempts: 1,
      maxPayloadBytes: 64 * 1024,
    },
  });
  return { runner, agent: createAgent(runner, definition), snapshot, signal };
}

export async function runSourceReview(
  assignment: Assignment,
  options: ReviewOptions
): Promise<{ path: string; excerpt: string }> {
  const { agent, snapshot, signal } = prepareReview(assignment, options);
  const finding = await agent.run({ ...snapshot, signal });
  signal.throwIfAborted();
  return finding;
}

/** Starts the scripted specialist with host-side citation validation and local evidence. */
export function startSourceReview(
  assignment: Assignment,
  options: ReviewOptions,
  binding: AgentRunEvidenceBinding
) {
  const {
    runner,
    agent: { purpose, systemPrompt, tools },
    snapshot,
    signal,
  } = prepareReview(assignment, options);
  const handle = runner.start({ purpose, systemPrompt, tools, task: snapshot, signal }, binding);
  const result = handle
    .validateOutput((raw) => definition.output.parse(raw, snapshot))
    .then((finding) => {
      signal.throwIfAborted();
      return finding;
    });
  // A host may collect evidence before consuming a rejected citation.
  void result.catch(() => {});
  return { result, readEvidence: handle.readEvidence, waitForSettlement: handle.waitForSettlement };
}
