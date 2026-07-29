# Propagate authenticated principal context and emit command admission facts

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

Gateway authentication already resolves an auth context, but send and ask do not carry a uniform principal, capability, policy, and admission record through local and remote command paths. Introduce a credential-free principal context and deterministic command-admission decision at the runtime boundary, then emit accepted or rejected facts into the provider-neutral trace contract. Preserve local ergonomics, prevent bypass through alternate ingress paths, and keep authorization policy supplied through neutral Actor-Web ports rather than FAS-specific rules.

## Acceptance criteria

- Every external send, ask, gateway, CLI, and remote-client command path reaches one command-admission seam with the same principal, capability request, target, command id, and policy-version shape.
- Accepted and rejected decisions emit durable, reason-coded trace facts; raw credentials and secrets never enter actor messages, logs, snapshots, or projections.
- Local and system-internal messages have explicit principals and bypass rules that cannot be confused with unauthenticated external commands.
- Tests prove allowed, denied, expired, malformed, duplicate, local, remote, ask, and send paths plus policy-adapter failure behavior.
- Compatibility and migration for existing gateway auth hooks and clients is versioned and documented.
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

- packages/actor-core-runtime/src/agent-execution-contract.ts
- packages/actor-core-runtime/src/runtime-gateway-shared.ts
- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/node.ts
- packages/actor-core-runtime/src/unit
- packages/actor-core-testing/src
- packages/agent-workflow-cli/src/host
- docs/provider-neutral-agent-execution-contract.md
- packages/actor-core-runtime/src/serve-actor-web-node.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts
- packages/agent-workflow-cli/src/cli/index.ts
- packages/actor-core-runtime/src/runtime-auth.ts
- .fas/memory/pr-feedback.md

## Architecture Context

```json
{
  "schemaVersion": 1,
  "responsibilityAxis": {
    "intent": [
      "External callers, local operators, CLI hosts, and remote clients propose commands; a proposal is not execution authority.",
      "Authentication adapters may prove an identity, but raw credentials never become runtime principal context."
    ],
    "behavior": [
      "Actor behavior and FSM constraints remain the authority for domain acceptance after schema admission.",
      "Every external send and ask reaches one Actor-Web command-admission seam before actor delivery.",
      "Local and system-internal delivery uses explicit trusted principals and reason-coded bypass facts rather than an implicit unauthenticated shortcut."
    ],
    "policies": [
      "Capability discovery is descriptive; execution rechecks command, payload, principal, approval, revision, idempotency, and policy.",
      "A provider-neutral admission policy port returns deterministic allowed or denied facts and never throws across the functional-core boundary.",
      "Policy-adapter timeout or failure fails closed for external commands and becomes a durable reason-coded fact.",
      "Duplicate command identities are idempotently rejected or joined to the existing authoritative outcome."
    ],
    "capabilities": [
      {
        "name": "Credential-free principal normalization and command admission",
        "qualifier": "business",
        "owner": "Actor-Web"
      },
      {
        "name": "Gateway, remote-source, local-host, and CLI command coordination",
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
      "Versioned JSON-safe principal and capability request",
      "Deterministic command-admission policy port",
      "Provider-neutral admission decision facts and receipts",
      "Compatibility adapters for current runtime gateway auth hooks and command sources"
    ],
    "adapters": [
      "Runtime gateway authentication-to-principal reduction",
      "Remote Actor-Web source command envelope adapter",
      "Local runtime and CLI system-principal adapter",
      "Optional application policy adapters supplied by consumers"
    ],
    "infrastructure": [
      "Actor-Web runtime gateway and source transports",
      "Actor-Web authoritative execution trace and receipt storage"
    ],
    "projections": [
      "Consumer-owned semantic read models joined by principal, command, intent, correlation, sequence, revision, and receipt identities",
      "FAS-owned evidence projections that do not authorize application execution"
    ]
  },
  "executionAxis": {
    "functionalCore": [
      "Principal validation, capability normalization, admission decisions, reason codes, redaction, and duplicate checks are deterministic and side-effect-free."
    ],
    "imperativeShell": [
      "Gateway, remote source, local host, and CLI adapters obtain authenticated context, call the admission port, persist authoritative facts where required, and only then dispatch accepted commands."
    ]
  },
  "ownership": [
    {
      "owner": "Actor-Web",
      "responsibilities": [
        "Own principal context, admission vocabulary, command authorization, authoritative facts, dispatch, persistence, and reconciliation.",
        "Prevent alternate ingress paths from bypassing admission."
      ],
      "maturity": "current"
    },
    {
      "owner": "FAS",
      "responsibilities": [
        "Normalize Actor-Web evidence and govern FAS workflow or review policy without becoming application behavior authority."
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
      "claim": "Runtime gateway authentication, command-capable sources, CLI send or ask, and the execution trace contract exist as separate current surfaces.",
      "status": "current",
      "evidenceRefs": [
        "packages/actor-core-runtime/src/runtime-auth.ts",
        "packages/actor-core-runtime/src/runtime-gateway.ts",
        "packages/actor-core-runtime/src/actor-web-source.ts",
        "packages/agent-workflow-cli/src/host/runtime-host.ts",
        "packages/actor-core-runtime/src/agent-execution-contract.ts"
      ]
    },
    {
      "claim": "One credential-free principal and command-admission seam across external ingress paths is the accepted target.",
      "status": "target",
      "evidenceRefs": [
        ".fas/tasks/propagate-authenticated-principal-context-and-emit-command-a.md"
      ]
    },
    {
      "claim": "Implemented principal and admission contracts remain candidate until focused verification, full verification, independent review, and human merge complete.",
      "status": "candidate",
      "evidenceRefs": [
        ".fas/state/verification/latest.json",
        ".fas/state/review-summary.md"
      ]
    },
    {
      "claim": "Checkpoint rehydration, distributed CLI hosting, FAS conformance, and publication remain dependency-ordered follow-up tasks.",
      "status": "deferred",
      "evidenceRefs": [
        ".fas/queue/tasks.json"
      ]
    }
  ],
  "boundaries": [
    "Schema-admitted, domain-accepted, and execution-authorized remain distinct facts.",
    "Authentication proves identity; command admission decides whether a specific request may proceed.",
    "Actor-Web runtime packages remain provider-neutral and contain no FAS-specific or Ignite-specific product semantics.",
    "Compatibility migration is additive and versioned; this task does not introduce a database schema migration."
  ],
  "forbiddenCouplings": [
    "Do not modify the FAS or Ignite Element repositories.",
    "Do not propagate tokens, cookies, authorization headers, passwords, private keys, or provider credentials into messages, snapshots, logs, projections, fixtures, or receipts.",
    "Do not let capability advertisement, authentication success, model output, a projection, or a FAS review decision authorize execution.",
    "Do not allow gateway, remote source, local host, CLI, send, or ask paths to bypass the admission seam.",
    "Do not claim exactly-once external execution; preserve idempotency and authoritative duplicate outcomes."
  ],
  "evidenceRefs": [
    "docs/provider-neutral-agent-execution-contract.md",
    "packages/actor-core-runtime/src/agent-execution-contract.ts",
    "packages/actor-core-runtime/src/runtime-auth.ts",
    "packages/actor-core-runtime/src/runtime-gateway.ts",
    "packages/actor-core-runtime/src/actor-web-source.ts",
    "packages/agent-workflow-cli/src/host/runtime-host.ts"
  ]
}
```

