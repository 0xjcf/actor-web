# Define provider-neutral agent execution trace and receipt contract

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

Actor-Web has correlation and causation fields on emitted events plus separate command, supervision, effect-journal, and projection surfaces, but no single provider-neutral contract that proves an agent request became an admitted or rejected command, actor fact, effect attempt, durable receipt, reconciliation outcome, and consumer projection. Specify the canonical vocabulary, IDs, envelopes, redaction rules, ordering and idempotency semantics, retention/freshness rules, and testing utilities. Actor-Web owns runtime lifecycle and effect truth; FAS owns policy/evidence interpretation; Ignite only projects admitted read models. Do not import provider, FAS, or Ignite product semantics into the runtime contract.

## Acceptance criteria

- One canonical trace links command request, admission decision, actor transition or emitted fact, tool/effect attempt, receipt, reconciliation, and projection using stable correlation, causation, actor, session, command, and effect identifiers.
- The contract distinguishes declared intent, authorized execution, attempted effect, observed result, reconciled truth, and projected state; rejected and interrupted paths are first-class.
- Sensitive principal, prompt, credential, and tool payload fields have explicit redaction and retention rules while receipts remain audit-useful.
- Runtime and testing packages provide deterministic conformance fixtures for success, rejection, timeout, retry, duplicate suppression, interruption, and stale projection paths.
- Existing ActorEventEnvelope and effect-journal compatibility or migration is documented and versioned without importing consumer semantics.
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

- packages/actor-core-runtime/src
- packages/actor-core-testing/src
- packages/actor-agent/src
- docs/provider-neutral-agent-execution-contract.md
- .fas-config.json
- packages/actor-core-testing/package.json
- packages/actor-core-testing/vitest.config.ts

## Architecture Context

```json
{
  "schemaVersion": 1,
  "responsibilityAxis": {
    "intent": [
      "Models and callers propose versioned command intent; an intent proposal is not execution authority."
    ],
    "behavior": [
      "Actor behavior and FSM constraints determine whether schema-admitted input is domain-accepted.",
      "Actor-Web rechecks command, payload, principal, approval, revision, idempotency, and policy before any execution attempt."
    ],
    "policies": [
      "Capability discovery is descriptive and cannot authorize execution.",
      "External execution is nondeterministic; success, timeout, retry, cancellation, authorization failure, and partial failure are durable reason-coded facts or receipts.",
      "Sensitive principal, prompt, credential, and tool payload data is redacted without destroying join-key or audit utility."
    ],
    "capabilities": [
      {
        "name": "Provider-neutral execution trace and receipt validation",
        "qualifier": "business",
        "owner": "Actor-Web"
      },
      {
        "name": "Authorization, transition, persistence, execution, checkpoint, resume, and reconciliation",
        "qualifier": "runtime",
        "owner": "Actor-Web"
      },
      {
        "name": "Evidence normalization and FAS workflow or review policy",
        "qualifier": "host-product",
        "owner": "FAS"
      },
      {
        "name": "Semantic fact projection and intent-command binding",
        "qualifier": "host-product",
        "owner": "Ignite Element"
      }
    ],
    "ports": [
      "Versioned JSON-safe execution trace and receipt contract",
      "Runtime command-admission and effect-result facts",
      "Testing conformance fixtures and assertion utilities"
    ],
    "adapters": [
      "Existing ActorEventEnvelope compatibility adapter",
      "Existing effect-journal compatibility adapter",
      "Optional provider, FAS, and Ignite consumer adapters outside the provider-neutral runtime core"
    ],
    "infrastructure": [
      "Actor-Web runtime persistence and effect journal",
      "Actor-Web testing fixture storage"
    ],
    "projections": [
      "Consumer-owned semantic read models joined by stable trace identities",
      "FAS-owned evidence and workflow review projections"
    ]
  },
  "executionAxis": {
    "functionalCore": [
      "Contract construction, validation, lifecycle transition rules, redaction classification, ordering checks, and idempotency decisions are deterministic and side-effect-free."
    ],
    "imperativeShell": [
      "Actor-Web persists state plus effect intent where atomicity is required, invokes external effects, records durable outcomes, resumes, replays, and reconciles without duplicating irreversible effects."
    ]
  },
  "ownership": [
    {
      "owner": "Actor-Web",
      "responsibilities": [
        "Own the provider-neutral runtime contract and authoritative lifecycle facts or receipts.",
        "Preserve principal, intent, correlation, attempt, sequence, revision, checkpoint, and receipt identities.",
        "Prove restart, replay, reconciliation, and duplicate suppression."
      ],
      "maturity": "current"
    },
    {
      "owner": "FAS",
      "responsibilities": [
        "Normalize Actor-Web evidence and govern FAS workflow and review policy without becoming application behavior authority."
      ],
      "maturity": "current"
    },
    {
      "owner": "Ignite Element",
      "responsibilities": [
        "Project semantic facts and bind intent commands without becoming execution authority."
      ],
      "maturity": "current"
    }
  ],
  "maturity": [
    {
      "claim": "ActorEventEnvelope, command, effect-journal, and projection surfaces exist but do not yet form one provider-neutral execution trace.",
      "status": "current",
      "evidenceRefs": [
        "packages/runtime/src",
        "packages/agent/src"
      ]
    },
    {
      "claim": "The versioned JSON-safe execution trace, receipts, migration adapters, and conformance fixtures are the accepted target for this task.",
      "status": "target",
      "evidenceRefs": [
        ".fas/tasks/define-provider-neutral-agent-execution-trace-and-receipt-co.md"
      ]
    },
    {
      "claim": "The implemented contract becomes a candidate until focused verification, full verification, independent review, and human merge complete.",
      "status": "candidate",
      "evidenceRefs": [
        ".fas/state/verification/latest.json",
        ".fas/state/boundary-review-findings.md"
      ]
    },
    {
      "claim": "Authenticated principal propagation, durable checkpoint rehydration, distributed CLI hosting, FAS control-plane conformance, and publication remain dependency-ordered follow-up tasks.",
      "status": "deferred",
      "evidenceRefs": [
        ".fas/queue/tasks.json"
      ]
    }
  ],
  "boundaries": [
    "Models propose; behavior and FSM constraints bound domain acceptance; Actor-Web alone authorizes and executes.",
    "Schema-admitted, domain-accepted, and execution-authorized are distinct facts.",
    "Capability discovery never substitutes for execution-time authorization.",
    "FAS and Ignite integrations are additive and optional; each repository remains independently useful.",
    "Actor-Web runtime packages contain no FAS-specific or Ignite-specific product semantics."
  ],
  "forbiddenCouplings": [
    "Do not modify the FAS or Ignite Element repositories.",
    "Do not make a model proposal, schema parse, capability advertisement, projection, or FAS review decision execution authority.",
    "Do not collapse intent, command, effect attempt, receipt, reconciliation, and projection identities.",
    "Do not claim exactly-once external execution; prove durable intent, idempotency, reconciliation, and no duplicate irreversible effects instead.",
    "Do not expose secrets or raw sensitive payloads in conformance fixtures or receipts."
  ],
  "evidenceRefs": [
    ".fas/state/task-packet.json",
    ".fas/state/architect-check.json",
    "packages/runtime/src",
    "packages/testing/src",
    "packages/agent/src",
    "docs"
  ]
}
```

