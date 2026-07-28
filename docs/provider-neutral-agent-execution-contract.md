# Provider-Neutral Agent Execution Contract

## Contract surface

- Runtime source of truth: `@actor-web/runtime` `0.2.0`
  - source module: `packages/actor-core-runtime/src/agent-execution-contract.ts`
- Testing fixture and assertion surface: `@actor-web/testing` `0.2.0`
  - source module: `packages/actor-core-testing/src/agent-execution-conformance.ts`
- Contract version: `1`
- Schema version: `1`

### Exported runtime contract helpers

- `AGENT_EXECUTION_CONTRACT_VERSION`
- `createAgentExecutionTrace`
- `createAgentExecutionTraceIdempotencyKey`
- `createExecutionCommandAdmissionReceipt`
- `createExecutionAuthorizedReceipt`
- `createExecutionEffectIntentReceipt`
- `createExecutionTimeoutOrEffectReceipt`
- `createExecutionTimeoutReceipt`
- `createExecutionRetryReceipt`
- `createExecutionCancellationReceipt`
- `createExecutionReconciliationReceipt`
- `createExecutionRejectedReceipt`
- `createExecutionStaleProjectionReceipt`
- `createExecutionSuccessReceipt`
- `parseAgentExecutionTrace`
- `isAgentExecutionTrace`
- `validateAgentExecutionTrace`
- `sortAgentExecutionReceipts`
- `redactAgentExecutionValue`
- `toAgentExecutionReceiptFromEventEnvelope`
- `toAgentExecutionReceiptFromEffectRecord`

### Exported testing contract helpers

- `AGENT_EXECUTION_CONFORMANCE_SUPPORTED_VERSIONS`
- `AGENT_EXECUTION_CONTRACT_SUPPORTED_VERSIONS`
- `getAgentExecutionConformanceFixture`
- `listAgentExecutionConformanceFixtures`
- `assertAgentExecutionConformanceFixture`

## Maturity

- Current
  - legacy Actor-Web surfaces such as `ActorEventEnvelope` and the effect journal remain valid compatibility inputs, but they are not by themselves the canonical execution-trace contract
- Accepted target
  - one provider-neutral, JSON-safe contract that distinguishes command admission, execution authorization, persisted effect intent, effect attempt or outcome, reconciliation, and stale projection
- Candidate
  - the current source contract in `packages/actor-core-runtime/src/agent-execution-contract.ts` and source fixture surface in `packages/actor-core-testing/src/agent-execution-conformance.ts`
  - candidate only until full gate, independent review, human review, merge, and downstream reconfirmation complete
- Deferred
  - npm publication and release-level contract claiming remain deferred until `task-1785250788704`

## Ownership boundary

- Actor-Web owns:
  - authoritative runtime lifecycle facts and receipts
  - contract vocabulary and validation behavior
  - restart, replay, reconciliation, and duplicate-suppression semantics
- FAS owns:
  - evidence normalization
  - workflow and review policy
  - no application behavior authority
- Ignite Element owns:
  - semantic projection and intent-command binding
  - no execution authority
- Integrations remain optional and additive. No FAS-specific or Ignite-specific runtime semantics are embedded in the Actor-Web contract.
- `@actor-web/agent` is unchanged in this task and does not define alternate contract vocabulary.

## Lifecycle vocabulary

- `command_admission`
  - records the admission stage outcome
  - marks discovery as descriptive only
  - records the execution-time recheck set: `command`, `payload`, `principal`, `approval`, `revision`, `idempotency`, `policy`
- `authorization`
  - records execution authorization after recheck
- `effect_intent`
  - records durable effect intent before any external effect attempt
  - use this when state plus intent persistence must be traced without claiming the external effect ran
- `effect_attempt`
  - records an external effect attempt or observed outcome
- `result`
  - records a successful command result
- `rejection`
  - records schema-admitted, domain-accepted, or execution-authorized rejection
- `retry`
  - records a retry decision without claiming a duplicate irreversible effect
- `timeout`
  - records a timeout as a durable fact; timeout is recoverable and may be followed by retry and later success
- `cancellation`
  - records interruption or cancellation
