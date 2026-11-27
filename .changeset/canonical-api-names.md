---
"@actor-web/runtime": minor
"@actor-web/agent": minor
"@actor-web/cli": patch
"@actor-web/lattice": patch
---

Use `defineTopology`, `startNode`, `serveHttp`, `createClient`, `createReadModelClient`, `createGatewaySource`, `createGatewayReadModelSource`, `createGatewayCommandSource`, `createGatewayTraceSource`, and `createSourceHandle` on their existing entry points. Associated types have shorter names, including `Topology`, `StartedNode`, and `ActorMessageOf<T>`. The original names remain available as deprecated aliases.

Use `LLM_TOOL_NAME` in place of `ACTOR_WEB_LLM_TOOL_NAME`. Both refer to the same `"llm"` tool.

The CLI host and lattice integration now use the canonical runtime names internally.