## Scope Amendments

- Corrected stale package hints from `packages/runtime`, `packages/testing`, and
  `packages/cli` to the live package directories.
- Clarified that "migration" means a versioned additive API compatibility path,
  not a database migration.

- Type: review-finding
- Added at: 2026-07-29T02:43:15Z
- Trigger: PR 54 blocking review findings exposed production served-gateway and CLI admission bypasses.
- Reason: Thread provider-neutral commandAdmission configuration through the supported served-node and actor-web serve entry points, with focused regression coverage.
- Added paths: packages/actor-core-runtime/src/serve-actor-web-node.ts, packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts, packages/agent-workflow-cli/src/cli/index.ts
- Evidence source: GitHub PR review
- Evidence: GitHub PR review | [PR 54](https://github.com/0xjcf/actor-web/pull/54) | Codex P1 findings: served gateway and shipped CLI entry could not opt into admission.
- Accuracy signal: Verified against serve-actor-web-node.ts hub construction and cli/index.ts createRuntimeHostFromFile call.
- Follow-up needed: Reconfirm runtime gateway and CLI admission conformance after focused and full verification.

- Type: review-finding
- Added at: 2026-07-29T04:00:30Z
- Trigger: Final PR 54 review required typed auth-context propagation, and babysit closeout required durable review-memory capture.
- Reason: Include the runtime auth generic needed to preserve verified context through served gateway hooks and the project-local PR feedback memory required by the babysit workflow.
- Added paths: packages/actor-core-runtime/src/runtime-auth.ts, .fas/memory/pr-feedback.md
- Evidence source: FAS reviewer and fas-babysit
- Evidence: FAS reviewer and fas-babysit | [PR 54](https://github.com/0xjcf/actor-web/pull/54) | Reviewer found served-node auth context was stripped; babysit requires reusable review lessons after each sweep.
- Accuracy signal: Verified against runtime-auth.ts generic propagation and committed PR #54 memory entry.
- Follow-up needed: Downstream Ignite/FAS reconfirmation remains required after merge; no downstream repository edits were made.

## Implementation plan

- Inventory local, gateway, remote-client, CLI, send, and ask ingress paths and define the credential-free principal/capability context shared by all of them.
- Introduce one neutral admission port and thread its decision facts through the accepted trace contract without putting raw credentials in actor messages.
- Migrate adapters compatibly, close bypass paths, and document internal/system principal semantics.

## Verification plan

- Test allowed, denied, expired, malformed, duplicate, local, remote, send, ask, gateway, CLI, and policy-adapter failure cases.
- Assert redaction and prove raw credentials never reach messages, snapshots, logs, receipts, or projections.
- Run runtime, CLI, testing, gateway integration, boundary, and full verification lanes.

## Risks

- Parallel ingress paths can accidentally bypass admission if the seam is applied only at the gateway.
- Principal context can become a credential leak if authentication material is not reduced before runtime propagation.
- Changing send/ask contracts without compatibility staging can break existing consumers.

## Dependencies

- task-1785250528660 - provider-neutral execution trace and admission-decision fact contract.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
