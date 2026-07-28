# Decide and prove reviewed dependency-chain admission for Actor-Web autonomy

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

The live queue is configured independent-only, so every task with dependsOn remains stacking_not_allowed even after its prerequisites complete. Define and implement the narrow reviewed admission policy that lets authoritative dependency chains advance without replacing dependsOn/blocks or weakening final human review. Compare scoped stack-allowed admission with an explicit edge-advancement mechanism; record the chosen contract, migration, audit facts, concurrency/depth limits, and rollback. This is queue-governance work, not permission for unattended merge, deployment, or arbitrary task creation.

## Automation admission

- Expected operator value: Dependency chains can advance with bounded, reviewable autonomy instead of requiring manual queue repair after every completed prerequisite.
- Observability surface: Queue graph edges, admission/rejection reason codes, autonomy policy state, workflow lineage, and reconciliation receipts are inspectable from Actor-Web project-local FAS state.
- Recovery path: Fail closed to independent-only, stop new admissions, preserve existing dependsOn/blocks, and reconcile stranded rows without deleting workflow or evidence history.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after deterministic chain conformance, cycle/missing-edge rejection, bounded concurrency, interruption recovery, and repeated operator-reviewed runs are green.

## Acceptance criteria

- A live before/after conformance fixture proves a completed prerequisite advances exactly the intended dependent task while unrelated and unsatisfied work remains blocked.
- The policy preserves dependsOn and blocks as authoritative, rejects cycles and missing prerequisites, bounds concurrency and stack depth, and emits auditable admission/rejection reasons.
- The initial reviewed policy retains `maxActiveDraftPrs: 5` and adopts `maxStackDepth: 12`; raising the depth to 24 is out of scope until the older Mesh and advisory chains receive a separate audit.
- Human final review and merge remain mandatory; recovery can restore independent-only without losing queue truth.
- The chosen policy and any config migration are documented with operator value, observability, failure handling, and promotion criteria.
- Queue mutation and graph projection handle completed-prerequisite lineage and superseded-edge retirement explicitly: reconciliation detects asymmetric or stale edges, and operators can replace or remove edges without manual JSON edits.
- TDD: a failing test that captures any new generic FAS queue or runtime behavior is written before implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: keep admission decisions deterministic and side-effect-free, confine queue/config mutation to the imperative shell, and return reason-coded facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- .fas-config.json
- .fas/queue/tasks.json
- .fas/state

## Architecture Context

