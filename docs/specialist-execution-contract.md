# M1 specialist execution contract

AW-00-02 contract for the [Actor-Web milestone](todos.md). This specifies the
host obligations for one local specialist assignment. It does not implement the
actor-backed executor or change the public API. The first implementation consumer
is the scripted, in-memory source reviewer in AW-01-01.

## Boundaries

- A specialist definition fixes one purpose, a system prompt, requested tool
  descriptions, and an output parser. [`createAgent`](../packages/actor-agent/src/portable.ts)
  creates a `FocusedAgent`. Its `run(context): Promise<Content>` calls
  `AgentRuntime.run(turn): Promise<string>` and parses the returned text
  with the original assignment. Expected host execution failures reject the
  portable promise; neither return type gets a status or evidence envelope.
- The trusted host selects the definition, executor, provider, grants, and
  assignment revision. Actor-Web runs the actor and enforces configured toolbox
  grants. The product or workflow owner decides whether validated content is
  usable for the current assignment; parsing does not advance a workflow.
- The actor loop speaks [`ActorAgentLoopReply`](../packages/actor-agent/src/index.ts).
  Its `{ ok: false, error }` replies remain data at the actor boundary. A host
  adapter must preserve the failure category when rejecting the portable
  promise, rather than turn an actor error into model text.

## From assignment to result

1. **Bind the assignment.** The host pins the assignment ID and revision,
   purpose, accepted definition, and tool grant before dispatch. Call the
   specialist's `run` with a flat, plain-data assignment and a reserved `signal`
   field, which is forwarded separately from the task. For the first reviewer,
   the host takes a snapshot of the permitted source files. It encodes an
   explicit JSON user payload containing the review request and allowed file
   paths; source excerpts arrive through the granted in-memory read tool.
   The parser uses the original file snapshot to check citations. Task text
   and tool results never alter the system prompt, provider settings, or grants.
2. **Admit a fresh session.** Use a new, empty actor session for this one
   purpose; do not reuse history or resume a checkpoint for the M1 example.
   `START_AGENT.reset` clears history but is not a new session or evidence that
   prior work stopped. An already-aborted assignment or an invalid host
   configuration must be refused before provider or application-tool dispatch.
   The bounded profile uses explicit host-supplied limits, not inferred
   production defaults.
3. **Apply the grant at dispatch.** Give the actor the internal `llm` tool and
   only those application tools that are requested, explicitly granted by the
   host, and backed by registered implementations. `llm` is not a
   model-callable application tool. Expose only effective tool definitions to
   the provider. Treat returned tool names, arguments, and call IDs as data:
   recheck the grant, validate arguments, and bind each call ID to the active
   session before any application effect. For the reviewer, even a granted read
   tool must refuse a path outside the pinned inventory.
4. **Drive the existing loop.** Use `createAgentLoopBehavior` and send
   `START_AGENT` with the encoded user payload and trusted system instructions.
   A `waiting-for-tool` reply is not final content, even if it lists no new
   calls. Feed authorized results back as `OBSERVE_TOOL_RESULT` with the
   matching call ID and name. Do not issue duplicate or stale tool calls.
   Only an assistant `responded` reply with no outstanding tool work can
   supply raw final text. Reject and stop on a denied tool or provider failure;
   the first profile does not retry, repair output, or switch providers.
5. **Validate and accept separately.** The portable agent parses final text
   and, when using `structured`, checks JSON, the output schema, and the
   original assignment in that order. The owning caller still checks that the
   assignment is current and not cancelled at the point of acceptance. Do not
   publish a success outcome on receipt of raw text or from an actor's
   `responded` status alone.

## Stop, settlement, and evidence

`createAgent` forwards an `AbortSignal`; it does not prevent dispatch or wait
for cleanup by itself. In the bounded profile, a stop request closes admission
to new turns and tool calls and invalidates unaccepted results. It signals
admitted work to stop where supported. Track underlying provider/tool work
separately from any timed or cancelled caller reply:

- **Stop requested:** the host recorded the request. Previously admitted work
  may still be running.
- **Locally settled:** tracked local operations have settled and owned session
  resources have closed.
