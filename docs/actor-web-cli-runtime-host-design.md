# Design: `@actor-web/cli` as an Actor/Agent Runtime Host

- **Status:** Draft / dogfood implementation in progress
- **Date:** 2026-06-09
- **Owner:** actor-web
- **Related:** [actor-web-actor-dx-design.md](./actor-web-actor-dx-design.md),
  [actor-web-decoupling-design.md](./actor-web-decoupling-design.md)

## Summary

Reconceive `@actor-web/cli` from a git-workflow tool (the current `aw`
save/ship/sync/worktrees commands) into a **terminal host for the actor-web
runtime**: start a runtime node, spawn actors and agents, send/ask messages,
subscribe to their event streams, and connect to remote nodes — all from the
shell. The git-workflow surface that exists today is unrelated to this purpose
and overlaps with FAS; it is not the foundation we build on.

The thesis is a clean two-plane split:

- **FAS = control plane.** Defines *what* agents/actors exist, their behaviors,
  and their boundaries — the specification and the workflow.
- **actor-web = runtime / data plane.** *Runs* those actors with mailboxes,
  supervision, location transparency, and message passing.
- **The CLI** is the terminal entry point to the data plane: the thing that
  takes a topology + behaviors and makes it a live, observable system.

## Motivation: what do we gain over a chatbot coding agent?

This is the question that decides whether the project is worth doing. If the
answer is "nothing you can't get from Claude Code / Codex / Cursor," we stop.

**They solve a different problem than an actor runtime does.** A coding-agent
chatbot is an *agent you drive*. An actor-runtime agent is an *agent you
deploy*. Concretely:

| Dimension | Chatbot coding agent (Claude Code, Codex, Cursor) | Actor-runtime agent (actor-web) |
| --- | --- | --- |
| **Lifetime** | Ephemeral — lives for a turn/session; dies between prompts | Persistent process with durable identity (`actor://node/type/id`) and a mailbox |
| **Driver** | Human-in-the-loop, synchronous; you steer each turn | Autonomous — triggered by events, schedules, or other agents |
| **Concurrency** | One primary agent; subagents are ad-hoc, in-memory, unsupervised | Many isolated actors, private state, no shared-memory races, mailbox backpressure |
| **Failure** | Subagent errors bubble up; you recover by hand | Supervised — a crashed agent is restarted by its supervisor (OTP-style) |
| **Topology** | One process on your machine | Location-transparent across processes/machines over a WebSocket transport |
| **Coordination** | The orchestrator threads context manually | `emit` → `subscribe` choreography; agents react to each other's events |
| **Reproducibility** | An imperative session you can't replay | Declarative topology-as-code: testable, versionable, restartable |
| **Boundaries** | Whatever tools the harness grants | Runtime-enforced per-actor capability allow-lists (`toolAccess`) |

**What we do *not* gain — be honest:**

- **Not more intelligence.** It's the same model underneath. The runtime makes
  agents *durable, concurrent, and supervised* — not smarter.
- **Not a better interactive experience.** For a developer at a keyboard doing
  one task, Claude Code is strictly better. This is not a replacement for how
  you're working right now.
- **Not free.** You take on runtime/operational surface (a node to run, a
  transport to secure, agents to observe) that a chatbot hides.

So the gain is a **different problem class**: long-running, multi-agent,
distributed, autonomous systems that must survive crashes and respect
boundaries — the place where "an LLM in a chat loop" stops being enough and you
need an actual *system*. The actor model is one of the best-studied substrates
for exactly that (Erlang/OTP, Akka), and actor-web already implements its core.

**Why this matters specifically for FAS.** FAS is already a control plane that
wants to define agents, behaviors, and boundaries — but today it executes by
spawning *ephemeral chatbot subagents per task*. It has no first-class runtime
in which its defined agents live as durable, supervised, observable processes.
An actor-runtime host closes that gap: FAS defines once (control plane); the CLI
runs the definition as supervised actors (data plane); boundaries become
`toolAccess` enforced at runtime. That is a capability FAS does not have by
wrapping Claude Code.

## Where this sits

```text
        ┌─────────────────────────────────────────────┐
        │  FAS  (control plane)                          │
        │  • defines agent roles, behaviors, boundaries  │
        │  • emits: topology + behavior modules +        │
        │           toolAccess (capability boundaries)   │
        └───────────────────────┬─────────────────────┘
                                │  topology-as-code
                                ▼
        ┌─────────────────────────────────────────────┐
        │  @actor-web/cli  (host / executor)             │
        │  serve · spawn · send/ask · watch · ls · connect│
        └───────────────────────┬─────────────────────┘
                                │  uses
                                ▼
        ┌─────────────────────────────────────────────┐
        │  @actor-web/runtime  (data plane)              │
        │  createActorSystem · serveNode · transports ·  │
        │  supervision · directory · emit/subscribe      │
        └─────────────────────────────────────────────┘
```

