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