## Scope Amendments

- Type: package-root-correction
- Added at: 2026-07-28
- Trigger: delegated staff-engineer live package-manifest check
- Reason: The queued aliases packages/runtime, packages/testing, and packages/agent do not exist. Live manifests map the intended published surfaces to @actor-web/runtime in packages/actor-core-runtime, @actor-web/testing in packages/actor-core-testing, and @actor-web/agent in packages/actor-agent; an explicit documentation handoff path is required by the cross-repo deliverable.
- Added paths: packages/actor-core-runtime/src | packages/actor-core-testing/src | packages/actor-agent/src | docs/provider-neutral-agent-execution-contract.md
- Removed paths: docs | packages/runtime/src | packages/testing/src | packages/agent/src
- Evidence source: package.json manifests and task-1785250528660 acceptance contract
- Evidence: package.json manifests and task-1785250528660 acceptance contract | packages/actor-core-runtime/package.json,packages/actor-core-testing/package.json,packages/actor-agent/package.json
- Accuracy signal: All three live manifests are version 0.2.0 and export the package names named by the task; the original roots are absent.
- Follow-up needed: Regenerate planning and orchestration; restart the staff-engineer step before code writing.

- Type: package-root-correction
- Added at: 2026-07-28
- Trigger: corrected pipe-delimited scope refresh
- Reason: Reconcile the active change envelope to the four verified Actor-Web package and handoff paths after removing absent alias roots from the brief.
- Added paths: packages/actor-core-runtime/src, packages/actor-core-testing/src, packages/actor-agent/src, docs/provider-neutral-agent-execution-contract.md
- Evidence source: live package manifests
- Evidence: live package manifests | packages/actor-core-runtime/package.json|packages/actor-core-testing/package.json|packages/actor-agent/package.json
- Accuracy signal: The brief now contains exactly four existing or explicitly planned paths and no absent package aliases.
- Follow-up needed: Restart the read-only staff-engineer step under the new orchestration generation.

- Type: test-lane-conformance
- Added at: 2026-07-28
- Trigger: canonical closeout ChangeSet gate
- Reason: The new @actor-web/testing conformance fixture must run through a working package test lane and the FAS full test command.
- Added paths: .fas-config.json, packages/actor-core-testing/package.json, packages/actor-core-testing/vitest.config.ts
- Evidence source: fas validate-task
- Evidence: fas validate-task | .fas/state/closeout-readiness/latest.json | PACKAGE_TESTS_COVERED_BY_VERIFICATION flagged the changed fixture; the existing package test inherited the root setup path and failed before executing tests.
- Accuracy signal: pnpm --filter @actor-web/testing test must pass and appear in .fas-config.json testCommand
- Follow-up needed: Rerun QA, SRE, reviewer, and one final full verification after the lane repair.

## Implementation plan

- Inventory command, ActorEventEnvelope, supervision, tool/effect journal, reconciliation, and source-projection identifiers and classify compatibility gaps.
- Specify the versioned provider-neutral envelopes, lifecycle vocabulary, redaction/retention rules, ordering/idempotency semantics, and ownership matrix before public API changes.
- Implement runtime/testing conformance fixtures and migration adapters in incremental contract-first slices.

## Verification plan

- Add schema and type conformance tests for every envelope and identifier relationship.
- Exercise success, rejection, timeout, retry, duplicate suppression, interruption, stale projection, redaction, and version-mismatch traces.
- Run affected package tests, contract/docs checks, architecture boundaries, and the repository full verification lane.

## Risks

- A single oversized envelope can couple unrelated lifecycle layers and expose sensitive payloads.
- Reusing correlation as causation or effect identity would make retries and reconciliation ambiguous.
- Calling an event or projection a receipt would overstate execution truth; vocabulary must stay explicit.

## Dependencies

- task-1785250502043 - reviewed dependency-chain admission and graph-truth foundation.
- task-1781273347595 - completed 0.2 public package facade baseline.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
