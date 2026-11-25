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
with `reset`, or the `./portable`, `./runner` and `./zod` entry points.

## Public API

<!-- Public exports from src/index.ts and the runner entry in src/runner.ts. -->

| Export | Use for |
| --- | --- |
| `createAgentLoopBehavior(options?)` | Standard agent loop behavior that accepts `START_AGENT`, observes tool results, and emits agent step/tool events |
| `createLlmToolRegistry({ llm })` | Typed `llm` registration; the published `createActorAgentToolRegistry` name remains a deprecated alias |
| `createActorAgentTools({ llm })` | Runtime-ready tool registry for `startRuntime(..., { tools })` |
| `createLlmProvider({ endpoint, model, timeoutMs?, ... })` | Chat Completions adapter. An endpoint path that ends in `/responses` uses the Responses wire. The host supplies the endpoint, model, and headers |
| `ACTOR_WEB_LLM_TOOL_NAME` | Stable tool name for the injected LLM provider |
| `ModelToolDefinition` | Provider-facing tool metadata (`inputSchema`); `ActorAgentToolDefinition` is the deprecated name |
| `ActorAgent*` types | Message, event, provider, tool-call, and error contracts |
| `AgentTracePayload`, `AgentTraceEvent`, `AgentTraceEventMap` | Typed evaluation observations and their correlated runtime event envelope |
| `AgentTraceCapture<T>`, `AgentTraceCompleteness` | Explicit content availability and event-stream loss |
| `AgentTraceProfile`, `AgentTraceConfiguration`, `AgentTraceOptions` | Named runner capture profiles or low-level options, with limits, redaction, and an isolated sink |
| `AGENT_TRACE_SCHEMA_VERSION`, `AgentRunTraceSnapshot`, `AgentTraceRecord`, `AgentTraceRunSummary`, `serializeAgentTraceJsonl` | Canonical version, snapshot and JSONL records, and portable serialization |
| `createAgentRunner(options)` from `@actor-web/agent/runner` | Local runner implementing the portable `AgentRunner` contract |

## Evaluation trace schema

<!-- Evaluation trace types from src/trace.ts and runner instrumentation in src/runner.ts and src/runner-trace.ts. -->

`AgentTracePayload` is a discriminated TypeScript union for evaluation capture.
The local runner emits this vocabulary in `AgentTraceEvent` envelopes when its
`trace` option is supplied. Tracing is off by default; configured tracing defaults
to metadata-only capture. These APIs are available in this checkout, not the
published 0.2.1 package. There is no general parser for untrusted trace JSON or
built-in durable storage.

- `run.started` records the task, method revision, safe experiment configuration,
  and optional versioned dataset/case and code revision.
- `model.requested` records the provider/model, known effective settings, and the
  normalized request after prompt composition, tool grant filtering, and example
  injection. Its captured request includes system text, message history, tool
  names, and effective tool definitions/schemas.
- `model.returned` records the assistant message, proposed tool calls, optional
  provider-returned reasoning summaries, reported token usage, and elapsed time.
  `model.failed` records a sanitized failure code, including provider replies
  rejected by runner normalization. Invalid replies are not logged verbatim.
- `tool.requested` records proposed arguments. `tool.rejected` means no handler
  was dispatched. `tool.observed` records validated handler input and its returned
  output; `tool.failed` records an execution failure. Correlate calls using
  `modelCallId` and `toolCallId`, never by tool name. Execution attempts carry an
  `attempt` number.
- `output.validated` identifies the validator and revision, with either a passed
  parsed output or a failed code. Raw final candidate text remains in the model
  response. Validation is not a quality score or workflow acceptance.
- `run.completed`, `run.failed`, and `run.cancelled` describe raw runner execution,
  not whether an evaluator considers the answer correct. `run.completed` carries
  raw text and precedes host validation; an invalid final answer can have
  successful raw execution followed by failed `output.validated`.

### Capture profiles

