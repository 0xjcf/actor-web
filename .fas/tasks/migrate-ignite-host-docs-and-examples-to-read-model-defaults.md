# Migrate Ignite host docs and examples to read-model defaults

## Source

Created with `fas create-task` on 2026-05-14.

## Problem

Follow-up from Separate Ignite read-model sources from command surfaces: docs/examples/ignite-element-host.md and examples/ignite-headless-host/logistics-browser-client.ts still teach legacy command-capable createActorWebClient/source paths as the normal Ignite host surface, which blurs the new projection-only read-model default.

## Acceptance criteria

- Compatibility aliases are documented as legacy or command-capable so downstream migration ergonomics are clear.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Rewrite the Ignite host example docs around projection-first browser surfaces:
  `topology.actors.*.readModel(...)` and `createActorWebReadModelClient(...)`
  become the default examples.
- Keep host command/control on the Ignite command API so components render from
  read-model sources and send writes through `commands: ({ actor, command }) =>
  ...`.
- Where the current `ignite-element/actor-web` adapter still requires a
  command-capable Actor-Web source handle, keep that source local to the host
  bridge instead of injecting standalone command-helper objects.
- Document `createActorWebClient(...)` plus legacy `.source(...)` paths as
  compatibility-only migration surfaces rather than default host wiring.
- Update the named logistics browser example so its exported host wiring matches
  the documented split instead of teaching command-capable clients as the
  default UI surface.

## Alternatives considered

- Leave the docs unchanged and rely on API docs elsewhere.
  Rejected because the example host doc is a primary migration surface and was
  still teaching the old default.
- Remove legacy helpers from the examples entirely.
  Rejected because downstream migration ergonomics still need an explicit
  compatibility path.

## Affected files

- `docs/examples/ignite-element-host.md`
- `examples/ignite-headless-host/logistics-browser-client.ts`
- `examples/ignite-headless-host/ignite-headless-host-element.tsx`
- `examples/ignite-headless-host/provider-console.tsx`
- `examples/ignite-headless-host/logistics-runtime-status-panel.tsx`
- `examples/fas-agent-loop/fas-dashboard.ts`
- This queued task brief for implementation/verification provenance

## Scope Amendments

- Expanded during implementation to fix the repo-local `ignite-element/actor-web`
  typing blockers uncovered by `pnpm typecheck` after the logistics host
  command-path correction. The added files stay inside the same example/doc
  surface and do not widen into unrelated runtime packages.

## Implementation plan

- Update `docs/examples/ignite-element-host.md` so read-model sources and
  `createActorWebReadModelClient(...)` are the default browser/Ignite examples.
- Update `examples/ignite-headless-host/logistics-browser-client.ts` to keep the
  host bridge on a command-capable Actor-Web source where the current
  `ignite-element/actor-web` adapter requires `actor.send(...)`, while removing
  standalone command-helper exports.
- Adjust the host components in `examples/ignite-headless-host/` only as needed
  to consume the new read-model default while keeping writes on Ignite-owned
  `actor.send(...)` command definitions.
- Narrowly fix the `examples/fas-agent-loop/fas-dashboard.ts` and
  `examples/ignite-headless-host/logistics-runtime-status-panel.tsx` typing
  seams so `pnpm typecheck` reflects the corrected local Ignite adapter
  contracts.

## Verification plan

- Run targeted diff inspection on the changed doc/example files to confirm the
  example now teaches read-model defaults and marks command-capable helpers as
  legacy or opt-in.
- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- If the example host still depends on command-capable sources in component
  wiring outside Ignite command definitions, the migration could still teach the
  wrong host pattern. Keep the example wiring aligned with the local
  `ignite-element/actor-web` command API.

## Dependencies

- No blocking external dependencies identified. This task follows the completed
  source-splitting work and existing API docs that already document
  `createActorWebReadModelClient(...)` as the default.

## Open questions

- None at implementation start. If additional example files beyond the named
  host wiring need edits for correctness, keep the scope limited to those local
  host consumers and call that out in handoff evidence.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
