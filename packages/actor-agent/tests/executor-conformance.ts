import type { ActorRuntimeOptions } from '../src/actor-runtime.js';
import type {
  ActorAgentLlmRequest,
  ActorAgentLlmResult,
  ActorAgentToolCall,
} from '../src/index.js';
import type { AgentRuntime } from '../src/portable.js';

type Assignment = {
  readonly prompt: string;
  readonly sources: Readonly<Record<string, string>>;
};

export type ExecutorFactory = (
  options: ActorRuntimeOptions<Assignment, 'review'>
) => AgentRuntime<Assignment, 'review'> | Promise<AgentRuntime<Assignment, 'review'>>;

export class ExecutorConformanceViolation extends Error {
  constructor(
    readonly caseId: string,
    readonly checkId: string
  ) {
    super(`${caseId}: ${checkId}`);
    this.name = 'ExecutorConformanceViolation';
  }
}

type Check = (checkId: string, passes: boolean) => void;

function conformanceCase<Id extends string>(
  id: Id,
  name: string,
  exercise: (make: ExecutorFactory, check: Check) => Promise<void>
) {
  return {
    id,
    name,
    run: (make: ExecutorFactory): Promise<void> =>
      exercise(make, (checkId, passes) => {
        if (!passes) throw new ExecutorConformanceViolation(id, checkId);
      }),
  };
}

const read = 'read_source';
const ungranted = 'read_ungranted';
const missing = 'read_missing';
const unrequested = 'read_unrequested';

const assistant = (content: string, toolCalls?: readonly ActorAgentToolCall[]) =>
  ({ ok: true, value: { message: { role: 'assistant', content, toolCalls } } }) as const;

const call = (id: string, path: string, name = read) => ({ id, name, input: { path } });

function assignment(label: string): Assignment {
  return {
    prompt: `Review assignment ${label}.`,
    sources: { first: `${label}: first excerpt`, second: `${label}: second excerpt` },
  };
}

function pathFrom(input: unknown): string | undefined {
  return typeof input === 'object' &&
    input !== null &&
    'path' in input &&
    typeof input.path === 'string'
    ? input.path
    : undefined;
}

async function fixture(make: ExecutorFactory, script: (attempt: number) => ActorAgentLlmResult) {
  // Cases get independent inputs. Port callbacks record observations but never run assertions.
  const requests: ActorAgentLlmRequest[] = [];
  const effects: { name: string; input: unknown; prompt: string }[] = [];
  const definition = {
    purpose: 'review' as const,
    systemPrompt: 'Review only the assigned sources.',
    tools: [read, ungranted, missing].map((name) => ({
      name,
      description: `Read using ${name}.`,
      parameters: { type: 'object' },
    })),
  };
  const runtime = await make({
    definition,
    encodeTask: (task) => task.prompt,
    grants: [read, missing, unrequested],
    limits: {
      runTimeoutMs: 10_000,
      askTimeoutMs: 5_000,
      providerTimeoutMs: 5_000,
      toolTimeoutMs: 5_000,
      maxToolCallsPerBatch: 2,
    },
    provider(request) {
      const attempt = requests.length;
      requests.push(structuredClone(request));
      return script(attempt);
    },
    tools: [read, ungranted, unrequested].map((name) => ({
      name,
      validateInput(input, task) {
        const path = pathFrom(input);
        if (path === undefined || !Object.hasOwn(task.sources, path)) {
          throw new Error('Expected a path from the assigned sources.');
        }
        return { value: path };
      },
      execute(input, task) {
        effects.push({ name, input: structuredClone(input), prompt: task.prompt });
        if (typeof input !== 'string') throw new Error('Expected a validated path.');
        return task.sources[input];
      },
    })),
  });
  return {
    requests,
    effects,
    run: (task: Assignment, signal = new AbortController().signal) =>
      runtime.run({ ...definition, task, signal }),
  };
}

function scriptSteps(...steps: ActorAgentLlmResult[]) {
  return (attempt: number): ActorAgentLlmResult =>
    steps[attempt] ?? {
      ok: false,
      error: { code: 'UNEXPECTED_SCRIPT_STEP', message: 'The provider script was exhausted.' },
    };
}

function outputFrom(content: string): unknown {
  try {
    const value: unknown = JSON.parse(content);
    if (
      typeof value === 'object' &&
      value !== null &&
      'ok' in value &&
      value.ok === true &&
      'output' in value
    ) {
      return value.output;
    }
  } catch {
    // Malformed output is observed as a correlation failure outside the scripted provider.
  }
  return undefined;
}

async function observeRun(run: () => Promise<string>) {
  try {
    return { ok: true, text: await run() } as const;
  } catch (error) {
    return { ok: false, error } as const;
  }
}