The CLI is thin: it is an operator/console over runtime primitives that already
exist. It owns no domain logic.

## The FAS ↔ actor-web contract

The boundary between the planes is a small, explicit handoff:

1. **Topology** — a `defineActorWebTopology({ actors, supervisors, subscriptions })`
   value (file or generated). Declares which agents exist, how they are
   supervised, and which events flow between them.
2. **Behaviors** — `defineBehavior().withMachine()/.withFSM()` modules. Each
   agent's logic. Authored by hand or scaffolded by FAS.
3. **Boundaries** — `toolAccess: Record<actorPath, string[]>`: which tools each
   agent may call. FAS *defines* the boundary; the runtime *enforces* it at
   `createActorToolbox` time. This is the concrete realization of FAS's
   "boundaries" concept as a runtime guarantee, not a guideline.

The CLI consumes exactly these three and nothing else from FAS. FAS never
imports actor-web (preserving the decoupling already completed).

## Actors vs agents

The runtime gives us **actors**. An **agent** is an actor whose behavior loop
calls an LLM. The distinction matters for scope:

- **Provided by `@actor-web/runtime` today:** spawning, mailboxes, supervision,
  location transparency, `emit`/`subscribe`, the directory/lookup, the WebSocket
  transport, and a generic `ActorToolRegistry` (tools are plain
  `async (input, ctx) => output` functions) with per-actor `toolAccess`.
- **Not provided (must be built in the agent layer):** the LLM call itself, the
  agent loop (prompt → tool-call → observe → repeat), context/memory management,
  streaming, model selection, and token/cost accounting. This is the hard 80% of
  "agents"; the actor substrate is the easy, well-understood 20%.

**Design rule:** keep the LLM/agent specifics *out of the core runtime*. The
runtime stays a general actor system. **The agent layer lives in a dedicated
`@actor-web/agent` package** (decided), layered on top of `@actor-web/runtime` —
not in the runtime and not in the CLI. This protects actor-web's identity as a
general runtime, keeps the LLM vendor dependency isolated to one package, and
lets non-agent consumers use the runtime/CLI without pulling in an LLM SDK.

### Package layout

```text
@actor-web/runtime   general actor runtime — NO LLM dependency
        ▲
        │ depends on
@actor-web/agent     llm tool + agent-loop behavior + memory/streaming;
                     owns the LLM provider/tool boundary
        ▲
        │ depends on (runtime always; agent optionally)
@actor-web/cli       host/console (serve/spawn/send/watch). Registers the
                     agent package's llm tool when hosting agents, but can
                     host plain actors with no agent dependency at all.
```

Dependency direction is one-way: `cli → agent → runtime`. The runtime never
imports the agent package; the CLI's agent support is an optional capability,
not a hard dependency.

## CLI surface (v0)

A minimal, kubectl-for-actors shape:

```bash
actor-web serve ./topology.ts --node worker [--gateway] [--transport]
    # host a runtime node from a topology; optionally expose a WS gateway
    # and/or accept peer connections

actor-web ls [--node worker]
    # list live actors (id, type, status) via the directory

actor-web spawn ./behaviors/researcher.ts --id r1 [--node worker]
    # dynamically spawn a behavior as an actor

actor-web send  actor://worker/agent/r1 '{"type":"START","goal":"..."}'
actor-web ask   actor://worker/agent/r1 '{"type":"QUERY", ...}' [--timeout 5000]
    # fire-and-forget / request-response

actor-web watch actor://worker/agent/r1
    # stream the actor's emitted events to the terminal (subscribeEvent)

actor-web connect ws://host:port --as worker
    # operate against a remote node instead of an in-process one
```

`serve` hosts; the other verbs are a client that talks to either an in-process
system or a remote node over the gateway. All of these map directly to existing
runtime calls (`serveNode`, `system.lookup`, `spawn`, `send`/`ask`,
`subscribeEvent`, `createActorWebClient`).

## Agent layer (sketch)

These pieces ship in **`@actor-web/agent`**. The v1 dogfood slice keeps the
vendor-specific SDK behind an injected provider port: the package exports an
`llm` tool registry helper plus an agent-loop behavior, while
`@actor-web/runtime` remains free of LLM dependencies. An agent is just a
behavior that calls an `llm` tool:

```ts
const researcher = defineBehavior<AgentMsg, AgentEvent>()
  .withContext({ history: [] })
  .onMessage(async ({ message, context, tools, actor }) => {
    if (message.type !== 'START') return {};
    const plan = await tools.execute('llm', {
      system: 'You are a research agent…',
      messages: [...context.history, { role: 'user', content: message.goal }],
      tools: tools.list(), // only what toolAccess allows
    });
    // emit progress; optionally call tools; loop by sending self the next step
    return { context: { history: [...] }, emit: [{ type: 'STEP_DONE', … }] };
  });
```

