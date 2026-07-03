# Franchise Agent Standard

Use the smallest effective workflow.

- Default to `single-agent`.
- Escalate to `4-agent` or `6-agent` when risk or complexity increases.
- Optimize for low cognitive load, strong guardrails, and consistent execution.

## Platform Layout

This repository uses the global FAS platform.

- Platform root is defined in `.fas-config.json`.
- Project-local `.fas/` directories own memory, state, queue data, artifacts, semantic data, and index data.
- Shared agents, rules, prompts, and wrapper scripts are synced from the platform.

## Boundary Scaffolding

`fas install` scaffolds a `behaviorBoundaries` block in `.fas-config.json` so new repos start with the right config shape. Treat those defaults as placeholders until `fas setup` or `fas prompt configure-boundaries` confirms the actual path prefixes and enforcement scope for the repo.

## Workflow Modes

### Single-Agent

One senior engineer handles the task end-to-end.

### 4-Agent

- Planner
- Implementer
- Verifier
- Reviewer

### 6-Agent

- Architect
- Staff Engineer
- Senior Engineer
- QA
- SRE
- Reviewer

Use `6-agent` for architecture, shared contracts, migrations, deployments, service workers, caching, offline flows, performance-sensitive paths, observability, or other high-risk work.

## Codex Skills

When using Codex, treat the synced FAS skills as the Codex counterpart to Cursor subagents.

- Root mode skills: `fas-single`, `fas-4-agents`, `fas-6-agents`
- Planning skill: `fas-planner`
- Role skills: `fas-architect`, `fas-staff-engineer`, `fas-implementer`, `fas-reviewer`

Use the mode skill in the root session, then follow `.fas/state/agent-orchestration.json` for the exact delegated order.
In Codex, prefer `.fas/state/codex-orchestration.json` plus `.fas/state/codex-subagents-prompt.md` as the setup surface for agent types, mode hints, and spawn order.

