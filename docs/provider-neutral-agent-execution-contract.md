# Provider-Neutral Agent Execution Contract

## Contract surface

- Runtime source of truth: [`@actor-web/runtime`](../packages/actor-core-runtime/src/index.ts)
  exports the [execution contract](../packages/actor-core-runtime/src/agent-execution-contract.ts).
- [`@actor-web/testing`](../packages/actor-core-testing/src/index.ts) exports the
  [conformance fixtures and assertions](../packages/actor-core-testing/src/agent-execution-conformance.ts).
- Contract version: `1`
- Schema version: `1`

The equivalent public entries are present in the repository's
`@actor-web/runtime@0.2.1` and `@actor-web/testing@0.2.1` tags. Package versions,
contract versions, and production qualification are separate.

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
  - a duplicate reported by the configured claim port is rejected before dispatch
  - authorized claims settle as `not_dispatched`, `dispatch_succeeded`, or `dispatch_indeterminate`
  - these outcomes describe dispatch, not whether a remote effect committed
- gateway transport surface
  - `NodeGatewayOptions.commandAdmission`
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

- **Available:** Version 1 distinguishes admission, authorization, persisted
  effect intent, attempts and outcomes, reconciliation, and stale projections.
  Legacy `ActorEventEnvelope` and effect-journal records are compatibility inputs,
  not execution traces on their own.
- **Covered:** [Contract tests](../packages/actor-core-runtime/src/unit/agent-execution-contract.test.ts)
  exercise trace validation and admission;
  [gateway tests](../packages/actor-core-runtime/src/unit/runtime-gateway.test.ts)
  cover opt-in admission before dispatch, including refusal and claim settlement;
  [fixture tests](../packages/actor-core-testing/src/agent-execution-conformance.test.ts)
  validate deterministic receipt scenarios. The fixtures retain their candidate
  metadata and do not qualify a live executor or deployment.
- **Not established:** Restart-safe duplicate suppression, cross-process owner
  fencing, and exactly-once external effects. A serializable receipt or checkpoint
  is not proof that a host persisted it across a crash or that an external action
  did or did not run.

The [Actor-Web M1 backlog](todos.md) tracks the next local specialist proof.
The dated results below apply only to their recorded subjects.

## Ownership boundary

- **Actor-Web** owns runtime lifecycle, enforcement of declared grants,
  authoritative runtime facts and receipts, and contract validation.
- **The trusted host** supplies policy, tool implementations, storage, and
  authoritative evidence needed to reconcile uncertain external effects.
- **Agent-starter** owns workflow decisions: task and role selection, workflow
  gates, and review policy. Those decisions do not replace runtime authorization
  or make model output an execution receipt.
- **Ignite Element** owns its projection and intent-command binding, not runtime
  execution. Consumers should treat runtime receipts as authoritative facts,
  preserve the join keys, and reject unsupported or invalid traces.

Integrations are optional. The contract does not depend on agent-starter,
Ignite Element, or the retired FAS workflow. `@actor-web/agent` provides agent
utilities, not an alternate execution-receipt contract.

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
  - records a timeout, not effect settlement; the trace may include a later retry and success
- `cancellation`
  - records interruption or cancellation; an abort request alone does not establish cleanup or rollback
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
- [Key-based redaction](../packages/actor-core-runtime/src/agent-execution-contract.ts)
  preserves join keys but does not sanitize arbitrary text. Hosts must keep raw
  secrets and prompts out of receipt fields not covered by these rules.

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

- Models propose intent; Actor-Web validates, applies configured admission policy,
  and dispatches through runtime and host ports. Model text is not an authoritative
  runtime fact.
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
- Opted-in admission requires a configured `onDecision` sink before dispatch.
  Sink failure settles any claimed idempotency key as `not_dispatched` and fails
  closed. The host is responsible for the sink's durability.
- After a sinked authorization, successful dispatch settles claimed idempotency as `dispatch_succeeded`; dispatch failure after authorization settles it as `dispatch_indeterminate`.
- A duplicate reported by the claim port is rejected before actor send or ask
  dispatch. Whether claims survive a restart depends on the host's implementation.
- Persisted effect intent is separate from effect attempt or outcome where atomicity matters.
- External execution is nondeterministic.
- The [rehydration helper](../packages/actor-core-runtime/src/agent-session-checkpoint-store.ts)
  defers recovery for a readable checkpoint with unresolved irreversible effect
  intent rather than assuming the effect ran or replaying it. The
  [checkpoint tests](../packages/actor-core-runtime/src/unit/agent-session-checkpoint-store.test.ts)
  cover this decision and same-process filesystem write coordination. A host
  sharing the store across processes must enforce single-writer ownership.
- The [toolbox timeout test](../packages/actor-core-runtime/src/unit/actor-tools.test.ts)
  exercises a caller receiving `ACTOR_TOOL_TIMEOUT` and the tool receiving an
  aborted signal. The timeout races the tool's promise; it does not wait for
  underlying work to settle or prove remote effects stopped.

## Historical verification receipts

This section and the downstream checklist below record the July 2026 effort.
FAS references and pending items here describe that effort, not the current
workflow or release gates.

Focused post-review checks completed on July 29, 2026 at implementation head `93a12d58`:

- `pnpm --filter @actor-web/runtime exec vitest run src/unit/runtime-gateway.test.ts`
- `pnpm --filter @actor-web/runtime exec vitest run src/unit/serve-actor-web-node.test.ts`
  - required local WebSocket bind permission outside the default sandbox
- `pnpm --filter @actor-web/runtime typecheck`
- `pnpm exec biome check packages/actor-core-runtime/src/agent-execution-contract.ts packages/actor-core-runtime/src/runtime-auth.ts packages/actor-core-runtime/src/runtime-gateway.ts packages/actor-core-runtime/src/serve-actor-web-node.ts packages/actor-core-runtime/src/unit/runtime-gateway.test.ts packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts`
- `pnpm run architecture:check`

Docs check completed on July 29, 2026:

- `pnpm exec markdownlint-cli2 --config .markdownlint.jsonc "docs/provider-neutral-agent-execution-contract.md"`

Post-fix product implementation full gate:

- July 29, 2026 at head `fb1643be`
  - format
  - lint
  - typecheck
  - test
  - architecture drift
  - behavior boundaries
  - semantic index

Fresh review remediation completed on July 29, 2026 at candidate head
`4013f0e5`:

- pre-auth gateway context remains `undefined` until verified
- missing or failed principal resolution produces a sanitized
  `schema-admitted` rejection with an explicit `unknown` principal and no
  overstated rechecks
- principal resolution may be synchronous or asynchronous and is awaited inside
  the same fail-closed boundary
- enabled gateway and CLI-host admission requires its principal, policy, and
  durable decision hooks
- malformed CLI admission modules fail before topology startup
- durable decision-sink failures emit fixed, redacted local operational
  telemetry while preserving settlement and generic client errors
- focused runtime and CLI-host suites passed with 78 and 40 tests, respectively
- the full FAS gate passed format, lint, typecheck, test, architecture drift,
  behavior boundaries, and semantic index

Last completed independent FAS validation:

- QA and SRE validation completed on July 29, 2026 at head `4013f0e5` with
  zero findings.
- Reviewer validation completed on July 29, 2026 at head `4013f0e5` with
  zero findings and an approval recommendation.

Still pending before maturity can advance beyond candidate:

- human final review and merge
- downstream reconfirmation in Ignite Element and FAS

## Historical downstream reconfirmation checklist

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
