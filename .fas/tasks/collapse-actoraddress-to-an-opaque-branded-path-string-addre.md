# Collapse ActorAddress to an opaque branded path string (Address.from + typed AddressQuery)

## Source

Created with `fas create-task` on 2026-06-20.

## Problem

L0 foundation (locked 2026-06-20, maintainer); gates unify-directory (task-1781880513048). Make ActorAddress an opaque BRANDED path string (type ActorAddress = string & { brand }) — the path IS the address. Sole minter: Address.from(input: string | { id: string; kind?: 'actor'|'callback'; node?: string }) normalizing both shapes to a total branded value (reuse current mint/parse incl. the callback/ reserved-prefix guard). Add parse(addr): { id; kind; node } boundary helper; hot routing keeps path.includes('/callback/'); parseActorPath stays the wire/ingress parser. Add AddressQuery { id?; kind?; node? } + directory.find(query) replacing listByType(string). Reframe node as runtime-owned placement (callers pass id (+kind); runtime supplies node; node only for explicit remote targeting). Reconcile addr-opacity deferrals (guardian /system/guardian, callback namespace) onto the A model. Migration ~66 addr.id/.kind/.node reads to parse()/helpers; ~295 .path reads + 71 map-keys collapse to identity. Rationale + running-code/tsc evidence: auto-memory actor-web-address-model-decision.

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/utils/factories.ts
- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/distributed-actor-directory.ts
- packages/actor-core-runtime/src/create-actor-ref.ts
- packages/actor-core-runtime/src/capability-security.ts

## Scope Amendments

- None.

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- None known at task creation.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
