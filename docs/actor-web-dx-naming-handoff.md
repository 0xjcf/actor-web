# Handoff: actor-web DX naming + ergonomics polish

Paste the **Prompt** section below into a fresh session in the actor-web repo root. Everything the new session needs is here; it does **not** have access to the prior conversation.

FAS is retired in this repo. Ignore any older copy of this handoff that says to run `fas` commands or read `.fas/`. Track work on the operator console in the sibling agent-starter repo at `apps/board`. Verify with `pnpm typecheck`, `pnpm --filter @actor-web/runtime test`, `pnpm run test:docs`, and `pnpm architecture:check`.

---

## Prompt

You are continuing work on **actor-web** (a pure actor-model runtime for TS, OTP/XState/Akka-inspired). A long prior session implemented the "minimal-boilerplate actor DX" design and a docs site. This task is a **DX naming + ergonomics polish pass** on the public API, plus finishing gaps. Track the work on the operator console in the sibling agent-starter repo at `apps/board`. Do not use FAS.

### Read first (orientation)

1. `docs/actor-web-actor-dx-design.md` — the locked design (machine-as-behavior, `emit`→`subscribe`, declarative `subscriptions`, command `send` helper, hybrid event bridge, agent runtime). This is the source of truth for the DX.
2. `docs/actor-web-declarative-subscriptions-design.md` and `docs/actor-web-documentation-plan.md` — adjacent design docs.
3. `architecture.boundaries.json` and `AGENTS.md` — boundary map and current working rules.
4. `git log --oneline -30` on `main` — recent landed work.

### What's already DONE and on `main`

- **A1** no-handler `build()` defaults (machine/FSM is the behavior; `ask` resolves snapshot).
- **A2** XState machine `emit()` bridged to the subscribe stream (`machine-actor.ts`).
- **T2** declarative `subscriptions: [{ from, to[], events[] }]` in `defineActorWebTopology` (`topology.ts` + `actor-web-client.ts`).
- **T3** subscription `from`/`to`/`events` type-checked against actors + the publisher's emitted union.
- **T4** EventBrokerActor deleted; AutoPublishingRegistry canonical.
- **A3** plain-value behaviors verified in `actor()`.
- **Docs site** (VitePress, `docs/site/`) with twoslash typecheck + WCAG AA contrast guardrail (`docs/site/scripts/check-contrast.mjs`).
- **Package scope renamed** `@actor-core/* + @agent-workflow/cli → @actor-web/*` (runtime, testing, cli). Package **directory** names are unchanged (`packages/actor-core-runtime`, etc.) — only the npm `name`/imports changed. Nothing is published yet (all `0.1.0`).

### The changes to make (this task)

All are **breaking renames/ergonomics on a pre-1.0, unpublished API → do clean renames, no back-compat aliases** unless you find a strong reason. Update every usage across `packages/`, `examples/`, `docs/`, tsconfig path mappings, root `package.json` scripts, and CI. Cross-repo consumers (`../fas-studio`, `../ignite-element`) update in their own repos — leave follow-up notes, don't edit them here.

1. **`defineActor` → `defineBehavior`.** What this builder produces is the *behavior* passed to `actor({ behavior: defineBehavior()... })`; calling it `defineActor` is confusing next to `actor(...)`. Rename the export, the `UnifiedActorBuilder` factory, all imports, and all docs/examples. (Keep `defineFSM` as-is.)

2. **Make `.build()` optional.** A behavior builder should be usable directly: `actor({ behavior: defineBehavior().withMachine(m) })` with no trailing `.build()`. The runtime should auto-build under the hood.
   - `actor-system-impl.ts` spawn ALREADY detects a builder: `if ('build' in behaviorOrBuilder && typeof behaviorOrBuilder.build === 'function')`. But the **topology path does not**: `materializeActorWebBehavior` in `actor-web-node-runtime.ts` does `typeof behavior === 'function' ? behavior(params) : behavior` — a builder is an object, so it's passed un-built and fails (no `onMessage`).
   - Fix: in `materializeActorWebBehavior` (and any factory-resolution path), detect a builder (`'build' in resolved && typeof resolved.build === 'function'`) and call `.build()`. Keep supporting: built value, zero/one-arg factory, **and** builder. `.build()` stays available (explicit) but optional.
   - Verify the typed-behavior helpers in `topology.ts` (`ActorWebBehaviorContext/Message/Event`) still infer correctly when `behavior` is an un-built builder (the builder carries `__contextType`/`__messageType` phantoms — confirm or extend).