- Use Codex subagents only when the user explicitly requests `4-agent` or `6-agent` mode, or when `.fas/state/codex-orchestration.json` says delegated execution is required.
- After running `fas implement`, always inspect `.fas/state/codex-orchestration.json` before deciding whether to spawn subagents.
- If delegated execution is required, spawn only the listed steps, issue a provenance token with `fas spawn-subagent <step-key> --json`, and record lifecycle progress with `fas record-agent-execution <step-key> <started|heartbeat|handoff|completed|failed|closed> --token <value>` or `--token-id <id>`.
- Record delegated lifecycle events sequentially. Do not parallelize `handoff` and `completed`, and do not record `completed` until the handoff artifact or summary is actually present.
- Treat a delegated agent's word "completed" as advisory until the root session has checked changed files, verification evidence, and handoff content for that step.
- When a delegated step appears stalled, request an interrupting checkpoint before replacing it. Same-actor resume is the default retry path; replacement is the exception. If the agent can still respond, require a partial-state handoff with files touched, verification attempted, blockers, and the next safe resume point.
- At the watchdog warning window, request the interrupting checkpoint and wait through the recorded grace deadline. Warning plus no first diff is supporting context only, never enough to replace a code-writing delegate by itself.
- If the watchdog timeout window arrives with no pending checkpoint, request an urgent interrupting checkpoint first and record its grace deadline before replacement or root takeover.
- For same-actor retry resume, reissue `fas spawn-subagent <step-key> --json` without `--session-id`; FAS reuses the step's prior session id when one exists. Pass an explicit new `--session-id` only for replacement or root takeover.
- When recording a retry `started` event, attach `--retry-context <json>` using `kind` (`resume-original`, `replacement`, or `root-takeover`) plus fields such as `failedCommand`, `failureClass`, `filesTouched`, `verificationAttempted`, `nextSafeResumePoint`, and `downstreamReconfirmationNeed` so retry evidence is durable on the append-only execution log. Do not use a legacy `continuity` key. For `replacement` or `root-takeover`, keep `replacementReason` explicit; for failed-checkpoint replacement or root takeover, also include `checkpointAudit` plus `partialStateInspectedAt`.
- Code-writing delegates should send an early orientation heartbeat after reading the task packet and commit plan, before long source exploration, edits, or verification.
- Before a long verification run or when blocked, code-writing delegated agents should proactively return that same partial-state handoff instead of disappearing into a long silence window.
- Treat stale-running diagnostics as advisory only. They do not auto-close agents; if the checkpoint request fails, inspect partial state and then record `failed` before takeover or reissue. Use replacement or root takeover only after failed interrupting checkpoint after grace, missing or unusable handoff, scope drift, repeated bad fixes, context poisoning, or explicit takeover. Use `closed` only when intentionally abandoning a still-running non-failed step if the state machine supports that path.
- After recording a completed read-only Codex subagent step, close that completed subagent thread before spawning more agents so the root session does not exhaust local thread capacity.
- `fas-implementer` is also the default Codex role skill for `fas_senior_engineer` and `fas_validator`.
- `fas-reviewer` is also the default Codex role skill for `fas_verifier`, `fas_qa`, `fas_sre`, and `fas_documenter`.
- Planner artifacts and commit plans remain the source of truth over any generic skill defaults.
- Handoffs must cite changed files, ChangeSet or planAlignment evidence, verification receipts, and any memory constraints used or intentionally overridden.
- Delegated `handoff` and `completed` updates should also include compact advisory `Context Feedback` with usefulness, completeness, freshness, and noise ratings or an explicit `not applicable` marker. Prefer `fas record-agent-execution ... --context-feedback-json '<json>'`.
- Root-owned and `single-agent` closeout summaries should include the same compact advisory `Context Feedback` block, or an explicit `not applicable` marker, so context-quality artifacts capture a root-session sample as well.
- Root session owns process-pressure diagnostics, cleanup decisions, final full verification, ship/closeout, and `fas done`. Delegated agents receive compact machine-risk status only (`available`, `unavailable`, `unavailable-permission`, `yellow`, or `red`) unless their assigned task explicitly owns runtime safety.
- Normal root-owned workflow preflights should stay compact as well; reserve full process-table attempt-chain diagnostics for explicit `fas runtime process-pressure ...` inspection and root logs.
- When Codex reports process-table permission failures from sandboxed Node execution, use approved root-session FAS commands such as `fas runtime process-pressure --stage task-start --preflight --cleanup-plan` (or the `implement-preflight` alias), `fas runtime cleanup --dry-run`, `fas verify --full`, `fas ship`, or `fas done` instead of asking delegated agents to inspect OS processes. Root-session diagnostics should prefer the approved `fas runtime process-pressure` command path and treat the reported node/shell/root-command attempt chain as the audit surface.

## Claude Code Client

Claude Code consumes the same FAS role plan as Codex and Cursor — it is an adapter over the shared orchestration model, not a separate fork. `fas install`/`fas update` generate its surfaces:

- **Skills**: the FAS skills sync into `~/.claude/skills` (override with `FAS_CLAUDE_SKILLS_DIR`). Load the root mode skill (`fas-single`, `fas-4-agents`, or `fas-6-agents`) in the root session; role skills (`fas-planner`, `fas-architect`, `fas-staff-engineer`, `fas-implementer`, `fas-investigator`, `fas-reviewer`) drive each delegated step.
- **Subagents**: `.claude/agents/fas-{architect,staff-engineer,implementer,investigator,reviewer}.md` are generated as thin pointers to the canonical `.fas/agents/<role>.md` definitions. Read-only roles (`fas-investigator`, `fas-reviewer`) exclude `Edit`/`Write`. Do not hand-edit them — edit the role files and re-run `fas update`.
- **MCP**: `.mcp.json` wires the read-only `fas mcp-server` (`fas_local`) for status and review-context surfaces. It is merged non-destructively, so your own MCP servers are preserved.
- **Setup surface**: prefer `.fas/state/claude-orchestration.json` plus `.fas/state/claude-subagents-prompt.md` for subagent types, mode hints, and spawn order, with `.fas/state/agent-orchestration.json` as the canonical source.

