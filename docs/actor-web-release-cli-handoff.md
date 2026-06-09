# Handoff: actor-web first npm release + cli fix + cross-repo decoupling adoption

Paste the **Prompt** section into a fresh session in
`/Users/joseflores/Development/actor-web`. It is self-contained; the new session
has no access to the prior conversation.

---

## Prompt

You are continuing work on **actor-web** (a pure actor-model runtime for TS,
OTP/XState/Akka-inspired), a pnpm monorepo with three packages:
`@actor-web/runtime` (packages/actor-core-runtime), `@actor-web/testing`
(packages/actor-core-testing), `@actor-web/cli` (packages/agent-workflow-cli).
Owner/org: GitHub `0xjcf`, npm scope `@actor-web` (org exists, owned by the user).

### Read first (orientation)

1. `docs/actor-web-decoupling-design.md` — the cross-repo decoupling architecture
   (neutral contracts, inverted deps). **The actor-web side is DONE**; the FAS /
   ignite-element / fas-studio sides are pending in their own repos.
2. `docs/actor-web-actor-dx-design.md` — the locked DX (defineBehavior, no-build,
   startRuntime/serveNode).
3. `.fas/memory/incidents.md` and `.fas/memory/decisions.md`.
4. `git log --oneline -30` on `main`.
5. The sibling repo `../ignite-element` (owner `0xjcf`) — the **reference** for
   release tooling (Changesets, `scripts/verify-exports.mjs`, `scripts/release-beta.mjs`,
   dual ESM/CJS exports). actor-web's release setup mirrors it.

### What is DONE and on `main` (pushed to origin/main)

A large prior session completed, in order:

- **DX naming/ergonomics**: `defineActor`→`defineBehavior` (optional `.build()`),
  `startActorWebLocalRuntime`→`startRuntime`, `serveActorWebNode`→`serveNode`,
  removed no-op `return { context }`. (`defineActorWebTopology`/`defineActorWebApp`
  unchanged.)
- **Decoupling — actor-web side COMPLETE** (each merged + `verify.sh --full` green):
  - *Seam B*: deleted `integration/fas-shared-contracts.ts` + the
    `@franchise/shared-contracts` dependency → broke the actor-web↔FAS package
    **cycle**; consolidated onto the neutral projection module.
  - *Seam A*: `Ignite*`→`Actor*` source API; renamed
    `integration/ignite-element-bridge.ts`→`integration/actor-source.ts`;
    neutralized all `ignite` prose. actor-web references **neither Ignite nor FAS**.
  - *Projection neutralization*: `runtime-gateway-projection.ts`→`runtime-projection.ts`;
    dropped workflow/task fields (`workflowId`/`taskId`/`taskTitle`/`branchName`/…),
    `phase`→`stateLabel`, `workflowSnapshot`→`snapshot`. Producers (gateway,
    serve-node, actor-system-impl) synthesized those fields from the actor
    address and nothing read them, so behavior is unchanged.
