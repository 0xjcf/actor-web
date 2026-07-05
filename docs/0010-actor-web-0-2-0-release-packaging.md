# ADR: Actor-Web 0.2.0 Release Packaging

## Status

Accepted

## Context

Actor-Web 0.1.0 is published on npm as two scoped packages:

- `@actor-web/runtime@0.1.0`
- `@actor-web/testing@0.1.0`

The 0.2.0 release expands the public surface to include the agent and lattice
packages that are now part of the release DAG:

- `@actor-web/agent`
- `@actor-web/lattice`

The release-prep task also required a facade decision: whether to publish an
unscoped `actor-web` package as the public API facade while keeping scoped
packages as internal implementation details.

Live npm registry evidence on 2026-07-04:

- `actor-web` exists at `0.0.0`, is maintained by `sd166 <admin@igng.ru>`, and
  points at `github.com/actorapp/ActorSDK-Web.git`.
- `@actor-web/runtime` and `@actor-web/testing` are published at `0.1.0`.
- `@actor-web/agent` and `@actor-web/lattice` are not yet published.

Because package ownership is part of the product contract, Actor-Web must not
ship an unscoped facade under a package name owned by another maintainer.

## Decision

Actor-Web 0.2.0 ships only the scoped `@actor-web/*` packages.

Package disposition:

| Package | 0.2.0 disposition |
| --- | --- |
| `@actor-web/runtime` | Publish as the core runtime package |
| `@actor-web/testing` | Publish in the fixed runtime/testing release group |
| `@actor-web/agent` | First public publish |
| `@actor-web/lattice` | First public publish |
| `@actor-web/cli` | Keep private and ignored by Changesets |
| `actor-web` | Do not publish in 0.2.0 |

The public API story for 0.2.0 is package-specific:

- Runtime and topology primitives come from `@actor-web/runtime`.
- Runtime-hosted agent utilities come from `@actor-web/agent`.
- Artifact dependency coordination comes from `@actor-web/lattice`.
- Test helpers come from `@actor-web/testing`.

`@actor-web/agent` does not introduce an alternative behavior authoring idiom.
Its `createAgentLoopBehavior()` factory returns a normal Actor-Web behavior
built through `defineBehavior()`. Public docs should show custom behavior
through `defineBehavior()` and package-provided behavior through
`actor({ behavior: createAgentLoopBehavior(...) })`, not direct
`behavior.onMessage(...)` invocation.

`@actor-web/lattice` remains a separate optional package. The current public
surface is `lattice(...)`, `dependsOn(...)`, `wireLatticeRuntime(...)`, and the
artifact/dependency protocol types. Future `observe`/`artifact(...)` syntax is a
follow-up design layer, not part of this release.

## Release Notes

The 0.2.0 changesets must cover:

- First public publish of `@actor-web/agent`.
- First public publish of `@actor-web/lattice`.
- Runtime/testing fixed-group release beyond `0.1.0`.
- Restart-bound behavior now permanently stops crash-looping actors after the
  declared restart budget.
- Removal of unsupported `SendInstruction` retry/guaranteed delivery modes.
- Narrowed `SpawnOptions`.
- Branded string actor addresses and the actor address wire-format changes.
- Backpressured runtime transport stream host.

## Release Execution

This ADR does not publish packages. It records the package surface and facade
decision for the terminal release-prep task.

The inert release-readiness commands are:

```bash
pnpm changeset status
pnpm build
pnpm -r publish --dry-run --no-git-checks
```

Use `npm pack --dry-run` for individual tarball previews. Do not use
`changeset publish --dry-run`.

Real publish remains an operator action after npm authentication:

```bash
pnpm changeset version
pnpm install
pnpm build
pnpm -r publish --dry-run --no-git-checks
pnpm release
git push --follow-tags
```

## Consequences

- Ignite and other downstream consumers should depend on scoped packages for
  0.2.0.
- No unscoped facade package is created or added to the Changesets fixed group.
- The `actor-web` npm name can be reconsidered only if package ownership is
  transferred or a different facade name is selected.
- A GitHub Changesets Action remains a follow-up operational improvement rather
  than a blocker for 0.2.0. Adding publish automation should happen with a
  separate credentials and branch-protection task, not inside the terminal
  release-prep commit.
