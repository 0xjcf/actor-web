# Persistent PR Feedback Memory

Reusable lessons from PR review. Each entry is a pattern the pipeline should catch earlier next time — not task-specific detail.

## PR #31 — opaque actor addresses / one canonical factory (2026-06-20, 6-agent)

- **"Centralize minting in one factory" tasks must grep for ALL inline mint sites, not just the named ones.** The plan named three consolidation sites (spawn, topology, guardian), but two more inline address literals survived review and shipped: `create-actor-ref.ts` (`XStateActorRef.address`) and `capability-security.ts` (mock fallback), both hand-building non-canonical `/actors/<id>` paths with no `node`. CodeRabbit flagged the first; the second was found only by a follow-up grep. Pipeline fix: for any "single source / one factory" task, the implementer and QA should grep the whole package for address-shaped object literals (`{ id, kind, … path:` and `path: \`actor://…\`` / `path: \`/…${`) and assert none bypass the factory.

- **Round-trip + path-discriminator contracts need adversarial edge tests.** The canonical-address round-trip (mint → `parseActorPath` → equal) had an untested hole: an actor id starting with `callback/` parses back as `kind:'callback'`. When a parser uses a path segment as a discriminator, add a test for ids that collide with that discriminator, and reserve the prefix as a value-object precondition in the factory.

- **A serialized-format change ripples into test fixtures asserting the old format.** Canonicalizing the address path broke a `sourceActor: '/actors/…'` expectation in `runtime-gateway.test.ts`. When changing any serialized format, grep the test surface for the old literal and update the assertions in the same change (and treat such a break as the change's own test coverage, not a regression).

- **The CodeRabbit-CLI-before-`fas done` gate was skipped by the autonomous 6-agent flow (2nd occurrence after P2).** Reviewer → `verify --full` → `fas done` → push ran with no CLI step, so the bot left 5 post-closeout threads. The gate depends on a manual orchestrator step the runtime does not perform. Recommendation: wire a CodeRabbit pass into the FAS reviewer/closeout gate (platform repo) so `fas done` blocks on it; until then the orchestrator must run `coderabbit review --base main` before allowing closeout on every task.