function hasCode(error: unknown, code: string): error is { code: string; message?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Offline cases for public executor behavior. No runtime start, actor identity, or timing probes. */
export const executorConformanceCases = [
  conformanceCase(
    'fresh-history',
    'round-trips authorized results and starts each sequential assignment without history',
    async (make, check) => {
      const calls = [call('source-a', 'first'), call('source-b', 'second')];
      const proposal = 'Read before responding.';
      const final = ['First assignment complete.', 'Second assignment complete.'];
      const probe = await fixture(
        make,
        scriptSteps(
          assistant(proposal, calls),
          assistant(final[0]),
          assistant(proposal, calls),
          assistant(final[1])
        )
      );

      // Use the same runtime and call IDs, but distinct assignment text and source contents.
      for (const [index, label] of ['one', 'two'].entries()) {
        const task = assignment(label);
        const requestStart = probe.requests.length;
        const effectStart = probe.effects.length;
        const text = await probe.run(task);
        const requests = probe.requests.slice(requestStart);
        const effects = probe.effects.slice(effectStart);
        const [initial, followup] = requests;
        check('two-provider-steps-per-assignment', requests.length === 2);
        check(
          index === 0 ? 'first-assignment-empty-history' : 'second-assignment-empty-history',
          initial?.messages.length === 1 &&
            initial.messages[0]?.role === 'user' &&
            initial.messages[0].content === task.prompt
        );
        check('returns-final-assistant-text', text === final[index]);
        check(
          'authorized-inputs-executed-once',
          effects.length === calls.length &&
            calls.every(({ input }) =>
              effects.some(
                (effect) =>
                  effect.name === read &&
                  effect.input === input.path &&
                  effect.prompt === task.prompt
              )
            )
        );
        const [user, toolRequest, ...results] = followup?.messages ?? [];
        const observedCalls = toolRequest?.toolCalls ?? [];
        check(
          'followup-retains-current-turn',
          user?.role === 'user' &&
            user.content === task.prompt &&
            toolRequest?.role === 'assistant' &&
            toolRequest.content === proposal
        );
        check(
          'followup-retains-tool-calls',
          observedCalls.length === calls.length &&
            calls.every(({ id, name, input }) =>
              observedCalls.some(
                (observed) =>
                  observed.id === id &&
                  observed.name === name &&
                  pathFrom(observed.input) === input.path
              )
            )
        );
        check(
          'tool-replies-correlated-by-id-and-name',
          results.length === calls.length &&
            calls.every(({ id, name, input }) =>
              results.some(
                (message) =>
                  message.role === 'tool' &&
                  message.toolCallId === id &&
                  message.toolName === name &&
                  outputFrom(message.content) === task.sources[input.path]
              )
            )
        );
      }
    }
  ),
  conformanceCase(
    'grant-intersection',
    'only advertises effective grants and denies a mixed batch before any tool effect',
    async (make, check) => {
      const probe = await fixture(
        make,
        scriptSteps(
          assistant('Use two tools.', [
            call('allowed', 'first'),
            call('denied', 'second', ungranted),
          ]),
          assistant('Both tools ran.')
        )
      );
      const outcome = await observeRun(() => probe.run(assignment('mixed')));
      const [request] = probe.requests;
      check('ungranted-tool-not-dispatched', !probe.effects.some(({ name }) => name === ungranted));
      check('mixed-batch-zero-effects', probe.effects.length === 0);
      check(
        'exact-advertised-tool-names',
        request?.tools.length === 1 && request.tools[0] === read
      );
      check(
        'exact-advertised-tool-definitions',
        request?.toolDefinitions?.length === 1 && request.toolDefinitions[0]?.name === read
      );
      check('rejects-denied-tool', !outcome.ok && hasCode(outcome.error, 'TOOL_DENIED'));
      check('no-provider-continuation', probe.requests.length === 1);
    }
  ),
  conformanceCase(
    'provider-failure',
    'preserves a provider failure after exactly one attempt and no tool effects',
    async (make, check) => {
      const failure = {
        code: 'LLM_PROVIDER_UNAVAILABLE',
        message: 'Scripted provider unavailable.',
      };
      // Repeating the same failure lets the oracle distinguish a retry from a changed rejection.
      const probe = await fixture(make, () => ({ ok: false, error: { ...failure } }));
      const outcome = await observeRun(() => probe.run(assignment('provider-failure')));
      check(
        'preserves-provider-failure',
        !outcome.ok &&
          hasCode(outcome.error, failure.code) &&
          outcome.error.message === failure.message
      );
      check('exactly-one-provider-attempt', probe.requests.length === 1);
      check('provider-failure-zero-effects', probe.effects.length === 0);
    }
  ),
  conformanceCase(
    'pre-abort',
    'refuses a pre-aborted assignment before provider or tool dispatch',
    async (make, check) => {
      const probe = await fixture(make, () => assistant('Unexpected dispatch.'));
      const controller = new AbortController();
      controller.abort();
      const outcome = await observeRun(() => probe.run(assignment('pre-abort'), controller.signal));
      check('pre-abort-zero-provider-attempts', probe.requests.length === 0);
      check('pre-abort-zero-effects', probe.effects.length === 0);
      check('rejects-aborted-assignment', !outcome.ok && hasCode(outcome.error, 'RUN_ABORTED'));
    }
  ),
] as const;