Set `trace.profile` in `createAgentRunner` from your application's settings.
All enabled profiles emit the same versioned `AgentTraceEvent` envelope.

| Profile | Behavior |
| --- | --- |
| `off` | Like omitting `trace`: no events, sink calls, or trace snapshot |
| `metadata` | Events, identifiers, timings, usage, and failure codes; content fields are omitted |
| `evaluation` | Same events with bounded content capture and optional host redaction |

An enabled profile requires `methodRevision` and a `model` descriptor
(`provider`, `model`, and explicitly captured/omitted `settings`). For example:

```ts
import { createAgentRunner } from '@actor-web/agent/runner';

const runner = createAgentRunner({
  ...runnerOptions,
  trace: {
    profile: 'metadata',
    methodRevision: 'source-review-v1',
    model: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      settings: { status: 'omitted', reason: 'unavailable' },
    },
  },
});
```

Profile-free `AgentTraceOptions` still default to metadata-only and support
`capture: 'content'`; do not combine `capture` with a named profile.
`onEvent` receives each detached envelope. An optional `createRunId()` supplies
a unique opaque ID per invocation; otherwise the runner generates one.
Optional `case` and `codeRevision` identify the versioned experiment. Keep
identifiers and other metadata non-sensitive even in the `metadata` profile.
Profiles do not select a renderer, destination, or storage policy.

Every `start(request)` handle exposes `readTrace()`: a detached snapshot containing
events, completeness, delivery failures, and model/tool/token metrics. It returns
`undefined` when tracing is off. `run(request)` also emits to the configured sink,
but does not expose a handle. Metrics count actual dispatches independently of
retained events, and missing token usage remains unknown.

### JSONL export

After awaiting the run or host validation (including on failure), take the
snapshot with `handle.readTrace()`. `serializeAgentTraceJsonl(snapshot)` from
`@actor-web/agent` emits each retained event followed by one versioned
`agent.trace.summary` record with the run ID, metrics, completeness, and delivery
failure count. The summary is present even if limits prevented retaining any
events. It describes that snapshot, not a business verdict or a durable-delivery
receipt. Consumers can discriminate event and summary lines by `type`.

The serializer is browser-safe and does not write files, validate untrusted JSON,
or apply additional redaction. The host chooses where to send or store the
serialized data. Use either snapshot export or `onEvent` for a given event
destination to avoid writing duplicate events.

### Validation and capture guarantees

To trace host validation, use `start(request, evidenceBinding)` and call
`handle.validateOutput(parse, { id, revision })`. The parser runs once against the
raw result. Existing callers may omit the validator identity, recorded as
`host-output` / `unversioned`. `createAgent(...).run()` still owns its separate
portable parser; it does not automatically emit `output.validated`. See the
[retail analyst](../../examples/retail-analyst/analyst.ts) for the explicit host
validation path. Parsing and business validation must not depend on retained
diagnostic events.

Limits default to 256 events, 1 MiB total compact event JSON, and 64 KiB per
content field (`maxEvents`, `maxBytes`, `maxContentBytes`). A full event buffer
stops retaining/delivering events and keeps a truthful prefix with a loss reason;
oversized individual content is explicitly omitted instead. Completeness and
metrics remain readable outside the bounded buffer.

Optional `redaction: { policyId, redact(value, field) }` applies a synchronous,
shape-preserving projection to detached content before retention or delivery.
It must cover every sensitive occurrence, including repeated conversation
history, not just the task. Redactor exceptions omit content and report capture
failure. The collector snapshots only plain JSON and does not invoke content
accessors. Opaque provider continuation state, raw errors, and provider headers
are excluded; application text is not automatically scrubbed.

Sink mutations and exceptions cannot replace port inputs/results. Sink promises
are observed for rejection but never awaited; delivery counts can change after
execution, so snapshots are point-in-time observations, not delivery receipts.
Keep synchronous sink/redaction work fast: it still consumes wall-clock time.
No asynchronous flushing, backpressure, or durable-delivery guarantee is implied.

