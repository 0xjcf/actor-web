---
"@actor-web/agent": minor
---

Add the browser-safe `@actor-web/agent/runner` entry. `createAgent({ spec, ...options })` constructs a typed agent and its trusted runner in one call. `createAgentRunner` implements the portable `AgentRunner` contract with a fresh in-process actor session and explicit per-assignment budgets, exposing lower-level settlement and evidence handles. Preview consumers of `createActorRuntime` should switch to this entry, rename `AgentDefinition` to `AgentSpec` and the runner option `definition` to `spec`, and handle `SPEC_MISMATCH` in place of `DEFINITION_MISMATCH`. Other machine-readable error codes are unchanged.

Prefer `ModelToolDefinition` and `createLlmToolRegistry` for provider-facing tool metadata and typed LLM registration. The published names `ActorAgentToolDefinition` and `createActorAgentToolRegistry` remain available.