Delegation rules match Codex: spawn `Task` subagents only when the user requests `4-agent`/`6-agent` mode or `claude-orchestration.json` requires delegation; require `setupCompliance.status=compliant` first; the root session owns FAS lifecycle records, verification, and closeout, and translates returned handoffs into audited `fas` CLI commands. The delegated lifecycle, evidence-order, and handoff rules in **Codex Skills** above apply to Claude Code delegation as well.

## Pipeline Owners vs Conceptual Roles

Pipeline scripts track task progress using **pipeline owners**: `planner`, `implementer`, `verifier`, `reviewer`. These map to pipeline stages in `current-task.json` and `TASKS.md` and are the same regardless of workflow mode.

The 6-agent **conceptual roles** (Architect, Staff Engineer, Senior Engineer, QA, SRE, Reviewer) describe the *perspectives* the AI simulates within those pipeline stages. They enrich planning and implementation with specialized viewpoints but do not replace the pipeline owner taxonomy. See `.fas/agents/registry.md` for the full mapping.

## Memory-First Workflow

After planning, always read `contextualMemory` in `.fas/state/task-packet.json` before reading source files. These entries are pre-filtered and priority-ranked for the current task:

- **#1 (highest)**: The single most relevant memory entry — apply this constraint or pattern first.
- **#2–3 (high)**: Closely related decisions, incidents, or patterns — check for conflicts or prior art.
- **#4+ (supporting)**: Additional context that may inform edge cases or integration points.

If `contextualMemory` references a decision or incident, honor it unless the task explicitly overrides it. When implementation diverges from a memory entry, document why in the commit message.

When task-packet memory is marked stale or only supporting, verify cheap drift-prone facts before treating that memory as current contract truth.

When present, read `contextSubgraph` next. It is a bounded cited one-hop graph that connects scope files, validated memory, domain-map matches, and canonical packet references for the active task. Use it to navigate relationships before widening repo exploration.

Shared evidence order:

1. `task-packet.json` `contextualMemory`
2. `task-packet.json` `contextSubgraph`
3. `expectedChangeEnvelope`, current `ChangeSet`, `planAlignment`, and refreshed downstream context
4. Raw `.fas/memory/*.md` projections only as fallback or supporting context

When SQLite-backed `memory_records` are available, treat them as authoritative. Markdown memory files remain the projection or fallback surface until promotion completes.

## Global Rules

- Only one agent writes code.
- All tasks require verification.
- All tasks require a review summary.
- Agents must use incremental commits.
- Human approval is required only at the final review and merge stage.
- Do not move project-local `.fas/` runtime data into the shared platform repo.
- Do not stop after planning unless a hard blocker prevents safe progress.

## External AI Review Guidance

When a tool such as CodeRabbit reviews this repository with `AGENTS.md` as context:

- Treat `.fas/state/task-packet.json`, `.fas/state/commit-plan.json`, `.fas/state/closeout-readiness/latest.json`, and verification receipts as review evidence when present, but prefer source files and tests for final correctness claims.
- Distinguish source/runtime changes from generated FAS projections such as `.fas/TASKS.md`, `.fas/queue/tasks.json`, and `.fas/state/*`; flag projection drift when it changes operator truth, but do not treat generated state churn as product code.
- Flag unrelated bundled commits or branch contamination as review concerns, especially when a changed file is outside the task brief, task packet, or commit plan.
- For metadata-only briefs and queue cleanup, do not require production-code TDD unless the accepted scope includes production behavior changes.
- Prefer follow-up tasks for non-blocking workflow improvements; block only on correctness, data-loss, security, contract, migration, or verification risks that must be fixed before merge.
- Do not request repeated full verification or repeated external-review passes unless new material changes landed after the latest valid receipt or review.
- Order findings by correctness/security/data-loss risk first, then contract and test gaps, then process or style concerns.