The `llm` tool is registered in the `ActorToolRegistry` passed to `serveNode`.
`toolAccess` decides which agents may call `llm` and which may call, say, `fetch`
or `git`. Supervision restarts the agent if its loop throws. Multiple agents
coordinate via `emit`/`subscribe` instead of a central conductor.

The current CLI host registration seam is programmatic:

```ts
const host = await createRuntimeHost(topology, {
  agent: {
    llm: provider,
  },
});
```

The host merges that provider into the runtime tool registry as `llm`; topology
`tools` / actor `tools` still decide whether a given actor can call it.

## Runtime gaps to close before this is real

- **Agent loop + LLM tool** — does not exist; build in the agent layer.
- **Persistence/durability** — agents are in-memory; surviving a node restart
  needs snapshotting (out of scope for v0; note it).
- **Observability** — a usable `watch`/`ls` may need richer introspection than
  the current snapshot exposes (the system snapshot reports the wrapper state,
  not inner machine state; see the cli test findings in PR #14).
- **DX maturity** — `actor-web-actor-dx-design.md` marks the locked DX as
  "target design, not yet fully implemented." Treat v0 as dogfooding, not a
  product.
- **Transport security/auth** — the WS transport has an `auth` hook; any
  remote/`--gateway` use must define an auth story before leaving localhost.

## Phasing

1. **v0 — in-process host (proof of shape).** `serve` an in-process node from a
   topology; `ls`, `spawn`, `send`/`ask`, `watch`. No network, no LLM. Goal:
   prove the operator console over the runtime feels right and shakes out
   introspection gaps.
2. **v1 — agent layer.** Introduce the **`@actor-web/agent`** package (the `llm`
   tool + agent-loop behavior); the CLI registers it when hosting agents.
   Single-node multi-agent choreography via `emit`/`subscribe`. `toolAccess`
   enforced.
3. **v2 — distributed.** `--gateway`/`--transport`/`connect`: run agents across
   processes/machines; remote `send`/`watch`. Requires the auth story.
4. **v3 — FAS integration.** FAS emits topology + behaviors + `toolAccess`; the
   CLI runs them. The control-plane/data-plane loop is closed.

## Alternatives (build vs buy)

- **Claude Agent SDK / OpenAI Agents SDK** — turnkey agent loops, but no
  first-class actor model (supervision, location transparency, mailboxes) and a
  vendor dependency. Good for a single agent; weak for a supervised distributed
  fleet.
- **LangGraph / CrewAI / AutoGen** — graph/role orchestration, but their
  concurrency and fault-tolerance stories are thin compared to OTP-style
  supervision, and they are external dependencies outside FAS's control.
- **Why build on actor-web instead:** we already own the actor substrate, it is
  integrated with FAS as the control plane, it has the rigorous concurrency /
  supervision / distribution model these frameworks lack, and it keeps the LLM
  vendor at the edge (a tool) rather than the core.

The honest caveat: "buy" is faster to a working single agent. "Build" wins only
if the durable/concurrent/distributed/boundary-enforced properties are things we
actually need — which is precisely the FAS multi-agent direction.

## Risks

- **Reinventing orchestration** that mature frameworks already provide — only
  justified by the actor-model properties above.
- **Identity creep** — letting LLM concepts leak into the core runtime. Mitigated
  by the layering rule.
- **Premature productization** — building on a still-stabilizing runtime.
  Mitigated by treating v0/v1 as dogfooding.
- **Operational surface** — a runtime to run and secure that a chatbot hides.

## Open questions

1. Is the target a **general actor runtime CLI** that happens to host agents, or
   an **agent-first CLI**? (Recommendation: general runtime + thin agent layer.)
2. ~~Does the agent layer live in `@actor-web/cli` or a separate package?~~
   **Decided:** a dedicated **`@actor-web/agent`** package. See *Package layout*.
3. Does the current git-workflow `aw` surface get **removed**, kept in a separate
   package, or ceded entirely to FAS?
4. What is the minimum introspection the runtime must expose for `ls`/`watch` to
   be useful?
5. Persistence: is durable agent state in scope, or explicitly deferred?

## Decision (proposed)

Pursue the runtime-host CLI as a **general actor runtime console**, with the
agent layer in a **dedicated `@actor-web/agent` package** (`cli → agent →
runtime`, one-way), and FAS as the control plane that emits topology +
behaviors + `toolAccess`. Start at v0 (in-process, no LLM, no agent package) to
prove the shape and surface runtime introspection gaps before committing
further. Do **not** publish the current git-workflow `aw` CLI as a product; a
reconceived `@actor-web/cli` host is the thing worth shipping later.