- **Unresolved:** the host cannot establish local settlement within its wait
  limit. Do not reuse the executor for another assignment while that state
  remains unresolved. A late reply cannot reopen the cancelled assignment.

None of these observations proves that a remote action did not run, was rolled
back, or stopped incurring provider charges. A timeout is not permission to
repeat an uncertain effect. Settlement and late-result enforcement are
specified here; AW-03-02 implements and verifies them.

Keep observations separate from `Content`. The later evidence slice can
correlate assignment, revision, session and attempts, record validation and
cleanup outcomes, and report missing token usage as unknown. Use existing
[runtime receipt semantics](provider-neutral-agent-execution-contract.md) where
they apply. Logs and model text do not establish authorization or durable
effect outcomes. Omit raw task, prompt and tool payloads, and credentials from
default observations.

## Consumer example

This factory binds a typed reviewer to a supplied executor. It neither starts
an actor nor grants the requested read tool.

```ts
import { createAgent, type AgentRuntime } from '@actor-web/agent/portable';
import { structured } from '@actor-web/agent/zod';
import { z } from 'zod';

type Assignment = {
  readonly request: string;
  readonly files: readonly { readonly path: string; readonly source: string }[];
};

export function createReviewer(runtime: AgentRuntime<Assignment, 'review'>) {
  return createAgent(runtime, {
    purpose: 'review',
    systemPrompt: 'Review the supplied sources and cite the relevant excerpt.',
    tools: [{
      name: 'read_source',
      description: 'Read one source file from the assigned inventory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    }],
    output: structured(
      z.strictObject({ path: z.string(), excerpt: z.string().trim().min(1) }),
      {
        check: (finding, task: Assignment) =>
          task.files.some(({ path, source }) =>
            path === finding.path && source.includes(finding.excerpt)
          )
            ? undefined
            : 'The citation is not in the assigned source.',
      },
    ),
  });
}
```

## Observable cases

These cases distinguish existing primitives from obligations for the next
implementation. The files below are evidence for the primitives, not proof of
the whole host flow.

| Case | Required observation | Existing evidence and its limit |
| --- | --- | --- |
| Granted read and valid citation | One in-scope read, then typed content that cites the pinned source. Acceptance is a caller decision. | [Portable tests](../packages/actor-agent/tests/portable.test.ts) cover turn binding and parsing with a supplied executor. AW-01-01 joins this to a real actor and read port. |
| Denied tool or path | Caller sees an execution failure; the denied tool or out-of-scope read performs no effect. No success output is accepted. | [Provider tests](../packages/actor-agent/src/llm-provider.test.ts) check tool-name filtering and [toolbox tests](../packages/actor-core-runtime/src/unit/actor-tools.test.ts) check allowlist enforcement. The assignment's path check belongs to the host tool. |
| Bad output | The caller sees `AgentOutputError` with `invalidJson`, `schemaMismatch`, or `taskMismatch`. No repair or accepted result. | Portable tests cover all three parser outcomes. |
| Provider failure | The actor replies with an error fact, such as `LLM_PROVIDER_UNAVAILABLE`. The portable run rejects with a distinguishable execution failure, not a parse error. | [Loop tests](../packages/actor-agent/src/agent-loop.test.ts) and provider tests cover error replies; portable tests cover executor error propagation. |
| Stop before dispatch or during work | A pre-dispatch stop causes no effects. A stop during a live tool call prevents late acceptance; the caller can observe unresolved cleanup if the tool does not settle. | Portable tests show signal forwarding to a cooperative executor; toolbox tests show timeout and abort notification. Neither proves host settlement. |

## Provider migration

On `@actor-web/agent@0.2.1`, use `createOpenAiCompatibleLlmProvider` and
`OpenAiCompatibleLlmProviderOptions`. In the current checkout, import
`createLlmProvider` and `LlmProviderOptions` instead; there is no legacy alias.
The host still supplies the endpoint, model and any headers. An endpoint whose
path ends in `/responses` selects the Responses wire format; other endpoints
use Chat Completions. The task cannot change those settings.
