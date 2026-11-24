---
"@actor-web/agent": minor
---

Add the browser-safe `@actor-web/agent/runner` entry. `createAgentRunner` implements the portable `AgentRunner` contract with a fresh in-process actor session and explicit per-assignment budgets. Preview consumers of `createActorRuntime` should switch to this entry; machine-readable error codes are unchanged.

Prefer `ModelToolDefinition` and `createLlmToolRegistry` for provider-facing tool metadata and typed LLM registration. The published names `ActorAgentToolDefinition` and `createActorAgentToolRegistry` remain available.
