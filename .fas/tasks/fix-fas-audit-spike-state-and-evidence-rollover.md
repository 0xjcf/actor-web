# Fix FAS Audit Spike State and Evidence Rollover

## Summary

Fix the FAS workflow surfaces that left the active audit spike split between
pipeline stages and wired to prior-task evidence.

## Audit Evidence

- `.fas/state/current-task.json:2`
- `.fas/state/current-task.json:17`
- `.fas/state/planning.json:2`
- `.fas/state/task-bootstrap.md:3`
- `.fas/TASKS.md:559`
- `.fas/WORKFLOW.md:30`
- `.fas/state/downstream-context/latest.json:3`
- `.fas/state/closeout-readiness/latest.json:3`
- `.fas/state/review-summary.md:4`

## Scope

- Fix the owning FAS platform or synced template path that advances spike tasks.
- Keep `current-task.json`, `TASKS.md`, planning, and bootstrap surfaces aligned
  during spike transitions.
- Rotate or namespace evidence pointers on new task start.
- Avoid pointing active tasks at missing review artifacts.
- Add regression coverage for spike task state and evidence rollover.

## Non-Goals

- No hand-edit-only repair of generated Actor-Web state as the final fix.
- No unrelated queue scheduler or monitor refactor.
- No source runtime changes in Actor-Web unless required for test fixtures.

## Acceptance Criteria

- A new spike cannot show `commit-planning` in one active surface and `planning`
  in another.
- Active task artifact pointers resolve to the active task or are explicitly
  absent until generated.
- Prior-task verification and closeout receipts are not presented as new-task
  proof.
- Regression tests or FAS verification receipts cover the state transition path.

## Suggested Mode

`6-agent`

## Verification

- FAS platform tests for spike transition and evidence rollover
- Actor-Web `fas validate-task` after sync, if the fix lands through synced FAS
  content
- `fas verify` or the platform-required verification lane
