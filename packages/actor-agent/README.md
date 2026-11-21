# @actor-web/agent

LLM tool and agent-loop utilities for Actor-Web runtime hosts.

This package is the agent layer for Actor-Web. It does not introduce a second
behavior authoring model: `createAgentLoopBehavior()` returns a normal
Actor-Web behavior built with `defineBehavior()`. Use `defineBehavior()` for
custom agent behavior and this package when you want the standard LLM tool loop.

## Install

```bash
npm install @actor-web/runtime @actor-web/agent
```

The examples below use APIs added after `@actor-web/agent@0.2.1`. If you are
pinned to `0.2.1`, use `createOpenAiCompatibleLlmProvider` and the Chat
Completions API. That version does not include Responses support, `START_AGENT`
with `reset`, or the `./portable` and `./zod` entry points.

## Public API

| Export | Use for |
| --- | --- |
| `createAgentLoopBehavior(options?)` | Standard agent loop behavior that accepts `START_AGENT`, observes tool results, and emits agent step/tool events |
| `createActorAgentToolRegistry({ llm })` | Typed `llm` tool registration for runtime toolboxes |
| `createActorAgentTools({ llm })` | Runtime-ready tool registry for `startRuntime(..., { tools })` |
| `createLlmProvider({ endpoint, model, timeoutMs?, ... })` | Chat Completions adapter. An endpoint path that ends in `/responses` uses the Responses wire. The host supplies the endpoint, model, and headers |
| `ACTOR_WEB_LLM_TOOL_NAME` | Stable tool name for the injected LLM provider |
| `ActorAgent*` types | Message, event, provider, tool-call, tool-definition, and error contracts |

## Usage

```ts
import { createAgentLoopBehavior, createActorAgentTools } from '@actor-web/agent';
import { startRuntime } from '@actor-web/runtime';
import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';

const topology = defineActorWebTopology({
  nodes: { local: node('local') },
  actors: {
    planner: actor({
      id: 'planner',
      node: 'local',
      behavior: createAgentLoopBehavior({
        system: 'You are a careful planner.',
      }),
      tools: ['llm', 'repo.status'],
    }),
  },
});

const runtime = await startRuntime(topology, {
  tools: {
    ...createActorAgentTools({ llm: myLlmProvider }),
    'repo.status': async () => ({ ok: true, clean: true }),
  },
});

const planner = runtime.requireActor('planner');
const result = await planner.ask({
  type: 'START_AGENT',
  prompt: 'Plan task-1.',
});
```

Tests may drive the returned behavior directly, but application code should host
it through an actor or topology so mailbox, tool access, cancellation, and
supervision stay under the runtime.

## Portable phase definitions

`@actor-web/agent/portable` exports `createAgent(runtime, definition)`. Unlike
`createAgentLoopBehavior`, it does not start an actor or drive a tool loop. Each
call to `run` sends one turn to the supplied executor, forwarding its signal
separately from the flat task data, and returns the decoded result. Supply a
plain data object for the task; `signal` is reserved. The host still owns tool
grants, cancellation, independent sessions, and acceptance of the candidate.

The [portable tests](tests/portable.test.ts) use supplied functions to exercise
turn binding, task-aware output checks, and error propagation. A cancellation
test uses an executor that honors the signal. `createAgent` forwards the
signal, but does not enforce pre-dispatch abort, reject late output from an
executor that ignores abort, or wait for cleanup. These tests do not qualify
the actor-backed executor planned in the [M1 backlog](../../docs/todos.md).
The [specialist execution contract](../../docs/specialist-execution-contract.md)
specifies what that host must enforce from assignment through settlement.

For JSON responses, install `zod@^4` and import `structured` from
`@actor-web/agent/zod`. Neither the package root nor `portable` imports Zod.
Use a synchronous, JSON-representable schema. Its input schema supplies response
instructions once at construction; after JSON and schema validation, an optional
`check` receives the typed content and the assignment. Return a reason to reject.

```ts
import { createAgent, type AgentRuntime } from '@actor-web/agent/portable';
import { structured } from '@actor-web/agent/zod';
import { z } from 'zod';

type Assignment = {
  files: readonly { path: string; source: string }[];
  expertise: { id: string; revision: number; rules: readonly string[] };
};
const finding = z.strictObject({ path: z.string(), excerpt: z.string().trim().min(1) });
const reviewOutput = structured(z.strictObject({ findings: z.array(finding) }), {
  check({ findings }, task: Assignment) {
    for (const { path, excerpt } of findings) {
      if (!task.files.some((f) => f.path === path && f.source.includes(excerpt))) {
        return `Finding does not cite supplied source: ${path}`;
      }
    }
  },
});

function createReviewer(runtime: AgentRuntime<Assignment, 'review'>) {
  return createAgent(runtime, {
    purpose: 'review',
    systemPrompt: 'Review the assigned sources and cite each finding.',
    tools: [],
    output: reviewOutput,
  });
}

const igniteExpertise = {
  id: 'ignite-element', revision: 1,
  rules: ['Sending a command expresses intent, not confirmed success.'],
} as const;
// Host selects this same expertise for distinct Build and Review assignments.
// A builder can have scoped write grants; this reviewer requests none.
```

