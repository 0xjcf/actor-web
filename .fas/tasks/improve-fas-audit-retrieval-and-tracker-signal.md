# Improve FAS Audit Retrieval and Tracker Signal

## Summary

Improve audit-specific memory retrieval and reduce noisy generated tracker rows
so future audits start from workflow evidence instead of generic runtime context.

## Audit Evidence

- `.fas/state/planning.json:32`
- `.fas/state/task-packet.json:24`
- `.fas/state/task-packet.json:25`
- `.fas/state/memory-context.md:1`
- `.fas/TASKS.md:221`
- `.fas/TASKS.md:232`
- `.fas/TASKS.md:243`
- `.fas/TASKS.md:577`

## Scope

- Tune audit retrieval so workflow, prompt, template, state, and closeout memory
  outrank runtime implementation files when those domains are in scope.
- Seed or promote episodic workflow memories covering state drift, tracker drift,
  and Codex orchestration setup findings.
- Update tracker generation so `TASKS.md` favors stable task-specific artifact
  links over mutable `latest` bundles.
- Add validation or snapshot coverage for generated tracker rows.

## Non-Goals

- No broad memory-system redesign.
- No deletion of useful task-specific artifact links.
- No manual cleanup of old tracker rows unless needed for a focused test.

## Acceptance Criteria

- Audit task packets include domain-relevant contextual memory for workflow and
  prompt/template audits.
- Generated tracker rows avoid repetitive mutable latest-artifact bundles.
- The template guidance and generator output agree.
- Focused tests or generated-output fixtures cover the new behavior.

## Suggested Mode

`4-agent`

## Verification

- FAS retrieval or planner tests covering audit task packets
- FAS tracker generation tests or snapshot validation
- `fas validate-task`
