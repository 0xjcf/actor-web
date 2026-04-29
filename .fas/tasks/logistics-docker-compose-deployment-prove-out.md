# Logistics Docker Compose deployment prove-out

## Summary

Prove the logistics Actor-Web topology can be packaged as separate container
roles after the localhost multi-process proof and telemetry export slices. This
slice keeps runtime semantics unchanged and focuses on deployment wiring,
browser-facing URLs, telemetry files, and an operator runbook.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Add Docker build support for the logistics demo using the existing workspace
  source tree.
- Add a Compose topology with server runtime, worker runtime, and browser host
  services.
- Add container-friendly scripts for the Vite browser host.
- Wire JSONL transport telemetry paths through server and worker process
  entrypoints.
- Add a smoke verification script for the Compose topology.
- Update docs with gateway vs transport ports, host URLs, Docker service DNS,
  and troubleshooting guidance.

## Non-Goals

- No new runtime transport semantics.
- No production image optimization.
- No external registry/discovery service.
- No OpenTelemetry backend.

## Verification

- `pnpm test:examples`
- `pnpm test:runtime`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
