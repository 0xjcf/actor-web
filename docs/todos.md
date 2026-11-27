# M1: One bounded, observable specialist execution

Goal: let an application run one typed specialist through real local Actor-Web actors, grant it a tool, validate its answer against the assignment, and tell whether its work has stopped. Prove this with a scripted provider and one agent-starter consumer. Durable recovery, distributed deployment, and unattended delivery are outside M1.

The [agent application north-star draft](examples/agent-app-north-star.md) explores the eventual app API. It is not an API reference and does not change the milestone's acceptance criteria.

## Using the backlog

This file owns task intent and dependencies and records work completed directly in Actor-Web. The [queue-board](../../agent-starter/apps/board/README.md) owns board ticket status. Next in Actor-Web: **AW-04-02** (not started). Local completion does not change a board ticket's stage. For each board handoff:

1. Find the task on the board by its `AW-` ID before creating a ticket. Use the ID and task name as the title. Copy its request, acceptance criteria, and checks into the brief.
2. `AW-` IDs are roadmap IDs, not board ticket IDs. Use the corresponding board ticket IDs for `dependsOn`. If manual entry cannot bind a dependency, wait until the board accepts the predecessor as shipped before queuing its successor. A dependency mentioned only in prose is not enforced.
3. Review the target workspace and required checks before starting. A roadmap entry is not a workspace grant or check confirmation. If the spec changes, review it against the existing ticket; do not silently replace the brief or start a duplicate.

## Milestone tasks