Content fields use `AgentTraceCapture<T>`: `captured` carries a value, `redacted`
carries a policy-tagged replacement, and `omitted` carries a reason but no value.
Captured `null`, empty text, or an empty array are actual data, not missing data.
Use `usage: null` when usage was not reported; absent individual token counts are
unknown, not zero. A captured request is the normalized agent request, not an
exact provider-wire recording: opaque `providerState` is deliberately excluded.
Provider defaults that are unknown must not be invented.

`AgentTraceEvent` specializes `ActorEventEnvelope` as a discriminated union: the
event `type` determines its nested `payload`. Unlike the flat producer union,
the nested payload does not repeat `type`. It retains runtime IDs, timestamps,
correlation and causation, fixes `kind` to `fact` and `schemaVersion` to `1`, and
adds a host-owned `runId` and one-based, run-local monotonic `sequence`.
Optional `evidence` links refer to existing execution trace/session/command
identities and receipts. The trace does not replace `AgentExecutionTrace` or the
runner's metadata-only execution evidence. A local tool return does not prove
durable remote execution.

Producers must snapshot plain JSON, exclude credentials and raw SDK errors,
apply capture/redaction policy before storage, and enforce event/byte limits.
The type system alone cannot enforce finite numbers, safe integers, valid
timestamps, identifier uniqueness, deep immutability, or secret removal.
Preserve an `AgentTraceCompleteness` summary outside the bounded event buffer;
event loss is distinct from omitted content. Neither missing content nor an
incomplete stream should silently pass an evaluator that needs that evidence.
Versioned evaluation scores/findings remain separate records referencing the
run/events, so saved runs can be re-scored without changing the original facts.

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

`@actor-web/agent/portable` exports `createAgent(runner, definition)`. Unlike
`createAgentLoopBehavior`, it does not start an actor or drive a tool loop. Each
call to `run` sends one assignment to the supplied runner, forwarding its signal
separately from the flat task data, and returns the decoded result. Supply a
plain data object for the task; `signal` is reserved. The host still owns tool
grants, cancellation, independent sessions, and acceptance of the candidate.

The [portable tests](tests/portable.test.ts) use supplied functions to exercise
assignment binding, task-aware output checks, and error propagation. A cancellation
test uses a runner that honors the signal. `createAgent` forwards the
signal, but does not enforce pre-dispatch abort, reject late output from a
runner that ignores abort, or wait for cleanup. Those are runner concerns.
The [specialist execution contract](../../docs/specialist-execution-contract.md)
specifies what that host must enforce from assignment through settlement.

### In-process agent runner

Use `startRuntime(shipmentTopology)` to host the shipment lifecycle actors.
Use a runner for a separate task such as a [shipment inquiry](../../examples/ignite-headless-host/logistics-inquiry.ts):

```ts
import { createAgent } from '@actor-web/agent/portable';
import { createAgentRunner } from '@actor-web/agent/runner';

const runner = createAgentRunner({ ...options, definition });
const inquiry = createAgent(runner, definition);
const answer = await inquiry.run({ tracking_id: shipmentId, signal });
```

Creating the runner does not start an actor. Each admitted assignment starts
a fresh in-process specialist; the model provider can be remote. The portable
`AgentRunner` only requires `run(request)`. The built-in `InProcessAgentRunner`
also offers `start(request)` for an `AgentRunHandle` with a `result` promise and
`waitForSettlement(timeoutMs)` for observing local cleanup.

**Migrating a checkout that used the preview API:** replace
`createActorRuntime` from `@actor-web/agent/actor-runtime` with `createAgentRunner`
from `@actor-web/agent/runner`. In portable definitions use `AgentRunner`,
`AgentRunRequest`, and `AgentToolDeclaration` in place of `AgentRuntime`,
`AgentTurn`, and `AgentTool`. In the runner options, an `AgentToolHandler` is
the trusted implementation, not a declaration or a grant. Error codes and
actor messages are unchanged; the error class is now `AgentRunnerError`.

