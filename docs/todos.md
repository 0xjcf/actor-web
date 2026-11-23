# M1: One bounded, observable specialist execution

Goal: let an application run one typed specialist through real local Actor-Web actors, grant it a tool, validate its answer against the assignment, and tell whether its work has stopped. Prove this with a scripted provider and one agent-starter consumer. Durable recovery, distributed deployment, and unattended delivery are outside M1.

The [agent application north-star draft](examples/agent-app-north-star.md) explores the eventual app API. It is not an API reference and does not change the milestone's acceptance criteria.

## Using the backlog

This file owns task intent and dependencies and records work completed directly in Actor-Web. The [queue-board](../../agent-starter/apps/board/README.md) owns board ticket status. No local task is active. Local completion does not change a board ticket's stage. For each board handoff:

1. Find the task on the board by its `AW-` ID before creating a ticket. Use the ID and task name as the title. Copy its request, acceptance criteria, and checks into the brief.
2. `AW-` IDs are roadmap IDs, not board ticket IDs. Use the corresponding board ticket IDs for `dependsOn`. If manual entry cannot bind a dependency, wait until the board accepts the predecessor as shipped before queuing its successor. A dependency mentioned only in prose is not enforced.
3. Review the target workspace and required checks before starting. A roadmap entry is not a workspace grant or check confirmation. If the spec changes, review it against the existing ticket; do not silently replace the brief or start a duplicate.

## Milestone tasks

| Task | Depends on | Deliverable and acceptance |
| --- | --- | --- |
| AW-00-01 · Reconcile capability status | None | **Complete (local).** Reconciled current capabilities, verification limits, and ownership across the execution contract, transport roadmap, and agent guide. Historical evidence was preserved. |
| AW-00-02 · Define the specialist execution contract | AW-00-01 | **Complete (local).** The [contract](specialist-execution-contract.md) covers one assignment from admission through validation and cleanup. The documented reviewer compiles and runs against the public agent entries with a scripted executor. |
| AW-01-01 · Run a specialist end to end | AW-00-02 | **Complete (local).** Independent Test and Review passed at `1c9c6c34`. The built [reviewer example](../examples/portable-specialist/demo.ts) used a real local actor, a scripted provider, and a granted in-memory read tool. It accepted a supported citation, rejected unsupported output, and denied ungranted effects. |
| AW-01-02 · Extract the Actor-Web executor | AW-01-01 | **Complete (local).** Independent Test and Review passed on the source committed in `54e673fe`. The reviewer consumes `@actor-web/agent/actor-runtime`; fresh assignments isolate history, tool calls, and results. This qualifies the offline local adapter, not the final packed-consumer matrix or the full settlement contract. |
| AW-02-01 · Exercise the executor contract | AW-01-02 | **Complete (local).** Independent Test and Review passed on the source committed in `1ca7ccff`. The [reusable conformance cases](../packages/actor-agent/tests/executor-conformance.ts) passed against the real adapter and caught history carryover, grant widening, and unauthorized retry. |
| AW-03-01 · Enforce execution limits | AW-02-01 | **Complete (local).** Independent Test and Review passed on the source committed in `8a201ae8`. The local adapter enforces host-supplied turn, tool, time, and byte budgets, counts failed dispatches, and refuses over-budget work. |
| AW-03-02 · Distinguish stop from settlement | AW-03-01 | **Complete (local).** Independent Test and Review passed on the source committed in `40d9ad38`. A cancelled result or expired cleanup wait does not release the executor while tracked work is pending. Verified local settlement does not establish the outcome of detached or remote work. |
| AW-04-01 · Record correlated execution evidence | AW-03-02 | Join attempts, tool outcomes, validation, and cleanup to the correct session. Exclude prompts and secrets; report unavailable usage as unknown, not zero. |
| AW-02-02 · Verify public package compatibility | AW-02-01, AW-03-02, AW-04-01 | Run the final contract through packed ESM, CJS, and browser consumers. Root and portable entries work without Zod; the Zod entry works with its declared peer. |
| AW-04-02 · Prove one agent-starter consumer | AW-02-02 | Run one specialist through the public adapter with a scripted provider. Invalid or late output cannot advance the workflow. No board redesign or new worker policy. |
| AW-04-03 · Qualify the M1 candidate | AW-04-02 | Run the producer and consumer checks on identified revisions. Record independent Test and separate Review, migration notes, and limitations. Qualification does not publish a release. |

## First two ticket briefs

### AW-00-01 · Reconcile capability status

**Request:** Compare the [execution contract](provider-neutral-agent-execution-contract.md), [transport roadmap](spikes/actor-web-external-transport-design.md), and [agent guide](../packages/actor-agent/README.md) with current public exports and tests. Correct current ownership and maturity statements, not historical records.

**Done when:** A reader can distinguish available primitives from verified end-to-end guarantees. In particular, checkpoint storage is not proof of restart-safe effects, and forwarding an abort signal is not proof that a tool stopped. Actor-Web owns runtime behavior; agent-starter owns workflow decisions. No runtime change is needed for this task.

**Checks:** For each corrected claim, cite an export, test, or recorded result and its limits. Lint changed Markdown with the repo configuration and verify changed links.

### AW-00-02 · Define the specialist execution contract

**Request:** Starting from `createAgent`, `AgentRuntime.run`, and `createAgentLoopBehavior`, document how one host binds the task, fresh session, and allowed tools, then receives validated content. Preserve the portable return types; keep execution observations separate from the business result.

**Done when:** The contract specifies who can grant a tool, who accepts the answer, and what the caller sees for a denied tool, invalid output, provider failure, and a stop request with outstanding work. Describe the provider rename migration. Do not implement a scheduler, storage backend, or executor in this ticket.

**Checks:** Check example signatures against the exported types, exercise the documented cases with contract examples, and run the agent package's public-entry build checks. These checks cover the contract, not implementation of the later executor.
