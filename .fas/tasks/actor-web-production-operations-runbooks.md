# Actor-Web production operations runbooks

## Source

Created with `fas create-task --queue` on 2026-04-30 from the remaining work
in `docs/actor-web-multi-process-deployment-demo-design.md`.

## Roadmap Position

1. Logistics runtime topology and status panel
2. Logistics provider runtime and container split
3. Runtime durable gateway replay storage
4. Runtime restart-persistent idempotency
5. Production discovery and secure deployment adapters
6. Logistics multi-machine deployment prove-out
7. Actor-Web production operations runbooks

## Problem

The roadmap repeatedly marks the Docker Compose demo as non-production and
names rollback guidance, TLS/secret rotation, deployment troubleshooting, and
operator runbooks as remaining hardening work. Once the production-facing
runtime seams and multi-machine proof exist, Actor-Web needs durable docs that
tell operators what is supported, what is diagnostic-only, and what remains
their deployment responsibility.

## Mode

- Workflow: 4-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: contained

## Scope

- Add production operations runbooks for the direct WebSocket transport
  deployment path.
- Cover deployment, rollback, TLS/secret rotation expectations, runtime status
  diagnosis, telemetry inspection, stale peer triage, replay recovery, and
  backpressure incidents.
- Link the runbooks to runtime APIs, logistics commands, Docker verification,
  and Stage 3 multi-machine artifacts.
- Distinguish demo deployment artifacts from production reference guidance.
- Add small diagnostic implementation work only if a missing diagnostic blocks
  useful runbook guidance.

## Non-Goals

- No broker-backed transport runbook unless the runtime supports it by then.
- No cloud-provider-specific operations guide.
- No semantic runtime changes unless a diagnostic gap is explicitly planned.

## Acceptance Criteria

- Operators can diagnose worker disconnects, stale peers, rejected peers,
  replay recovery, duplicate drops, and backpressure signals from documented
  surfaces.
- The runbooks clearly separate demo Compose commands, Stage 3 proof commands,
  and production deployment responsibilities.
- Rollback and secret rotation expectations are explicit.
- The docs link to the exact APIs and commands used by the logistics roadmap.
- Docs validation and FAS verification pass.

## Implementation Plan

1. Inventory current API docs, deployment design docs, and Stage 3 artifacts.
2. Draft production operations runbooks with command-level procedures.
3. Add cross-links from `docs/API.md` and deployment design docs where useful.
4. Identify any blocking diagnostic gaps and either file follow-up tasks or
   implement the smallest necessary diagnostic.
5. Validate markdown and FAS workflow checks.

## Verification

- Markdown/docs checks available in the repo
- `pnpm lint`
- `fas verify`
- `pnpm typecheck` if docs import examples or TypeScript snippets are checked

## Dependencies

- Production discovery and secure deployment adapters.
- Logistics multi-machine deployment prove-out.

## Risks

- Writing production docs before the seams land would turn target state into
  misleading current state. Keep the runbooks explicit about implemented
  guarantees versus deployment responsibilities.

## Open Questions

- Should runbooks live in a new `docs/operations/` directory or alongside the
  deployment design docs?