`reviewer.run({ files, expertise: igniteExpertise, signal })` invokes the
executor. `reviewOutput.parse(raw, { files, expertise: igniteExpertise })` instead
checks already-produced text without invoking it. An `AgentOutputError` carries
`invalidJson`, `schemaMismatch`, or `taskMismatch`; executor errors propagate
unchanged. No implicit retry, repair, or phase transition occurs.

For a non-JSON protocol use `parse(raw, task)` **instead of** `output`, or pass
`output: { parse: existingParser }` to reuse the decoder separately. No schema
instructions are appended in either case unless an output supplies `instructions`.

## LLM provider

Use `createLlmProvider()` when the caller already owns the endpoint, model,
headers, and credential policy. The adapter speaks Chat Completions, so the
same call reaches Ollama, MLX, OpenAI, or Grok. An endpoint whose path ends in
`/responses` speaks the OpenAI Responses API, which is what Codex models
require. It does not import a provider SDK.

```ts
import { createActorAgentTools, createLlmProvider } from '@actor-web/agent';

const llm = createLlmProvider({
  endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'qwen2.5',
  timeoutMs: 15_000,
  headers: {
    authorization: `Bearer ${token}`,
  },
  credentials: 'omit',
});

const tools = createActorAgentTools({ llm });
```

`tools: string[]` remains the runtime authorization surface. Optional
`toolDefinitions` can carry provider-neutral JSON Schema metadata into the wire
request for compatible providers, but the runtime toolbox still decides which
tools are exposed on a given turn. Direct callers cannot widen that boundary by
passing extra tool definitions: the adapter filters both outbound tool
definitions and inbound tool calls against the authoritative `request.tools`
list.

Expected failures are returned as data with reason codes such as:

- `LLM_PROVIDER_UNAVAILABLE`
- `LLM_PROVIDER_TIMEOUT`
- `LLM_PROVIDER_CANCELLED`
- `LLM_PROVIDER_INVALID_RESPONSE`
- `LLM_TOOL_ARGUMENTS_INVALID`
- `LLM_TOOL_UNSUPPORTED`

Unavailable failures are intentionally sanitized. The adapter does not expose
raw thrown network error text in expected failure facts.

## Live conformance

The package includes an opt-in live lane for an already-running compatible
server. It is skipped by default and is not part of CI. The configured model
must support tool calling.

```bash
ACTOR_AGENT_OPENAI_COMPAT_ENDPOINT=http://127.0.0.1:11434/v1/chat/completions \
ACTOR_AGENT_OPENAI_COMPAT_MODEL=qwen2.5 \
pnpm --filter @actor-web/agent test:live:openai-compatible
```

Optional environment variables:

- `ACTOR_AGENT_OPENAI_COMPAT_AUTH_HEADER`
- `ACTOR_AGENT_OPENAI_COMPAT_AUTH_VALUE`
- `ACTOR_AGENT_OPENAI_COMPAT_CREDENTIALS`

The test only verifies a caller-configured endpoint. It does not start or
install Ollama, MLX, models, credentials, or any local server process. The
lane requests a single `report_ready` tool call and verifies the normalized
tool-call payload, but it does not execute any capability.

## Message contract

The standard loop accepts:

- `START_AGENT` with a user prompt, an optional per-message system override, and
  optional `reset`. `reset: true` replaces history on a reused actor; it does not
  create a fresh session or establish that earlier work settled.
- `OBSERVE_TOOL_RESULT` to feed a prior tool result back into the loop.
- `RECONCILE_AGENT_SESSION` to submit a reconciliation receipt when a checkpoint
  store is configured.
- `GET_AGENT_CONTEXT` to inspect the loop context.

The loop emits:

- `AGENT_STEP_COMPLETED`
- `AGENT_TOOL_CALL_REQUESTED`
- `AGENT_TOOL_RESULT_OBSERVED`
- `AGENT_STEP_FAILED`
- `AGENT_SESSION_RECONCILED`

Expected failures are returned as data with `{ ok: false, error }`; providers
should do the same so runtime hosts can project failures without throwing across
actor boundaries.

## Checkpoints and cancellation

The loop accepts an optional `checkpoint` configuration with a host-supplied
store. The [loop tests](src/agent-loop.test.ts) cover checkpoint restore and
deferral when an effect needs reconciliation. Restoring saved loop state is not
proof of crash-safe effects or cross-process ownership. An abort or a timeout
can return control before underlying work has stopped. See the
[runtime contract](../../docs/provider-neutral-agent-execution-contract.md#semantics)
for the distinction between dispatch, effect outcome, and reconciliation.

## Non-goals

- No provider SDK dependency is added to `@actor-web/agent`.
- The package does not read environment variables, files, or local storage in
  production code.
- Tool authorization does not move out of the Actor-Web runtime toolbox.
- Credentials are caller-supplied and should not be logged or persisted by host
  code.

## License

MIT