Import `createAgentRunner` and `AgentRunnerError` from
`@actor-web/agent/runner`. Pass the same trusted `definition` you give
`createAgent`, including any output instructions. Also supply `provider`,
`encodeTask` when a custom model-context projection is needed, application tool `grants` and implementations, and `limits`:
`runTimeoutMs`, `askTimeoutMs`, `providerTimeoutMs`, `toolTimeoutMs`, and
`maxToolCallsPerBatch`. Existing callers of the unreleased runner must also
supply `maxModelTurns` and `maxPayloadBytes` (positive safe integers) and
`maxToolAttempts` (a nonnegative safe integer). There are no defaults.
`askTimeoutMs` is a positive integer capped at 214748364 ms so the 10× local
correlation fallback fits in the platform timer range. The runner checks its
active run, ask, provider, and tool deadlines against a monotonic clock.
If several have elapsed, the
earliest absolute deadline wins, with the outer operation winning exact ties.
An expired ask fails with `ACTOR_ASK_FAILED` when it is the winning deadline,
even if its timer callback has not fired. Caller abort is handled immediately
when signaled, and a recorded interruption is not replaced.

The encoder and tool validators are synchronous and side-effect-free. Each
tool's `validateInput(input, task)` checks schema and assignment scope and
returns `{ value }` or throws. The returned value must be plain JSON data:
null, booleans, strings, finite numbers, dense arrays, or objects with enumerable
string-keyed data properties. Containers use the current realm's standard
prototype, or a null prototype for objects. Cycles and unsupported
values (for example, `undefined`, accessors, or class instances) fail with
`INVALID_TOOL_INPUT`. `execute(value, task, context)` receives a detached copy
for that call and performs the effect. A successful tool result must also be
plain JSON data that can be serialized into the tool receipt; invalid results
fail with `INVALID_TOOL_OUTPUT`. Provider tool arguments must be plain JSON
before the adapter accepts an assistant message. For asynchronous work, the
handler and provider must return the promise representing that work. The host
owns the pinned assignment snapshot, stable callback bindings, and the
acceptance decision.

Each admitted run owns a new actor and local runtime. Only requested, granted,
implemented application tools are advertised; `llm` is reserved. The runner
checks and snapshots an entire model tool batch before dispatching effects,
then runs tools in order. Later failures do not undo earlier effects. It
rejects duplicate IDs within a session and returns only nonblank final assistant
text. Execution failures reject with a `code`, retaining provider and coded tool
failures; no retry or repair is attempted. The optional output parser remains
separate.

### Few-shot tool examples

Import `AgentToolDeclaration` and `AgentToolExample` from `@actor-web/agent/portable`.
Declare synthetic input/result pairs beside the tool, not in the task prompt:

```ts
const alerts = {
  name: 'check_facility_alerts',
  description: 'Look up active operational alerts for a facility.',
  parameters: {
    type: 'object',
    properties: { facility_name: { type: 'string' } },
    required: ['facility_name'],
    additionalProperties: false,
  },
  examples: [{ input: { facility_name: 'Example Yard' }, result: { alerts: [] } }],
} satisfies AgentToolDeclaration;
```

The local runner's `toolExampleMode` defaults to `'off'`. Set it to
`'description'` in `createAgentRunner` to append labeled examples **only** to
requested, granted, implemented tool descriptions. Examples never become tool
calls, receipts or conversation history. Their rendered bytes count toward
`maxPayloadBytes` on each model request. Tools without examples are unchanged.

Per tool, the local runner accepts up to four pairs and 4 KiB of compact
UTF-8 JSON for the whole example array. It checks and snapshots them when
binding the definition, even when injection is off. `input` must be a plain
JSON object; `result` can be any plain JSON value. Examples do not invoke
handlers or validate outputs: check fixtures against your tool's contract in
tests. Use synthetic data suitable for sending to the provider.