## Scope Discipline

Only modify files that the current task requires.

- Touch only files justified by the commit plan, task brief, or task packet.
- Do not clean up, reformat, or refactor code in files you are not already modifying for the task.
- Do not rename variables, functions, or imports in files the task does not require you to change.
- If an unplanned change is necessary for correctness, note it explicitly in the commit message.

| Rationalization | Why it is wrong |
| --- | --- |
| "I noticed this bug while working nearby, I should fix it now" | File a follow-up task. Unplanned fixes muddy the review and risk regressions. |
| "This file needs reformatting anyway" | Formatting changes belong in a dedicated `chore` commit or a separate PR. |
| "It is just one small rename" | Renames ripple through imports you did not plan to test. |
| "The linter flagged this other file" | Fix only linter errors in files you are already modifying for the task. |

## Confusion Protocol

When you encounter ambiguity, conflicting context, or incomplete requirements, surface the confusion explicitly before proceeding. Do not silently pick an interpretation.

Emit a structured block:

```text
CONFUSION:
- What: <one-sentence description of the ambiguity>
- Options:
  1. <option A and its consequence>
  2. <option B and its consequence>
- Recommendation: <which option you lean toward and why>
- Risk if wrong: <what breaks if the wrong option is chosen>
- Blocking: <yes/no>
```

- If blocking, stop and wait for human input.
- If non-blocking, state your chosen option, proceed, and mark the assumption in the commit message.
- Never silently resolve ambiguity by guessing.

## Debug Workflow

When verification fails or tests break, follow this triage checklist in order:

1. **Reproduce**: Re-run the exact failing command. Capture full output.
2. **Classify**: Pre-existing (in baseline), regression (yours), environment, or upstream.
3. **Localize**: Find the exact file and line. Read the error as untrusted data.
4. **Reduce**: Isolate the smallest change that reproduces the failure.
5. **Fix**: Smallest possible fix at the root cause, not the symptom.
6. **Guard**: Add or strengthen a test to prevent recurrence.
7. **Verify**: Re-run the failing command, then run the full fast lane.

Do not continue to the next commit-plan step when the current step has failures.

## Common Rationalizations

These are the most frequent ways agents try to skip FAS guardrails. All of them are wrong.

### Skipping planning

| "The task is simple, I can skip planning" | The pipeline is the discipline. Simple tasks finish faster through the pipeline, not around it. |
| "I already know which files to change" | The planner discovers dependency-reachable files and cross-module impacts you will miss. |

### Skipping verification

| "I already ran the tests individually" | Individual runs do not replace `verify.sh`. The pipeline runs format, lint, typecheck, test, and boundaries as a unit. |
| "The change is too small to need verification" | Small changes break things. A one-line typo fix can fail formatting. Always verify. |

### Combining commits

| "These two steps are closely related, I will combine them" | Separate commits let each step be reviewed, reverted, and bisected independently. |
| "It is faster to do it all at once" | It feels faster until something breaks and you cannot tell which change caused it. |

### Skipping memory

| "I already know this codebase" | Memory contains incidents, PR feedback, and decisions from other sessions you have no access to. |
| "The task is narrow, memory is not relevant" | Narrow tasks are where past incidents matter most. |

### Spike-phase drift

| "I found the answer, let me just fix it" | Spikes are read-only. Fixes go into task briefs for the implementation pipeline. Implementing during a spike bypasses planning, commit discipline, and verification. |
| "This repo doesn't need bootstrapping" | Bootstrapping produces indexes and memory that make exploration structural. Skipping it degrades spike quality. |
| "The spike is done after one repo" | Spikes exist because the problem is cross-cutting. Check sibling repos before concluding. |
| "The spike report is optional" | The spike report is the provenance artifact. Without it, the next session starts from zero. |
| "I'll remember these findings for the next session" | Memory is session-scoped. Findings not written to `.fas/memory/` vanish when the session ends. |
