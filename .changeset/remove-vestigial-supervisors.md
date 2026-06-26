---
'@actor-web/runtime': minor
---

Remove the vestigial standalone `Supervisor`, `BackoffSupervisor`, and `SupervisorTree` classes and their public exports (`Supervisor`, `BackoffSupervisor`, `BackoffStrategy`, `SupervisorOptions`, `BackoffSupervisorOptions`).

These were dead code: never wired into the runtime (their `handleFailure` call was commented out and nothing instantiated them), and their `restartActor` stopped actors without ever restarting them. The supported supervision path is unchanged — `system.spawn(behavior, { supervision: { strategy, maxRestarts, withinMs } })`, backed by `ActorSystemImpl`, which restarts correctly and is covered by `supervision-policy.test.ts`.

BREAKING: if you imported `Supervisor` / `BackoffSupervisor` (or their option types) directly, switch to `system.spawn(..., { supervision })`.
