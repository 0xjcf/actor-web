# Architecture Documentation

This directory contains Architecture Decision Records (ADRs) and design documents for the Actor-SPA framework.

## Documents

- `actor-ref-design.md` - ActorRef API design (Agent A)
- `supervision-patterns.md` - Supervision and fault tolerance (Agent A)
- `adr-003-xstate-timeout-patterns.md` - XState timeout and completion patterns (Agent A)
- `observable-architecture.md` - Reactive patterns (Agent B)
- `performance-considerations.md` - Performance design choices (Agent B)

## ADR Template

All architecture decisions should follow this template:

```markdown
# ADR-XXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?

## Alternatives Considered
What other options were evaluated?
```

## Ownership

- Agent A (Tech Lead) owns all ADRs
- All agents can propose ADRs via PR
- Approval requires Agent A review