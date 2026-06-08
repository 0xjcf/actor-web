# @actor-web/testing

Testing utilities for [Actor-Web](../actor-core-runtime) applications.

Actor-Web behaviors can be driven by XState machines (`defineActor().withMachine(...)`).
This package helps you test those machines structurally — finding unreachable
states and reporting transition coverage — so a state can't silently become dead
code.

## Install

```bash
pnpm add -D @actor-web/testing
```

## API

### `analyzeStateMachine(machine): StateAnalysisResult`

Statically analyze a machine and return how many states it defines, how many are
reachable, and which (if any) are unreachable.

```ts
import { analyzeStateMachine } from '@actor-web/testing';

const result = analyzeStateMachine(compareMachine);
// result.totalStates, result.reachableStates, result.unreachableStates
```

### `analyzeStateMachineWithGraph(machine): Promise<StateAnalysisResult>`

A deeper, graph-based analysis (via `@xstate/graph`) that explores transitions to
compute reachability more precisely. Async.

### `assertNoUnreachableStates(machine, machineName?): void`

Test assertion — throws if the machine has any unreachable states. Drop it into a
unit test to guard a machine against dead states:

```ts
import { assertNoUnreachableStates } from '@actor-web/testing';

it('has no unreachable states', () => {
  assertNoUnreachableStates(compareMachine, 'compare');
});
```

### `generateCoverageReport(machine, machineName?): string`

Return a human-readable coverage report (reachable / total states, percentage,
and the unreachable list) for logging or snapshotting.

### `StateAnalysisResult`

```ts
interface StateAnalysisResult {
  totalStates: number;
  reachableStates: number;
  unreachableStates: string[];
  // ...
}
```

## See also

- [Actor-Web docs — Testing actors](https://github.com/0xjcf/actor-web)
- [`@actor-web/runtime`](../actor-core-runtime)