- **ESM consumer fix**: `actor-system-guardian.ts` extensionless relative imports
  → `.js`; added biome `useImportExtensions` rule scoped via `overrides` to
  `packages/actor-core-runtime/src`. (Reported by a fas-studio session: Node ESM
  consumers couldn't resolve `./actor-system`.)
- **CJS/ESM build correctness**: set `emitDeclarationOnly: true` on the runtime +
  testing tsconfigs so `tsc --build` (typecheck) only emits `.d.ts` and never
  leaves a CJS-less dist; `clean` now also removes `*.tsbuildinfo` (else
  incremental `tsc` skipped `.d.ts` and `prepublishOnly` would have shipped
  packages with no types).
- **Release prep (mirrors ignite-element)**: added `@changesets/cli` +
  `.changeset/config.json` (fixed group `[@actor-web/runtime, @actor-web/testing]`,
  `access: public`, `baseBranch: main`, `ignore: [@actor-web/cli]`); root scripts
  `changeset`/`version`/`release` (`pnpm build && changeset publish`);
  `scripts/verify-exports.mjs` (asserts every `exports`/`main`/`module`/`types`
  file exists in dist + ESM/CJS load) wired into runtime/testing `build`;
  per-package `repository`/`homepage`/`bugs`/`publishConfig {access:public}`/`files`
  (`[dist,README,LICENSE,CHANGELOG]`, dropped `src`); `LICENSE` + `CHANGELOG.md`
  files; fixed a `@actor-web/testing` manifest bug (`main` pointed at the ESM
  file, `module` at a non-existent `.mjs`). **`@actor-web/cli` is `private: true`**
  (held out of the first publish).
- **Cross-repo follow-ups filed** as `[decouple]`-tagged tasks in `../fas` and
  `../ignite-element` queues, plus fas-studio rename + ESM chips. (`../fas-studio`,
  `../ignite-element`, `../fas` are sibling repos under `/Users/joseflores/Development`.)

### Workflow + conventions (IMPORTANT — these will bite you otherwise)

- **`main` is PR-protected** (GitHub: "changes must be made through a pull
  request"). Do **not** push to `main`. Work on `fas/`-prefixed branches, push the
  branch, open a PR with `gh` (authed as `0xjcf`), let the user merge. `gh pr
  create` works.
- **No `Co-Authored-By` trailer** in commit messages (user preference).
- Shell is **zsh**: use `while IFS= read -r f` for multi-file loops; use `perl -i
  -pe` with negative lookahead for safe renames (e.g.
  `s/defineActor(?!Web)/defineBehavior/g`).
- **biome**: `pnpm exec biome check --write .` applies `organizeImports` (renames
  re-sort imports) + format. JSON files written by scripts need
  `biome format --write`.
- **Build model**: `pnpm build` = `tsup --format cjs,esm` (JS) + `tsc
  --emitDeclarationOnly` (types) + `verify-exports`. `pnpm typecheck` = `tsc
  --build` (emits only `.d.ts`). `pnpm clean` removes `dist` + `*.tsbuildinfo`.
  After `rm -rf dist` always run a full `pnpm build` (or `pnpm clean && pnpm
  build`) before a consumer/link uses the dist — `tsc`/typecheck alone do NOT
  produce a runnable dist. `prepublishOnly` = `pnpm clean && pnpm build`.
- **Verify**: `pnpm typecheck`, `pnpm --filter @actor-web/runtime test`, `pnpm run
  test:docs` (VitePress twoslash gate), `.fas/scripts/verify.sh --full`.
- **FAS pipeline** (CLAUDE.md mandates it): `fas implement "<title>"` → edit →
  `fas validate-task` → `fas batch snapshot`; final `verify.sh --full` + `fas
  batch close`. **Known platform limitation**: closeout/`fas done` HOLDs on
  plan-alignment (`[NO_UNPLANNED_SOURCE_FILES]`) when a change touches more files
  than the planner guessed — this is filed, NOT a verification failure; do not
  hand-edit `.fas` runtime state to force it. For broad changes, rely on
  `verify.sh --full` being green and merge via PR.
- To mark a queue task done: `fas queue complete <id> --workflow-id <id>
  --branch-name main`.

### The work to do, prioritized by cross-repo impact

**Keystone (user's manual step): publish `0.1.0`.** This is the single highest
cross-repo unblocker — it lets `../fas`, `../ignite-element`, `../fas-studio`
drop their local `file:` deps for `@actor-web/runtime@^0.1.0`. The user runs:
`git push` (their branch/PR), then `npm login` (as @actor-web owner), then `pnpm
release` (builds + `changeset publish` → runtime+testing at `0.1.0`, `latest`
tag, public; cli skipped because private). First publish must be plain `0.1.0`
(not a `-beta` prerelease) so it gets the `latest` tag — betas only work once a
stable `latest` exists (this is why ignite-element can ship `3.0.0-beta.3`). You
(the agent) generally cannot run `npm publish`; prep and verify with `npm pack
--dry-run`, and leave the publish to the user.

**1. Fix `@actor-web/cli` (41 pre-existing failing tests; impl is fine, tests are
stale).** Then remove `private: true`, add cli to the changeset `fixed` group,
align its version (`0.1.0-alpha`→`0.1.0`), and it can join a later release. Run
`pnpm --filter @actor-web/cli test`. Three clusters:
   - **`src/actors/git-actor.test.ts` (29)** — `gitActor.start/.stop/.send/.getSnapshot
     is not a function`. `createGitActor(baseDir)` returns a **behavior**
     (`defineBehavior()…`); the real CLI (`src/core/cli-actor-system.ts`)
     correctly does `system.spawn(createGitActor())` → `ActorRef`. The tests are
     stale (old class-actor API). Rewrite them to spawn the behavior via
     `createActorSystem` and assert the `ActorRef` (or test
     `cliSystem.createGitActor()` which returns an `ActorRef`).
   - **`src/integration/cli-commands.test.ts` (7)** — `ReferenceError: log is not
     defined` (test bug: `log.debug` used without importing/defining `log`) +
     `Command failed: npx tsx …/cli/index.ts --version|--help` (the CLI entry
     fails to run via tsx — investigate ESM in `src/cli/index.ts`; likely a
     `require`-in-ESM or extensionless-import issue).
   - **`src/commands/ship.test.ts` (5)** — "Loop Detection" state-machine
     transition tests; investigate.
   Do this on a `fas/fix-cli-tests` branch + PR. Keep `verify.sh --full` green.

**2. Docs (actor-web-local, low cross-repo).** The queue has: "Docs: ignite-element
   integration surface" and "Docs: headless agent runtime page + refresh ignite
   guide" — both still describe the old `Ignite*` API and must be updated to the
   neutral `Actor*` source API (`ActorReadModelSource`/`ActorCommandSource`/
   `ActorSource`, `integration/actor-source.ts`). Also "Docs D6: deploy site
   (GitHub Pages) + versioning/llms-txt". The VitePress twoslash gate (`pnpm run
   test:docs`) type-checks every ```ts twoslash``` fence.

**3. Cross-repo `[decouple]` adoption (in the sibling repos, after publish).**
   See `docs/actor-web-decoupling-design.md` §"Per-repo task breakdown":
   - `../fas`: move `@actor-core/runtime`→`@actor-web/runtime` as an
     `optionalDependency`/`peerDependency` (its `src/runtime/actor-web/fas-task-bridge.ts`
     already lazy-resolves it); rewrite the bridge to map actor-web's **neutral**
     projections/events ↔ `@franchise/shared-contracts`. Tagged `[decouple]` in
     `../fas`'s queue.
   - `../ignite-element`: keep its `@ignite-element/adapters` `ActorWebAdapter` as
     the seam owner; optionally consume actor-web's neutral source types as an
     optional peerDep in the adapters package only (never ignite-core). Tagged
     `[decouple]` in `../ignite-element`'s queue.
   - `../fas-studio`: update imports (it consumes all three). Has rename + ESM
     chips already.

**4. Optional**: dismiss the marginal "Add batch `subscribers[]` overload" queue
   task; consider a **Changesets GitHub Action** so releases happen via a
   "Version Packages" PR + CI publish instead of a local bypass-push (the proper
   pattern for a PR-protected repo).

### Suggested first move

Open a `fas/fix-cli-tests` branch and fix cli cluster-by-cluster (quick wins
first: the `log is not defined` test bug and the CLI `tsx --version/--help` ESM
failure; then modernize the 29 git-actor tests to the spawn-based contract; then
ship.test). Then unprivate cli, add it to the fixed group, and it can ride a
later release. Open a PR with `gh`. Meanwhile the user can publish runtime+testing
`0.1.0` independently — cli does not block it.
