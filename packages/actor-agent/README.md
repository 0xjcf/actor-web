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
| `ACTOR_WEB_LLM_TOOL_NAME` | Stable tool name for the injected LLM provider |
| `ActorAgent*` types | Message, event, provider, tool-call, and error contracts |

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

## License

MIT