3. **`startActorWebLocalRuntime(topology)` → `startRuntime(topology)`** and **`serveActorWebNode(topology, { node })` → `serveNode(topology, { node })`.** Shorter, cleaner entry points. Rename exports + all usages + docs. (Check the `/node` entry for `serveActorWebNode` and `actor-web-client.ts` for the local runtime.)

4. **Remove redundant `context` returns.** Returning `context` from a handler *replaces* state; you only need to return it when you **change** it. There are places (examples, docs, possibly behaviors) that `return { context }` with the unchanged context — drop those (return `{}`, or just `reply`/`emit`). `onTransition` examples already model the correct pattern. Audit `examples/`, `docs/site/`, and `packages/**` handlers; don't change semantics (only remove no-op context returns where the value is provably identical to the input context).

5. **Docs package-name + API audit.** Confirm **no** remaining `@actor-core` / `@agent-workflow` references anywhere (code, docs site, design docs, READMEs, workflows): `grep -rn "@actor-core/\|@agent-workflow/cli" . --include="*.ts" --include="*.md" --include="*.json" --include="*.mjs" --include="*.yml" | grep -vE "node_modules|/dist/"`. Then update all docs/examples for the new `defineBehavior` / `startRuntime` / `serveNode` names and the no-`.build()` style. The docs site has a twoslash gate (`pnpm run test:docs`) that type-checks every ` ```ts twoslash ` fence against the real types — it will catch stale API in docs.

### Gaps / things to also handle

- **Cross-repo follow-ups**: after these renames, `../fas-studio` (`src/runtime/{topology,behaviors,tools}.ts`) and `../ignite-element` use the old names + `@actor-core`. File follow-up tasks (or `spawn_task`) for each repo; do not edit them from here.
- **Two follow-ups already filed** (chips): FAS closeout 80-file cap fix (FAS repo), and `@actor-web/cli` 41 pre-existing failing tests (not in test lane). Don't duplicate.
- **Remaining actor-web queue** (after this): "Stabilize Ignite source contract" (high — should publish `@actor-web/runtime`), "Docs D6 deploy", "Docs agent-runtime page" (waits on ignite-element `send`/event-bridge work), "T1 batch subscribers[] overload" (marginal — candidate to dismiss).

### How to work

- Branch off `main`. `main` is the up-to-date trunk; consolidate finished work back with `git merge --ff-only` and delete the branch.
- Put each rename on the operator console in agent-starter `apps/board` and keep one purpose per change.
- **Lessons that will bite you otherwise:**
  - The shell is **zsh** — `for f in $files` does NOT word-split; use `while IFS= read -r f` loops for multi-file seds.
  - Run **`pnpm format:md`** before commit when markdownlint reports MD022/MD032. MD024 dup-heading needs manual dedupe.
  - These naming renames are large, so **consider splitting** (e.g. `defineBehavior` rename as one task, the runtime-entry renames as another, the context-return cleanup as a third). This also keeps reviews focused.
  - Biome lints scripts too (`noParameterAssign` etc.) — run `pnpm exec biome check .` locally.
- Verification commands: `pnpm typecheck`, `pnpm --filter @actor-web/runtime test`, `pnpm run test:docs` (docs twoslash), `pnpm architecture:check`.

### Suggested sequencing (each its own task/commit-set, all batched, one final full verify + batch close)

1. `defineActor → defineBehavior` (+ optional `.build()` wiring in `materializeActorWebBehavior`).
2. `startActorWebLocalRuntime → startRuntime`, `serveActorWebNode → serveNode`.
3. Remove redundant `context` returns + docs API/package-name audit.

Each: update docs in the same task. Then run the verification commands above. Then `git checkout main && git merge --ff-only <branch>`. File cross-repo follow-ups for fas-studio + ignite-element. Update `docs/actor-web-actor-dx-design.md` to reflect the new names (`defineBehavior`, no-`.build()`, `startRuntime`, `serveNode`).
