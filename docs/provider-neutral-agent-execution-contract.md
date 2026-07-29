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
- `admitAgentExecutionCommand`
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

### Admission helper surfaces

- `AgentExecutionCommandPrincipal`
  - credential-free only
  - current principal kinds: `authenticated`, `local`, `system`
- `AgentExecutionCommandMetadata`
  - current additive metadata keys:
    - `commandId`
    - `intentId`
    - `correlationId`
    - `revision`
    - `idempotencyKey`
    - `capability`
    - `approval`
    - `policyVersion`
- `AgentExecutionAdmissionPolicy`
  - provider-neutral policy adapter surface for allow or deny decisions
- `AgentExecutionIdempotencyClaimPort`
  - provider-neutral duplicate-claim or duplicate-check surface at the admission seam
  - if command metadata carries `idempotencyKey`, command admission must fail closed unless this adapter is configured
  - current candidate behavior rejects duplicate idempotency keys before dispatch
  - authorized available claims now settle explicitly as `not_dispatched`, `dispatch_succeeded`, or `dispatch_indeterminate`
  - durable restart-safe duplicate recovery is deferred to checkpoint and rehydration work
- gateway transport surface
  - `ActorWebNodeGatewayOptions.commandAdmission`
  - `RuntimeGatewayClientFrame.send.metadata`
  - `RuntimeGatewayClientFrame.ask.metadata`
  - `RuntimeGatewayServerFrame.ack.authorization`
  - `RuntimeGatewayServerFrame.reply.authorization`
  - `RuntimeGatewayServerFrame.error.rejection`
- local or CLI host surface
  - shared admission helper runs immediately before authoritative dispatch
  - explicit local or system principal remains host-owned
  - compatibility return shapes for legacy `send(message)` and `ask(message, timeout?)` stay intact
  - when command admission is configured, the host must provide an explicit policy adapter and fail closed otherwise

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
- Legacy compatibility remains versioned and additive: if a host does not opt into `commandAdmission`, existing command dispatch behavior may continue without additive admission receipts.
- Once a host opts into `commandAdmission`, Actor-Web requires an explicit policy adapter, rechecks command, payload, principal, approval, revision, idempotency, and policy, and fails closed on missing policy or adapter failure.
- Credential-bearing principal projections are malformed admission input. Actor-Web rejects secret-like principal keys such as `token`, `authorization`, and `apiKey` case-insensitively before policy, receipts, callbacks, or dispatch.
- Admission ordering is authoritative: validate metadata and principal, evaluate explicit policy, then perform idempotency claim or duplicate check, then emit authorization and dispatch.
- Policy denial or expiry must not consume or claim an idempotency key.
- Gateway authentication proves identity only; the gateway must reduce auth context to a credential-free principal before command admission.
- Client metadata may propose command identifiers, intent, correlation, revision, idempotency, capability, or approval context, but client-supplied principal data is never authoritative.
- Metadata is additive and optional. Actor payload fields that happen to use the same names remain part of the domain message unless a host explicitly passes separate admission metadata.
- Local and system-internal command paths use explicit trusted principals and the same admission helper, with bypass semantics expressed as facts instead of an implicit shortcut.
- Served gateway ingress requires an explicit principal resolver when `commandAdmission` is enabled.
- Local or CLI host ingress requires an explicit trusted principal when `commandAdmission` is enabled.
- Opted-in admission requires a durable `onDecision` sink before dispatch; sink failure settles any claimed idempotency key as `not_dispatched` and fails closed.
- After a sinked authorization, successful dispatch settles claimed idempotency as `dispatch_succeeded`; dispatch failure after authorization settles it as `dispatch_indeterminate`.
- A duplicate idempotency key at the current admission seam is rejected before actor send or ask dispatch unless a later checkpoint or rehydration seam introduces a join-capable durable outcome.
- Persisted effect intent is separate from effect attempt or outcome where atomicity matters.
- External execution is nondeterministic.
- The contract supports restart, replay, reconciliation, and no duplicate irreversible effects.
- The current task does not claim durable duplicate prevention across restart; exactly-once external execution remains out of scope.

## Verification receipts

Focused post-review checks completed on July 29, 2026 at implementation head `93a12d58`:

- `pnpm --filter @actor-web/runtime exec vitest run src/unit/runtime-gateway.test.ts`
- `pnpm --filter @actor-web/runtime exec vitest run src/unit/serve-actor-web-node.test.ts`
  - required local WebSocket bind permission outside the default sandbox
- `pnpm --filter @actor-web/runtime typecheck`
- `pnpm exec biome check packages/actor-core-runtime/src/agent-execution-contract.ts packages/actor-core-runtime/src/runtime-auth.ts packages/actor-core-runtime/src/runtime-gateway.ts packages/actor-core-runtime/src/serve-actor-web-node.ts packages/actor-core-runtime/src/unit/runtime-gateway.test.ts packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts`
- `pnpm run architecture:check`

Docs check completed on July 29, 2026:

- `pnpm exec markdownlint-cli2 --config .markdownlint.jsonc "docs/provider-neutral-agent-execution-contract.md"`

Last completed repository full gate:

- July 28, 2026 at head `f91aea90`
  - format
  - lint
  - typecheck
  - test
  - architecture drift
  - behavior boundaries
  - semantic index

Last completed independent FAS validation:

- QA, SRE, and reviewer validation completed on July 28, 2026 at head `f91aea90` with zero findings after the credential-containment retry.

Pending post-fix validation at the current candidate head:

- repository full gate after the served-gateway auth-context and fallback-commandId fixes
- independent FAS QA rerun
- independent FAS SRE rerun
- independent reviewer rerun

Still pending before maturity can advance beyond candidate:

- post-fix repository full gate
- post-fix independent QA, SRE, and reviewer validation
- human final review and merge
- downstream reconfirmation in Ignite Element and FAS

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