The [Planner read sample](../../examples/portable-specialist/planner-read.ts)
enables `toolExampleMode: 'description'` for one runner. Its offline demo loads
the actual `read_plan_file` declaration from `@agent-starter/workflows/planner`
and supplies an in-memory handler granted one file and line. It checks that the
provider sees the illustrative `Status: draft.` only in the tool description,
while reading the assigned file returns `Status: ready.`. It also checks that
reading the example path or answering from the example fails.

With the two workspaces installed side by side, run from the actor-web root:

```sh
pnpm --filter @actor-web/runtime build
pnpm --filter @actor-web/agent build
pnpm --dir ../agent-starter --filter @agent-starter/workflows... run build
pnpm --filter @actor-web/example-portable-specialist demo:planner
```

This uses the local package builds and a scripted provider; it neither starts
the board/Pi executor nor changes their tool descriptions or grants.

### Execution budgets

Budgets reset for each admitted run and are cumulative within it:

- `maxModelTurns` counts actual provider calls. Before a tool batch can run,
  there must still be a model turn available to process its results.
  A final answer may finish on the last turn. Refusal: `MODEL_TURN_LIMIT`.
- `maxToolAttempts` counts actual application-tool handler calls; zero
  permits model-only runs. A validated batch must fit as a whole before any
  handler runs. Refusal: `TOOL_ATTEMPT_LIMIT`. The per-batch call limit still
  applies separately. Failed dispatches count; refused dispatches do not.
- `maxPayloadBytes` counts compact JSON UTF-8 bytes of the normalized provider
  request (system text, messages, tool names and declarations), each normalized
  successful assistant message (including tool calls and arguments), and each
  detached tool input and successful output. Omitted optional fields are
  omitted from the count. History counts again when resent. SDK/wire framing,
  diagnostics, credentials, and token usage are excluded.
  Refusal: `PAYLOAD_BYTE_LIMIT`.

All known tool input bytes must fit before the first effect, and each input is
checked again immediately before dispatch. A previous tool's output can leave
too little allowance for the next input. An unknown-size response is checked
after it returns and before it is forwarded or accepted. These are local
dispatch and acceptance limits, not heap, network, or remote effect limits.

Abort or timeout rejects the caller and signals the admitted ports. A rejected
caller promise is not a cleanup receipt: the adapter rejects additional runs
with `RUNTIME_BUSY` until tracked local work and runtime stop complete. A failed
start without a runtime handle or a failed stop leaves the instance fenced.
Neither this fence nor an abort signal establishes remote termination,
rollback, or settlement of work a port detached from its returned promise.

The [portable specialist example](../../examples/portable-specialist/demo.ts)
uses this adapter with a scripted provider, two model turns, one in-memory
read attempt, and a 64 KiB cumulative payload budget. From
the workspace root, build the runtime and agent packages, then run the demo
against those built entries:

```sh
pnpm --filter @actor-web/runtime build
pnpm --filter @actor-web/agent build
pnpm --filter @actor-web/example-portable-specialist demo
```

This local profile does not qualify the full cancellation/settlement contract,
recovery, correlated evidence, or a live provider. The public-entry build smoke
uses workspace ESM and CJS consumers and a browser-target bundle; it is not the
packed-consumer matrix.
For a browser bundle, statically replace the runtime dependency's
`process.env.NODE_ENV` references as Vite application builds do. The smoke
does not provide a Node `process` shim.

For JSON responses, install `zod@^4` and import `structured` from
`@actor-web/agent/zod`. Neither the package root, `portable`, nor `runner`
imports Zod.
Use a synchronous, JSON-representable schema. Its input schema supplies response
instructions once at construction; after JSON and schema validation, an optional
`check` receives the typed content and the assignment. Return a reason to reject.

