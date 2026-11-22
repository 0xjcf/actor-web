import type { ActorAgentLlmProvider } from '@actor-web/agent';
import { ActorRuntimeError, createActorRuntime } from '@actor-web/agent/actor-runtime';
import { createAgent } from '@actor-web/agent/portable';
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
    throw new ActorRuntimeError('INVALID_ASSIGNMENT', 'Assigned paths must be unique.');
  }

  const runtime = createActorRuntime<Assignment, 'review'>({
    definition,
    provider,
    grants: [readSource.name],
    tools: [
      {
        name: readSource.name,
        validateInput(input) {
          const result = readSourceInput.safeParse(input);
          if (!result.success) {
            throw new ActorRuntimeError('INVALID_TOOL_INPUT', 'Expected one source path.');
          }
          if (!sources.has(result.data.path)) {
            throw new ActorRuntimeError(
              'PATH_DENIED',
              'The path is not in the assigned inventory.'
            );
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
    },
  });
  const finding = await createAgent(runtime, definition).run({ ...snapshot, signal });
  signal.throwIfAborted();
  return finding;
}