```json
{
  "schemaVersion": 1,
  "responsibilityAxis": {
    "intent": [
      "The operator requests bounded dependency-chain admission for the Evidence-Governed Agent Runtime tasks."
    ],
    "behavior": [
      "The FAS queue dependency graph remains authoritative and admits only dependency-satisfied, valid-lineage work."
    ],
    "policies": [
      "Actor-Web selects stack-allowed with maxActiveDraftPrs 5 and maxStackDepth 12 while preserving mandatory human final review and merge.",
      "Rollback restores independent-only without deleting queue edges, workflow history, or receipts."
    ],
    "capabilities": [
      {
        "name": "Reviewed dependency-chain admission",
        "qualifier": "business",
        "owner": "Actor-Web project policy"
      },
      {
        "name": "Queue validation, admission, reconciliation, and reason-coded facts",
        "qualifier": "runtime",
        "owner": "FAS platform"
      },
      {
        "name": "Model proposals constrained by admitted behavior",
        "qualifier": "agent-model",
        "owner": "Consumer-selected model adapter"
      },
      {
        "name": "Operator projection of queue and workflow facts",
        "qualifier": "host-product",
        "owner": "FAS operator clients"
      }
    ],
    "ports": [
      "Project-local autonomyPolicy configuration",
      "FAS queue reconciliation and operator projection commands"
    ],
    "adapters": [
      "Actor-Web .fas-config.json policy adapter",
      "FAS CLI and MCP read-model adapters"
    ],
    "infrastructure": [
      "Project-local .fas queue, workflow, escalation, and receipt storage"
    ],
    "projections": [
      "fas runtime status",
      "fas queue graph",
      "FAS dependency-chain operator projection"
    ]
  },
  "executionAxis": {
    "functionalCore": [
      "FAS dependency validation and admission decisions are deterministic and reason-coded."
    ],
    "imperativeShell": [
      "Supported FAS commands apply project config and queue reconciliation mutations while preserving append-only workflow evidence."
    ]
  },
  "ownership": [
    {
      "owner": "Actor-Web",
      "responsibilities": [
        "Own project admission requirements and .fas-config.json values.",
        "Prove the evidence-governed chain is admitted without changing application runtime semantics."
      ],
      "maturity": "target"
    },
    {
      "owner": "FAS",
      "responsibilities": [
        "Own generic dependency validation, admission, reconciliation, workflow lineage, and operator read models."
      ],
      "maturity": "current"
    },
    {
      "owner": "Ignite Element",
      "responsibilities": [
        "Consume semantic facts and bind intent commands without becoming execution authority."
      ],
      "maturity": "current"
    }
  ],
  "maturity": [
    {
      "claim": "Independent-only is the pre-change baseline and fail-closed rollback policy.",
      "status": "current",
      "evidenceRefs": [
        ".fas/state/verification/dependency-chain-autonomy-conformance-2026-07-28.json"
      ]
    },
    {
      "claim": "Stack-allowed with depth 12 is active in the local implementation candidate after bounded conformance passed; final human review and merge remain pending.",
      "status": "candidate",
      "evidenceRefs": [
        ".fas-config.json",
        ".fas/tasks/decide-and-prove-reviewed-dependency-chain-admission-for-act.md",
        ".fas/state/architect-check.json",
        ".fas/state/verification/dependency-chain-autonomy-conformance-2026-07-28.json",
        "fas runtime status"
      ]
    },
    {
      "claim": "Depth 24 and legacy depth-17 through depth-22 chain admission remain outside this task.",
      "status": "target",
      "evidenceRefs": [
        ".fas/tasks/decide-and-prove-reviewed-dependency-chain-admission-for-act.md"
      ]
    }
  ],
  "boundaries": [
    "dependsOn and blocks remain authoritative; epics and projections are additive read models.",
    "Human final review and merge remain mandatory.",
    "Actor-Web application runtime packages do not gain FAS or Ignite product semantics.",
    "Every repository remains independently useful and integrations remain optional."
  ],
  "forbiddenCouplings": [
    "Do not modify the FAS or Ignite Element repositories in this task.",
    "Do not replace dependency edges with epic membership or projection state.",
    "Do not enable unattended merge, deployment, arbitrary task creation, or maxStackDepth 24.",
    "Do not mutate .fas/queue/tasks.json manually."
  ],
  "evidenceRefs": [
    ".fas-config.json",
    ".fas/queue/tasks.json",
    ".fas/tasks/decide-and-prove-reviewed-dependency-chain-admission-for-act.md",
    ".fas/state/task-packet.json",
    ".fas/state/architect-check.json",
    "fas runtime status",
    "fas queue reconcile"
  ]
}
```

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-07-28
- Added paths: .fas-config.json, .fas/queue/tasks.json, .fas/state

## Implementation plan

- Capture the current Actor-Web independent-only routing, completed-prerequisite lineage, and superseded-edge fixtures as failing consumer conformance evidence.
- Write the ownership decision: Actor-Web owns project admission requirements and config; FAS owns generic queue mutation, projection, and runtime policy implementation. Create/link the FAS implementation slice if the platform lacks the required primitive.
- Apply the reviewed policy to Actor-Web, prove bounded chain advancement and rollback, then document operator controls and promotion gates.

## Verification plan

- Prove cycle, missing dependency, completed prerequisite, supersede, interruption, concurrency limit, stack-depth limit, and rollback cases against live queue fixtures.
- Verify the graph read model and queue storage agree without manual JSON edits.
- Run Actor-Web FAS status/reconcile checks plus the owning FAS platform verification for any platform change before enabling the policy.

## Risks

- Enabling stacked work without bounded admission could multiply concurrent branches and review burden.
- Mutating terminal evidence rows can damage audit history; terminal lineage and active edge retirement need distinct semantics.
- A project-local config flip before the generic FAS capability is verified would strand the queue again.

## Dependencies

- No task dependency: this is the only immediately runnable member of the epic.
- Any required generic queue/runtime implementation is owned by the FAS platform and must be linked before Actor-Web changes autonomyPolicy.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