```ts
import { createAgent, type AgentRunner } from '@actor-web/agent/portable';
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

function createReviewer(runner: AgentRunner<Assignment, 'review'>) {
  return createAgent(runner, {
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
runner. `reviewOutput.parse(raw, { files, expertise: igniteExpertise })` instead
checks already-produced text without invoking it. An `AgentOutputError` carries
`invalidJson`, `schemaMismatch`, or `taskMismatch`; runner errors propagate
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

## Typed tools and default task encoding

Import `defineTool` from `@actor-web/agent/zod` to bind a JSON-representable Zod input/output contract to a typed handler. It returns `{ declaration, handler }`: put declarations in the agent definition, handlers in the runner, and grant their names explicitly. The helper normalizes generated schema metadata; the core runner continues to reject unsupported payload values. Input schema validation precedes the optional assignment-specific `check`; output schema validation follows execution. The core and runner entries do not import Zod.

`encodeTask` is optional. Its default accepts plain JSON assignment data and refuses unsupported values, including functions and class instances. Supply an encoder to select the fields the model should see or produce task-specific text. Default encoding sends every enumerable task field, so choose a projection deliberately for assignments with host-only fields. Task encoding does not move credentials or environment access into the runner.

See the [retail analyst example](../../examples/retail-analyst/README.md) for `createAnalyst({ provider })`, scoped tools, a required-observation output check, and opt-in live comparison with a Python regex agent.

For providers that support it, set `parallelToolCalls: false` in `createLlmProvider` to request at most one function call per turn. Omission preserves provider defaults. This maps to `parallel_tool_calls` on Chat Completions and Responses; the runner still independently enforces its batch limit.

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
- `OBSERVE_TOOL_RESULT` to record one outstanding call's result. Supply its
  exact `toolCallId` and `name`; an unknown, ambiguous, misnamed, or already
  observed call returns `INVALID_TOOL_RESULT` without appending to history.
  Partial receipts return `waiting-for-tool`. By default the final receipt
  immediately starts the next model turn.
- `CONTINUE_AGENT` to run one model turn from paused history, without adding a
  user message or replaying a tool. It returns `AGENT_NOT_PAUSED` if no
  continuation is available.
- `RECONCILE_AGENT_SESSION` to submit a reconciliation receipt when a checkpoint
  store is configured.
- `GET_AGENT_CONTEXT` to inspect the loop context.

To let the host decide whether to spend another model turn, send
`deferContinuation: true` on the **final receipt**:

```ts
const ack = await agent.ask<ActorAgentLoopReply>({
  type: 'OBSERVE_TOOL_RESULT', toolCallId: call.id, name: call.name,
  ok: true, output, deferContinuation: true,
});
if (ack.ok && ack.status === 'paused') {
  // Later, after the host authorizes the next model turn:
  await agent.ask({ type: 'CONTINUE_AGENT' });
}
```

The `paused` acknowledgement contains the recorded tool message and no tool
calls. Deferral applies only to that receipt, not to later receipts or batches.
The host may instead send `START_AGENT` with a new instruction (retains history
unless `reset: true`) or stop the actor. Neither pausing nor restoring a paused
checkpoint calls the model. This is a boundary between turns, not cancellation
of in-flight work. Checkpoints written before this feature are not paused.

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

## Decision explanations and reasoning summaries

`ActorAgentLlmMessage.content` may accompany native tool calls. Hosts should preserve returned assistant text instead of hiding it when `toolCalls` is nonempty. This text is an explanation, not raw internal reasoning.

For compatible reasoning models on a Responses endpoint, `createLlmProvider({ ..., reasoningSummary: 'auto' })` requests a summary. The adapter returns `message.reasoningSummaries` separately from `content`, and retains `message.providerState` for replay of opaque reasoning items on later Responses turns. The runner validates/detaches and meters this JSON metadata with the message. Evaluation loggers should select summaries and exclude opaque state. Chat Completions rejects this summary configuration rather than silently ignoring it. No model migration or reasoning effort is chosen automatically.

`defineTool` also accepts typed `examples: [{ input, result }]`. It validates examples against the schemas without invoking assignment checks or handlers, then hands declarations to the runner's existing example snapshot/injection path. Enable `toolExampleMode: 'description'` to advertise them. They are illustrative data, not successful observations or grants; task-level validators remain authoritative.
