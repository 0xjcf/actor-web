# @actor-web/agent

## 0.3.0

### Minor Changes

- Use `LLM_TOOL_NAME` for the injected model tool. `ACTOR_WEB_LLM_TOOL_NAME` remains a deprecated alias for the same `"llm"` value.

- Add the browser-safe `@actor-web/agent/runner` entry. `createAgent({ spec, ...options })` constructs a typed agent and its trusted runner in one call. `createAgentRunner` implements the portable `AgentRunner` contract with a fresh in-process actor session and explicit per-assignment budgets, exposing lower-level settlement and evidence handles. Preview consumers of `createActorRuntime` should switch to this entry, rename `AgentDefinition` to `AgentSpec` and the runner option `definition` to `spec`, and handle `SPEC_MISMATCH` in place of `DEFINITION_MISMATCH`. Other machine-readable error codes are unchanged.

  Prefer `ModelToolDefinition` and `createLlmToolRegistry` for provider-facing tool metadata and typed LLM registration. The published names `ActorAgentToolDefinition` and `createActorAgentToolRegistry` remain available.

  Use the new `@actor-web/agent/terminal` entry to format individual trace events or stream them through `trace.onEvent`. Terminal reporting is opt-in and independent of capture profiles and JSONL export.

- f18df55: Allow hosts to defer the model turn after a final `OBSERVE_TOOL_RESULT` and resume it with `CONTINUE_AGENT`. Persist the pause in loop checkpoints. Reject receipts that do not match a unique outstanding call by ID and name.
- b267612: Add the `portable` entry point for typed agents bound to an explicit runner and the optional `zod` entry point for task-aware structured output.
- Add optional input/result examples to portable tool declarations. Local actor hosts can opt in to rendering examples in authorized tool descriptions without adding synthetic tool calls or observations.
- 3a20cb6: Use `createLlmProvider` with a `/responses` endpoint for the OpenAI Responses protocol; chat completions remain supported. Set `parallelToolCalls` to `false` to request at most one tool call per turn. On compatible Responses models, `reasoningSummary` requests a summary explicitly. `START_AGENT` now accepts `reset` to replace the history of a reused actor.
- 3a20cb6: **Migration from 0.2.x:** replace imports of `createOpenAiCompatibleLlmProvider` and `OpenAiCompatibleLlmProviderOptions` with `createLlmProvider` and `LlmProviderOptions` from `@actor-web/agent`. The old names are no longer exported. Existing endpoint, model and header options carry over.

### Patch Changes

- Update the runtime dependency to `@actor-web/runtime@0.4.0`.

## 0.2.2

### Patch Changes

- Updated dependencies [f91b528]
  - @actor-web/runtime@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [1a38459]
- Updated dependencies [c1e98a8]
- Updated dependencies [c79f2dc]
  - @actor-web/runtime@0.2.1

## 0.2.0

### Minor Changes

- 774d077: Prepare the 0.2.0 release line across the public package surface.

  - First-publish `@actor-web/agent` with the standard runtime-hosted LLM loop,
    typed `llm` tool adapter, and errors-as-data agent event contract.
  - First-publish `@actor-web/lattice` with artifact coordination,
    dependency-based activation, runtime wiring, timeout re-emission, and journal
    replay seams.
  - Ship the runtime changes accumulated since 0.1.0, including bounded restart
    behavior that now permanently stops crash-looping actors after their declared
    restart budget, branded string actor addresses, API-honesty removals for
    unsupported delivery modes, and the backpressured runtime transport stream
    host.
  - Keep `@actor-web/testing` in the fixed runtime/testing release group.

  Breaking runtime notes:

  - Consumers relying on the previous unbounded restart bug must now handle
    permanent actor stops after the default budget of 3 restarts per 30 seconds
    or the actor's declared supervision policy.
  - `SendInstruction` no longer exposes unsupported retry or guaranteed delivery
    modes.
  - `SpawnOptions` is narrowed to the supported actor id and supervision options.
    Application-level acknowledgement protocols remain the path for stronger
    delivery guarantees than at-most-once `send`.

### Patch Changes

- Updated dependencies [3abee61]
- Updated dependencies [9121c1a]
- Updated dependencies [774d077]
- Updated dependencies [4af688c]
  - @actor-web/runtime@0.2.0

## 0.2.0

Initial public release of the Actor-Web agent package.

- Standard agent-loop behavior for runtime-hosted LLM workflows.
- Typed `llm` tool adapter and provider contract.
- Errors-as-data loop result and agent event contract.
- Dual ESM and CJS build.