| Task | Depends on | Deliverable and acceptance |
| --- | --- | --- |
| AW-00-01 · Reconcile capability status | None | **Complete (local).** Reconciled current capabilities, verification limits, and ownership across the execution contract, transport roadmap, and agent guide. Historical evidence was preserved. |
| AW-00-02 · Define the specialist execution contract | AW-00-01 | **Complete (local).** The [contract](specialist-execution-contract.md) covers one assignment from admission through validation and cleanup. The documented reviewer compiles and runs against the public agent entries with a scripted executor. |
| AW-01-01 · Run a specialist end to end | AW-00-02 | **Complete (local).** Independent Test and Review passed at `1c9c6c34`. The built [reviewer example](../examples/portable-specialist/demo.ts) used a real local actor, a scripted provider, and a granted in-memory read tool. It accepted a supported citation, rejected unsupported output, and denied ungranted effects. |
| AW-01-02 · Extract the Actor-Web executor | AW-01-01 | **Complete (local).** Independent Test and Review passed on the source committed in `54e673fe`. The reviewer consumes `@actor-web/agent/runner`; fresh assignments isolate history, tool calls, and results. This qualifies the offline local adapter, not the final packed-consumer matrix or the full settlement contract. |
| AW-02-01 · Exercise the executor contract | AW-01-02 | **Complete (local).** Independent Test and Review passed on the source committed in `1ca7ccff`. The [reusable conformance cases](../packages/actor-agent/tests/runner-conformance.ts) passed against the real adapter and caught history carryover, grant widening, and unauthorized retry. |
| AW-03-01 · Enforce execution limits | AW-02-01 | **Complete (local).** Independent Test and Review passed on the source committed in `8a201ae8`. The local adapter enforces host-supplied turn, tool, time, and byte budgets, counts failed dispatches, and refuses over-budget work. |
| AW-03-02 · Distinguish stop from settlement | AW-03-01 | **Complete (local).** Independent Test and Review passed on the source committed in `40d9ad38`. A cancelled result or expired cleanup wait does not release the executor while tracked work is pending. Verified local settlement does not establish the outcome of detached or remote work. |
| AW-04-01 · Record correlated execution evidence | AW-03-02 | **Complete (local).** Independent Test and separate Review passed at [`65a2879b`](https://github.com/0xjcf/actor-web/commit/65a2879b6a047e8047a905c0487a8018755176a1). The opt-in trace joins model and tool attempts, parser verdicts, and local cleanup to the owning session. It excludes prompts, payloads, and diagnostics, and reports unavailable usage as unknown. This qualifies local execution and built entries, not packed consumers or remote effects. |
| AW-02-02 · Verify public package compatibility | AW-02-01, AW-03-02, AW-04-01 | **Complete (local).** The 15-cell matrix passed on fresh tarballs built from the code in `67b872cb`. Verified Node ESM/CJS execution and strict TypeScript consumers with and without Zod, plus both top-level `await` and post-evaluation startup in Vite/Chrome. This records local verification, not independent Test or Review. |
| AW-04-02 · Prove one agent-starter consumer | AW-02-02 | Run one specialist through the public adapter with a scripted provider. Invalid or late output cannot advance the workflow. No board redesign or new worker policy. |
| AW-04-03 · Qualify the M1 candidate | AW-04-02 | Run the producer and consumer checks on identified revisions. Record independent Test and separate Review, migration notes, and limitations. Qualification does not publish a release. |

## First two ticket briefs

### AW-00-01 · Reconcile capability status

**Request:** Compare the [execution contract](provider-neutral-agent-execution-contract.md), [transport roadmap](spikes/actor-web-external-transport-design.md), and [agent guide](../packages/actor-agent/README.md) with current public exports and tests. Correct current ownership and maturity statements, not historical records.

**Done when:** A reader can distinguish available primitives from verified end-to-end guarantees. In particular, checkpoint storage is not proof of restart-safe effects, and forwarding an abort signal is not proof that a tool stopped. Actor-Web owns runtime behavior; agent-starter owns workflow decisions. No runtime change is needed for this task.

**Checks:** For each corrected claim, cite an export, test, or recorded result and its limits. Lint changed Markdown with the repo configuration and verify changed links.

### AW-00-02 · Define the specialist execution contract

**Request:** Starting from `createAgent`, `AgentRunner.run`, and `createAgentLoopBehavior`, document how one host binds the task, fresh session, and allowed tools, then receives validated content. Preserve the portable return types; keep execution observations separate from the business result.

**Done when:** The contract specifies who can grant a tool, who accepts the answer, and what the caller sees for a denied tool, invalid output, provider failure, and a stop request with outstanding work. Describe the provider rename migration. Do not implement a scheduler, storage backend, or executor in this ticket.

**Checks:** Check example signatures against the exported types, exercise the documented cases with contract examples, and run the agent package's public-entry build checks. These checks cover the contract, not implementation of the later executor.

## Analyst example and tool ergonomics

These follow-ups came from comparing the Udacity Part II regex agent with Actor-Web's structured tool loop. They extend the backlog without changing the M1 milestone or any queue-board ticket stage. AW-05-01 through AW-05-03 are implemented and verified locally in [the example verification notes](../examples/retail-analyst/verification.md); this does not mean independent Test or Review passed.

| Task | Depends on | Deliverable and acceptance |
| --- | --- | --- |
| AW-05-01 · Add typed `defineTool` | None | Implemented locally: export from the optional `@actor-web/agent/zod` entry; infer handler arguments, normalize generated JSON Schema, validate input before assignment scope and effects, validate handler output. Preserve host grants and the core plain-JSON contract. Check transformed input is not parsed twice and core imports remain Zod-free. |
| AW-05-02 · Default plain-JSON task encoding | None | Implemented locally: allow omitted `encodeTask` with strict plain-JSON encoding. Preserve explicit projections; reject unsupported values instead of silently dropping them. Test default, override, and refused tasks. |
| AW-05-03 · Add `createAnalyst({ provider })` comparison | AW-05-01, AW-05-02 | Implemented locally: [retail analyst](../examples/retail-analyst/README.md) with identical Product 5/weather fixtures, offline and opt-in live runs, scoped native tools, fresh assignment sessions, real-observation final checks, and an actual-notebook comparison script. Verify scripted runs, example suite, public package build, and bounded live parity. |
| AW-05-04 · Expose provider-native schema controls | None | Local candidate: `parallelToolCalls` maps to both provider wires; the live analyst disables parallel calls after an initial batch-limit refusal. Remaining: design strict function schemas, tool-choice controls, and native final-output schemas as provider capabilities. Preserve provider-neutral contracts, compatibility behavior, local validation, and grants. Cover Chat Completions and Responses request shapes and unsupported-provider behavior. Do not mistake the existing `structured()` parser for provider enforcement. |
| AW-05-05 · Define optional required-tool evidence policy | AW-05-03 | Decide whether a reusable host policy should require named successful observations before accepting output. The analyst already enforces its own requirement. Do not turn prompt instructions into authorization or require tool use for all agents. Test skipped, wrong-argument, failed, and unrelated calls. |
| AW-05-06 · Define bounded repair policy | None | Specify which input/output failures can be returned to the model for correction, budgets charged, and termination. Default remains no automatic retry. Never automatically repeat an uncertain effect. Test rejection, allowed repair, exhaustion, and cancellation. |
| AW-05-07 · Repeated parity and fixture conformance | AW-05-03 | Automate fixture equality against the source notebook and repeated same-model comparisons with recorded prompt/tool differences, model snapshot, tokens, call counts, elapsed time, and failures. Keep live runs opt-in and report missing usage as unknown. A single successful run is not a performance claim. |
| AW-05-08 · Validate evidence-linked hypotheses | AW-05-03 | Represent hypothesis status and supporting observation references as data, distinct from established causes. Live findings include an omitted explicit correlation disclaimer and an unsupported precipitation unit; prose instructions alone were insufficient. Add acceptance tests for unsupported evidence, missing uncertainty, and claimed causation. |
| AW-05-09 · Trace decisions and tool examples | AW-05-03 | Implemented and [verified locally](../examples/retail-analyst/tracing-verification.md): preserve assistant explanations alongside calls, optionally request/extract provider reasoning summaries, preserve opaque continuation state without logging it, correlate requested/observed calls and validation, and render color/divider console output plus JSONL. The [v3 analyst requires a validated decision_summary argument on every tool](../examples/retail-analyst/decision-summary-verification.md), replacing reliance on optional prose. Expose typed synthetic examples and enable description injection for the analyst with an off switch. Verify missing summaries, replay, accepted/rejected results, example leakage, trace isolation, and live GPT-4.1 explanations. |

For AW-05-01 through AW-05-03, check `pnpm --filter @actor-web/agent test`, `pnpm --filter @actor-web/agent build`, `pnpm test:examples`, `pnpm typecheck`, and `pnpm architecture:check`. Run the example's scripted and live commands separately; live results qualify only the recorded provider/model and fixture.