- `reconciliation`
  - records replay or duplicate suppression outcomes
- `projection`
  - records stale projection detection with checkpoint and revision facts
- `event`
  - compatibility adapter from `ActorEventEnvelope`

## Join keys

The canonical join-key set is:

- `intentId`
- `principalId`
- `traceId`
- `receiptId`
- `recordId`
- `actorId`
- `sessionId`
- `commandId`
- `effectId`
- `effectAttemptId`
- `attempt`
- `sequence`
- `revision`
- `checkpointId`
- `correlationId`
- `causationId`

These identities stay distinct. The contract does not collapse intent, authorization, effect intent, effect attempt, reconciliation, projection, or receipt identity.

## Redaction rules

- Secret-like keys are redacted as `[redacted:secret]`
  - `token`
  - `authorization`
  - `apiKey`
  - `api_key`
  - `secret`
  - `password`
  - `credential`
- Prompt-like keys are redacted as `[redacted:prompt]`
  - `prompt`
- Redaction preserves join-key and audit utility. The contract does not expose raw secrets or prompt payloads in fixtures or receipts.

## Supported and unsupported behavior

- Supported schema version
  - `1`
- Fail-closed behavior
  - unsupported version returns `unsupported_version`
  - malformed trace or malformed receipt returns `invalid_receipts`
  - invalid terminal lineage returns `invalid_terminal_lineage` with the violating `receiptId`
- Terminal-lineage rule
  - any terminal rejection followed by later success or other non-allowed post-terminal receipt is invalid
  - allowed post-terminal receipts remain reconciliation and projection
- Recoverable timeout rule
  - timeout is not treated as terminal
  - timeout may be followed by retry and later success

## Semantics

- Models propose intent; Actor-Web alone validates, authorizes, transitions, persists, executes, checkpoints, resumes, reconciles, and emits authoritative facts or receipts.
- Capability discovery is descriptive only and never substitutes for execution-time authorization.
- Actor-Web rechecks command, payload, principal, approval, revision, idempotency, and policy at execution time.
- Persisted effect intent is separate from effect attempt or outcome where atomicity matters.
- External execution is nondeterministic.
- The contract supports restart, replay, reconciliation, and no duplicate irreversible effects.
- The contract does not claim exactly-once external execution.

## Verification receipts

Focused checks completed on July 28, 2026:

- `pnpm --filter @actor-web/runtime exec vitest run src/unit/agent-execution-contract.test.ts`
- `pnpm exec vitest run packages/actor-core-testing/src/agent-execution-conformance.test.ts`
- `pnpm --filter @actor-web/runtime typecheck`
- `pnpm --filter @actor-web/runtime build`
- `pnpm --filter @actor-web/testing typecheck`
- `pnpm --filter @actor-web/testing build`

Docs check completed on July 28, 2026:

- `pnpm exec markdownlint-cli2 --config .markdownlint.jsonc "docs/provider-neutral-agent-execution-contract.md"`

Pending root-owned gate:

- repository full verification is still pending
- independent review and human merge are still pending

## Downstream reconfirmation

No Ignite Element or FAS repository edits were performed in this task.

### Ignite Element must reconfirm after merge or release

- the candidate contract version and supported version remain `1`
- the exact join-key set it will project or bind against
- that it treats Actor-Web receipts as authoritative execution facts
- that any Ignite read model or intent binding remains additive and non-authoritative
- that its consumer integration handles `unsupported_version`, `invalid_receipts`, and `invalid_terminal_lineage` fail-closed behavior

### FAS must reconfirm after merge or release

- the exact receipt and fixture surfaces it will normalize against
- that workflow or review policy does not become application behavior authority
- that evidence joins use the published join-key set without collapsing identities
- that its conformance and review adapters treat `effect_intent`, retry, reconciliation, and stale projection as distinct facts
- that full-gate verification and later release evidence are recorded before FAS upgrades any maturity claim beyond candidate

## Legacy compatibility note

- Existing `ActorEventEnvelope` and effect-journal adapters remain additive compatibility surfaces.
- This document does not publish an alternate contract for `@actor-web/agent`.
