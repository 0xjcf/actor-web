---
title: "@actor-web/testing"
description: State-machine analysis helpers for machine-based actors.
---

# `@actor-web/testing`

Structural test helpers for the XState machines that drive machine-based actors —
catch unreachable states and report transition coverage.

```bash
pnpm add -D @actor-web/testing
```

## `analyzeStateMachine(machine)`

```ts
analyzeStateMachine(machine: AnyStateMachine): StateAnalysisResult
```

Static analysis: total states, reachable states, and the unreachable ones.

## `analyzeStateMachineWithGraph(machine)`

```ts
analyzeStateMachineWithGraph(machine: AnyStateMachine): Promise<StateAnalysisResult>
```

Graph-based analysis (via `@xstate/graph`) for more precise reachability. Async.

## `assertNoUnreachableStates(machine, machineName?)`

```ts
assertNoUnreachableStates(machine: AnyStateMachine, machineName?: string): void
```

Throws if the machine has unreachable states — a one-line guard in a unit test.

## `generateCoverageReport(machine, machineName?)`

```ts
generateCoverageReport(machine: AnyStateMachine, machineName?: string): string
```

Returns a human-readable reachability/coverage report.

## `StateAnalysisResult`

```ts
interface StateAnalysisResult {
  totalStates: number;
  reachableStates: number;
  unreachableStates: string[];
}
```

## See also

- [State & machines](/concepts/state-and-machines)
