# Persistent PR Feedback Memory

Reusable lessons from PR review. Each entry is a pattern the pipeline should catch earlier next time — not task-specific detail.

## PR #31 — opaque actor addresses / one canonical factory (2026-06-20, 6-agent)

- **"Centralize minting in one factory" tasks must grep for ALL inline mint sites, not just the named ones.** The plan named three consolidation sites (spawn, topology, guardian), but two more inline address literals survived review and shipped: `create-actor-ref.ts` (`XStateActorRef.address`) and `capability-security.ts` (mock fallback), both hand-building non-canonical `/actors/<id>` paths with no `node`. CodeRabbit flagged the first; the second was found only by a follow-up grep. Pipeline fix: for any "single source / one factory" task, the implementer and QA should grep the whole package for address-shaped object literals (`{ id, kind, … path:` and `path: \`actor://…\`` / `path: \`/…${`) and assert none bypass the factory.

- **Round-trip + path-discriminator contracts need adversarial edge tests.** The canonical-address round-trip (mint → `parseActorPath` → equal) had an untested hole: an actor id starting with `callback/` parses back as `kind:'callback'`. When a parser uses a path segment as a discriminator, add a test for ids that collide with that discriminator, and reserve the prefix as a value-object precondition in the factory.

- **A serialized-format change ripples into test fixtures asserting the old format.** Canonicalizing the address path broke a `sourceActor: '/actors/…'` expectation in `runtime-gateway.test.ts`. When changing any serialized format, grep the test surface for the old literal and update the assertions in the same change (and treat such a break as the change's own test coverage, not a regression).

- **The CodeRabbit-CLI-before-`fas done` gate was skipped by the autonomous 6-agent flow (2nd occurrence after P2).** Reviewer → `verify --full` → `fas done` → push ran with no CLI step, so the bot left 5 post-closeout threads. The gate depends on a manual orchestrator step the runtime does not perform. Recommendation: wire a CodeRabbit pass into the FAS reviewer/closeout gate (platform repo) so `fas done` blocks on it; until then the orchestrator must run `coderabbit review --base main` before allowing closeout on every task.

## PR #32 — opaque branded ActorAddress (2026-06-24, 6-agent + babysit)

- **The CodeRabbit *CLI* re-run is stateful/incremental and under-reports — the PR *bot's* fresh full pass is the source of truth.** After fixing the first CLI batch, a `coderabbit review --base main` CLI re-run reported only 1 finding; the PR bot's full review then found 10 (a parse-in-log site the CLI missed in `create-component.ts`, an incomplete `plan-interpreter` fix, the `parseActorPath`/mint inconsistency, a `_sender` over-loosening). Pipeline fix: never treat a green CLI re-run as "bot-clean" — always budget a babysit triage round on the real bot output (or re-run the CLI against a fresh base each pass).

- **A value-object precondition added to the constructor must be mirrored in EVERY brand-emission / ingress site, not just the constructor.** This PR added a `/callback/`-segment + slash guard to `mint`, but left `parseActorPath` (the wire/ingress parser) ungated, so a malformed wire path still branded an invalid address and the `.includes('/callback/')` hot-path misrouted it. (Extends the PR#31 "grep all mint sites" lesson to the parse/ingress sites.) Route `parse*`/ingress through the same factory so invalid input is rejected at the boundary, which also keeps a hot-path fast check (`.includes`) provably safe by construction instead of by assumption.

- **A migration that swaps a safe field read for a throwing call (`.id` → `parse(addr).id`) introduces a throw-in-log / throw-before-guard regression class.** The sweep put `parse()` into debug logs and *before* validation guards (`plan-interpreter` ask path L322; `create-component` mount), so a malformed address could abort the operation from a log-only path or pre-empt the intended onError flow. When replacing a non-throwing read with a throwing one, audit every log-only and pre-guard use: compute a safe label once (the raw value), never parse before the validity guard or inside a catch.

- **Relaxing a type-check during a migration can silently loosen a semantic contract.** `_sender` validation was flipped from `typeof === 'object'` to `typeof === 'string' && length > 0`, which accepts `"not-an-address"`; the architect's intent was an address-*shape* ("string/`Address.from`") check. When a branded-string migration relaxes a guard, preserve the SHAPE validation (a non-throwing `isActorAddressShape`), not just the primitive type.

- **Pre-existing latent bug surfaced (not fixed here, follow-up):** `create-actor-ref.ts` stores `parent` as a string id (`parse(this.address).id`) while the constructor/`get parent()` expose it as an `ActorRef` — a string masquerading as a ref. `main` already did this (`this.address.id`); the migration preserved it, so it's out of scope for the address PR but worth a dedicated fix.

## PR #37 — runtime correctness hardening babysit (2026-07-05, single-agent)

- **CodeRabbit top-level AI-agent prompts can contain actionable outside-diff and nitpick items that do not appear as unresolved inline threads.** This review had four unresolved threads, but the "Prompt for all review comments with AI agents" block also contained two outside-diff findings and two nitpicks that were valid and fixable. Babysit triage should parse the top-level review body and not stop at unresolved review threads.

- **Runtime contexts that carry live `ActorRef`s need an explicit serialized projection.** Component actors legitimately preserve live dependency refs inside in-memory handler context, but snapshot `toJSON()` and remote projections must omit those refs. When adding live refs to context, add a focused serialization test that proves the runtime context still has the ref while the durable JSON projection does not.

## PR #38 — labs mesh foundation babysit (2026-07-05, single-agent)

- **Nested public config additions need their own exported type alias when the package already exports a same-named lower-level config.** Adding `ActorSystemConfig.directory.implementation` introduced a public nested shape named `DirectoryConfig`, but the package entrypoint already exported a different `DirectoryConfig` from the distributed directory. When extending a nested public config, export an unambiguous alias such as `ActorSystemDirectoryConfig` beside the parent config so consumers can type the nested option without importing internals or colliding with existing names.

- **New user-supplied async hooks in message delivery must be caught at the caller boundary that owns dead-letter reporting.** A router hook that rejects can otherwise escape fire-and-forget sends before the runtime records a dead letter. When adding hook seams to delivery paths, add an error-path test that proves hook failures are represented as runtime facts rather than unhandled rejections.

## PR #40 — labs mesh implementation babysit (2026-07-06, single-agent)

- **Optional-clock semantics in deterministic cores need wrapper-level coverage.** `resolveMeshDirectoryLocation` correctly accepted `now`, but `LabsMesh.resolveDirectoryLocation` did not pass one, so TTL expiry was unreachable through the shell API. When a pure helper accepts an injected clock or timestamp, test the public wrapper that composes it, not only the pure helper.

## PR #41 — labs mesh route-token relay babysit (2026-07-06, single-agent)

- **Negative async delivery assertions must observe the side effect that must not happen.** A state value that starts at the expected value can pass immediately and miss a late relay. For fail-closed relay guarantees, capture the outbound transport or effect journal and assert the forbidden send/effect is absent after the failure fact is observed.

- **CodeRabbit closeout needs the completed review body, not only a green or skipped check.** When automatic incremental reviews are disabled or only a status check is visible, post an explicit `@coderabbitai review` and read the follow-up result before closing babysit.

## PR #42 — BroadcastChannel transport babysit (2026-07-06, single-agent)

- **Shared-bus transports must validate full negotiated identity at every ingress, not just node address.** BroadcastChannel delivery is many-to-many, so a restarted or spoofed participant can reuse the same `nodeAddress`. Validate payload source against envelope source during handshake and filter peer payloads by the negotiated `RuntimeNodeIdentity` before handing frames to the core, with regression tests for stale same-address frames.

- **User observer hooks on handshake paths must be contained effects.** Telemetry observers run inside connection completion paths; if they throw, they can turn an otherwise valid handshake into a timeout or rejected listener path. Adapter-level telemetry emitters should catch observer failures and route them to the configured listener/error port without changing handshake facts.

## PR #43 — topology source API babysit (2026-07-07, single-agent)

- **Source registries that own cleanup must deregister sources on manual close.** If a client tracks opened sources for bulk cleanup, every source factory should wrap `close()` so manually closed sources remove themselves from the registry before delegating. Add a regression test that manually closes one source and then closes the owner, asserting the already closed source is not closed again.

- **Session builders must unwind partially created resources when later setup fails.** When constructing paired read/command sources, create the read side first only if a failure while creating commands closes that read side before rethrowing. Add a failure-path test that makes the second factory throw and verifies the first resource is closed.

- **Tests for paired read/command sources should identify handles by behavior, not creation order.** A positional socket counter can keep passing if read/command wiring swaps. Use emitted gateway frames or handle-specific effects to bind assertions to the actual read-model and command-only sources.

## PR #44 — WebRTC transport babysit (2026-07-07, single-agent)

- **Handshake waits in transport adapters must observe close/error as first-class outcomes, not only timeout.** WebRTC data channels can close or error after setup begins but before the auth handshake completes. Handshake helpers should subscribe to `close` and `error`, remove those listeners on completion, and return or resolve failure facts immediately instead of waiting for a timer.

- **User-supplied auth hooks in transport handshakes must be contained at the adapter boundary.** Token providers and verifiers are imperative ports; if they throw during dial/listen, the adapter should close the opened channel and report a failed connection/auth fact instead of letting the exception escape and leave half-open resources.

- **PeerLink `receive()` implementations must be idempotent.** If the public contract allows repeated `receive()` calls, a new sink registration must detach the prior listener and `close()` must detach whichever listener is currently active, or repeated consumers can orphan message handlers.

- **Browser transport fakes should model async delivery and teardown.** Synchronous fake `send()`/`close()` behavior can hide races in DataChannel-like adapters. Prefer microtask-delivered messages and a `closing` -> `closed` transition so tests exercise production-like ordering.

## PR #45 — Mesh Pong example babysit (2026-07-07, single-agent)

- **Multi-node example starters must unwind partial startup on every failure boundary.** If an example starts several actor-web nodes before connecting or flushing them, track each started handle immediately and stop all started handles when any later start/connect/flush step fails. Add a failure-path test that forces the second or later resource to throw and verifies no transport/channel handles remain registered.

- **Actor contexts should not duplicate state owned by a subscribed actor.** If one actor owns a projection such as score totals, upstream events should carry facts or signals and let the projection actor derive its own state. Avoid putting copied projection state in another actor's context unless there is a tested reconciliation protocol for independent resets.

- **Collision and boundary tests should assert transitions, not only final positions.** A paddle or boundary response should prove the entity crossed the interaction plane during the current tick. Tests should cover the already-past-plane case so late or stale state cannot still trigger a bounce.

- **Async UI mode switches need generation guards before every visible state write.** Guard the "starting" state and labels as well as final success/error application after awaited teardown. Otherwise an abandoned request can leave visible mode/proof/status text inconsistent with the runtime that actually won the race.

## PR #46 — Mesh Pong player modes batch babysit (2026-07-08, single-agent)

- **Browser examples must treat `VITE_` variables as public bundle inputs.** Do not read bearer tokens or API keys from browser `import.meta.env`, even for local demos. If an example endpoint needs auth, keep the secret behind a local server/proxy boundary and document that the browser surface only carries non-secret configuration.

- **Timeout coverage needs to cross the actual actor/tool boundary.** A helper-level `AbortSignal` test does not prove that an actor behavior forwards deadlines into `tools.execute`. When controller/advisory logic depends on a deadline, add a regression through the actor behavior or toolbox call that proves the underlying provider signal is aborted.

- **Documented telemetry counters need a live emission path.** Reducer-only tests can make a metric look supported while no runtime path emits the event. For scheduling metrics such as held/dropped/applied turns, add a harness test that forces the runtime condition and observes the emitted event.

- **Rejected commands against active actor state should prove non-mutation.** For malformed or rejected commands on actors that can already be in a started/running state, assert the full pre-rejection context remains unchanged so stale or stray commands cannot stop live work.

## PR #54 — authenticated command admission babysit (2026-07-29, 6-agent)

- **An authoritative fact callback cannot be an optional observer.** If dispatch depends on an admission or authorization fact becoming durable, require the sink on the opted-in path, await it before dispatch, and fail closed when it is missing or throws. Add tests for sink failure before dispatch and sanitize callback exceptions instead of echoing adapter details.

- **Idempotency claims need explicit settlement, not a one-way availability check.** Model at least `not_dispatched`, `dispatch_succeeded`, and `dispatch_indeterminate`; test sink failure, dispatch failure, and settlement failure after an irreversible effect. A post-dispatch settlement failure must not retry the effect or attempt a contradictory second settlement.

- **Admission reviews must trace every production wrapper, not only the lower-level seam.** A correct gateway or host helper is still bypassable when `serveNode` or the shipped CLI cannot configure it. Verify the supported served-node and CLI entry points with focused tests and a real CLI invocation.

- **Generic auth context must survive wrapper layers without placeholder substitution.** If the core gateway passes verified context to scope and principal resolvers, public wrappers must preserve the same generic type and live value. Add a regression proving both hooks observe the same non-empty verified context.

- **Fallback identity generation must be shared by failure paths too.** A collision-resistant helper in the normal admission contract is insufficient if pre-helper fail-closed branches mint timestamp-only IDs. Reuse one generator and test two same-tick rejections for distinct durable join keys.

- **Pre-auth context must be explicitly absent, never fabricated through a type cast.** Carry `undefined` through wrapper and gateway seams until authentication produces verified context. A regression test should map absent context to an explicit untrusted principal, reject it, and prove the actor did not execute; do not normalize anonymous input as `kind: 'authenticated'`.

- **Fail-closed receipts must not overstate completed admission work.** Gateway-local configuration and resolver failures happen before contract admission checks, so their stage, principal trust, and `rechecked` set must report only what actually occurred. Use an explicit `unknown` principal, a pre-authorization stage, and an empty or otherwise exact recheck set; contain and sanitize resolver exceptions with a distinct reason code.

- **Failure telemetry must preserve both operability and redaction.** Swallowing a durable sink exception leaves operators blind, but logging the raw throwable can leak the same credentials removed from client receipts. Emit a fixed local message with coarse safe classification and stable operation/failure codes, then test both that the signal exists and that thrown details appear in neither logs nor client output.

## PR #55 — durable agent-session checkpoint babysit (2026-07-29, 6-agent)

- **Opaque continuation presence does not prove resumability.** Rehydration must fail closed unless the active adapter explicitly supports the checkpoint's exact provider, adapter, and format version. Metadata-only continuation records are evidence of redaction, never resumable payloads, even when a top-level redaction list is empty.

- **Filesystem checkpoint keys must be bound to parsed envelope identity.** A filename derived from session A must not return a valid envelope for session B. Canonicalize storage directories before process-local locking, reject unencodable identifiers as durable failure outcomes, enforce size limits before allocation with a post-read backstop, and create checkpoint files with owner-only permissions.

- **Durable loop snapshots must include behavior-affecting configuration.** Message-specific system instructions alter subsequent provider requests and therefore belong in the checkpoint projection. A restart test should capture a message override, rehydrate without reconstructing options, and prove the next provider call retains that instruction.

- **Time-sensitive conformance fixtures need non-expiring defaults and injected clocks.** Fixed near-future expiry dates turn green fixtures red as wall time advances. Keep representative cross-repo fixtures non-expiring, and prove expiry separately with an injected clock at the public store boundary.

- **Shared outcome taxonomies need one canonical classifier across adapters.** Treat `present`, `redacted`, `stale`, and `expired` envelope-bearing outcomes as one duplicate semantic with a single internal classifier, so in-memory and durable paths cannot drift on precedence or fallback fields. Durable adapters should own only IO-specific concerns: single-open bounded reads capped at `maxBytes + 1`, plus the existing missing, too-large, and filesystem-failure handling before delegating loaded-envelope classification to the shared helper and pinning parity coverage there.

## PR #56 — recoverable distributed CLI hosting babysit (2026-07-30, 6-agent)

- **Checkpoint bootstrap caches must not outlive an actor incarnation.** Supervision can recreate behavior closures while preserving or replacing durable state independently. Re-read the authoritative checkpoint for each checkpointed turn, and give partial tool-result progress a distinct durable checkpoint/effect identity so restart cannot repeat an irreversible tool call.

- **A reconciliation gate needs both a fail-closed block and an explicit receipt-backed exit.** Distinguish pre-dispatch checkpoint failure from post-dispatch indeterminacy, and require an authoritative reconciliation receipt before clearing the gate. Catch a final receipt-checkpoint failure locally so it cannot be misclassified by a broader post-dispatch catch, and keep envelope construction inside the structured durability-error path. A reconciled applied effect must resume without replaying that effect.

- **Resumable trace transport requires matching client and server contracts.** Preserve the replay owner, connection identity, cursor, and next sequence on reconnect; persist trace-only frames; honor subscribe-time `fromSequence`; and accept a newer latest-frame fallback when bounded history cannot satisfy the requested cursor. Also distinguish successful durable replay from a non-durable gateway restart whose authoritative sequence begins again at one, close the active socket when async auth resolution fails so retry can start, and use capped reconnect backoff that resets only after authoritative readiness. Treat an isolated malformed frame as recoverable when later valid readiness/projection frames can safely complete the pending operation.

- **Advisory observers must not change authoritative outcomes.** Contain trace-listener exceptions outside dispatch and settlement, rebuild published receipt payloads from an explicit field allowlist so unknown extensions cannot bypass redaction, preserve authoritative join keys, clamp trace buffers to a positive bound, keep overflow markers transient so they do not evict real retained projections, and sanitize provider exception text before it becomes a broadcast or durable trace fact.

- **Public-entrypoint boundary tests must inspect executable entrypoints too.** Checking only library helpers misses deep source imports in CLI binaries that work in a monorepo but fail in the published package. Include the shipped CLI source in the boundary assertion and import node-only adapters from the public node entrypoint.

## PR #57 — Week 1 learning product babysit (2026-08-01, supplemental learning)

- **Executable teaching listings must be able to reach every narrated phase.** Awaiting a parked enqueue inline prevents later producers and consumer progress from ever appearing, while an uncaught fail policy stops at the first rejection. For backpressure lessons, start concurrent enqueue attempts before opening capacity, catch expected per-attempt failures, and keep code-to-phase mappings under executable verification.

- **Learning claims must trace the exact runtime counter, including failure paths.** A nominal batch limit may count only successful deliveries, so error-heavy resumed workloads can exceed the stated bound. Qualify documentation and fixtures to the counter that production code actually advances, and create separate runtime work if attempted-delivery fairness should change.

- **DOM test execution needs an explicit trust and process boundary.** Keep static page validation on the default no-evaluation path, use a security-fixed DOM implementation, enable JavaScript only for the interactive page that needs it, and run that evaluation in a child process so page code cannot mutate the verifier's isolate.

- **Static link validators must model deployed URL semantics before filesystem resolution.** Strip query strings and fragments, decode percent-encoded paths with a fail-closed error path, classify every URI scheme and protocol-relative URL as non-local, and resolve root-relative links through the deployed site base instead of the current file's directory.

- **Document-structure checks should prove containment, not count matching fragments.** Parse the page, locate the intended section heading, and assert that each lower-level card heading is inside that section so unrelated markup cannot satisfy the hierarchy contract.

- **Isolated verifier failures must preserve process-launch diagnostics.** When a child process cannot start, report the spawn error alongside its signal and captured output; otherwise infrastructure failures look like silent assertion failures inside the child.

- **Publication maturity requires deployed-route evidence, not a green build.** Keep unreleased learning surfaces labeled candidate with local artifact paths; promote them to available only after the main-branch deployment succeeds and every canonical route returns the expected success status.

- **Architecture decision summaries must carry maturity labels for unshipped guarantees.** A concise rationale table can accidentally turn an accepted target into a present-tense runtime promise; prefix candidate, accepted-target, and deferred decisions explicitly wherever readers may encounter them without the surrounding maturity matrix.

- **Recovery guidance must keep receipt status separate from rehydration outcome.** `timeout` and `partial_failure` can remain non-terminal execution facts, while an unknown post-call result maps checkpoint recovery to `deferred_for_reconciliation`; block automatic retry until an authoritative reconciliation receipt records the outcome.
