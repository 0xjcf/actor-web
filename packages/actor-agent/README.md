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

## Public API

| Export | Use for |
| --- | --- |
| `createAgentLoopBehavior(options?)` | Standard agent loop behavior that accepts `START_AGENT`, observes tool results, and emits agent step/tool events |
| `createActorAgentToolRegistry({ llm })` | Typed `llm` tool registration for runtime toolboxes |
| `createActorAgentTools({ llm })` | Runtime-ready tool registry for `startRuntime(..., { tools })` |
| `createOpenAiCompatibleLlmProvider({ endpoint, model, timeoutMs?, ... })` | Adapter for Ollama and OpenAI-compatible local endpoints without importing provider SDKs |
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

## OpenAI-compatible local provider

Use `createOpenAiCompatibleLlmProvider()` when the caller already owns endpoint,
model, headers, and credential policy for an Ollama or OpenAI-compatible MLX
server.

```ts
import {
  createActorAgentTools,
  createOpenAiCompatibleLlmProvider,
} from '@actor-web/agent';

const llm = createOpenAiCompatibleLlmProvider({
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
server. It is skipped by default and is not part of CI.

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
install Ollama, MLX, models, credentials, or any local server process.

## Message contract

The standard loop accepts:

- `START_AGENT` with a user prompt and optional per-message system override.
- `OBSERVE_TOOL_RESULT` to feed a prior tool result back into the loop.
- `GET_AGENT_CONTEXT` to inspect the loop context.

The loop emits:

- `AGENT_STEP_COMPLETED`
- `AGENT_TOOL_CALL_REQUESTED`
- `AGENT_TOOL_RESULT_OBSERVED`
- `AGENT_STEP_FAILED`

Expected failures are returned as data with `{ ok: false, error }`; providers
should do the same so runtime hosts can project failures without throwing across
actor boundaries.

## Non-goals

- No provider SDK dependency is added to `@actor-web/agent`.
- The package does not read environment variables, files, or local storage in
  production code.
- Tool authorization does not move out of the Actor-Web runtime toolbox.
- Credentials are caller-supplied and should not be logged or persisted by host
  code.

## License

MIT
