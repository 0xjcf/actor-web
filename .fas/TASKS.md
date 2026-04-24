# Task Tracker

## Active Tasks

### Task: Runtime gateway and Ignite bridge closeout

- Title: Runtime gateway and Ignite bridge closeout
- Mode: single-agent
- Status: done
- Owner: reviewer
- Brief: .fas/tasks/runtime-gateway-ignite-bridge-closeout.md
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: contained
- Artifacts: brief=.fas/tasks/runtime-gateway-ignite-bridge-closeout.md; verification=.fas/state/verification/latest.json

### Task: Runtime transport handshake and wire contract

- Title: Runtime transport handshake and wire contract
- Mode: 6-agent
- Status: done
- Owner: reviewer
- Brief: .fas/tasks/runtime-transport-handshake-wire-contract.md
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting
- Artifacts: brief=.fas/tasks/runtime-transport-handshake-wire-contract.md; verification=.fas/state/verification/latest.json

### Task: Node WebSocket transport prove-out

- Title: Node WebSocket transport prove-out
- Mode: 6-agent
- Status: review
- Owner: reviewer
- Brief: .fas/tasks/node-websocket-transport-prove-out.md
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting
- Artifacts: brief=.fas/tasks/node-websocket-transport-prove-out.md; verification=.fas/state/verification/latest.json

## Template

### Task: <short task title>

- Title: <short task title>
- Mode: <single-agent | 4-agent | 6-agent>
- Status: <backlog | debug | code-review | planning | commit-planning | implementing | validation | closeout | verifying | review | architecture-review | blocked | done>
- Owner: <role>
- Brief: .fas/tasks/<slug>.md (optional — omit if no brief exists)
- Automation mode: <manual | advisory | autonomous> (optional — omit if not applicable)
- Verification lane: <fast | full | pending-planner> (optional — omit if unknown)
- Policy sensitivity: <standard | approval-required | ownership-advisory | blocked | deferred> (optional — omit if unknown)
- Blast radius: <local | contained | cross-cutting> (optional — omit if unknown)
- Artifacts: brief=.fas/tasks/<slug>.md; planning=.fas/state/planning.json; taskPacket=.fas/state/task-packet.json; commitPlan=.fas/state/commit-plan.json; verification=.fas/state/verification/latest.json; review=.fas/state/boundary-review-findings.md; workflow=.fas/state/workflows (optional — omit if unknown)
