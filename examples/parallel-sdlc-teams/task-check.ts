import { type ActorTransitionErrorValue, defineBehavior } from '@actor-web/runtime/browser';
import { setup } from 'xstate';
import type { TaskRevision } from './stages.js';

// North-star fixture: one owner for one already-admitted Test attempt (task-check-sequence.svg).
// This is not a gateway API. An adapter must authenticate the executor before delivering a receipt.
export type CheckBinding = Readonly<
  TaskRevision & {
    workspaceId: string;
    attemptId: string;
    checkId: string;
    executorId: string;
    executorGeneration: number;
    candidateDigest: string;
  }
>;

export type HostReceipt = CheckBinding & { passed: boolean };
export type ReceiptEvent = { type: 'HOST_RECEIPT'; receipt: HostReceipt };
type Event =
  | { type: 'DISPATCH_CHECK' } // owner-local, directed to this single-use actor
  | { type: 'RECEIPT_TIMEOUT'; attemptId: string }
  | ReceiptEvent;
type State = 'ready' | 'awaitingReceipt' | 'unknown' | 'reviewReady' | 'checkFailed';
export type TaskCheckReply = { value: State; context: CheckBinding } | ActorTransitionErrorValue;

function matchesBinding(expected: CheckBinding, offered: CheckBinding): boolean {
  return (
    offered?.taskId === expected.taskId &&
    offered.taskRevision === expected.taskRevision &&
    offered.workspaceId === expected.workspaceId &&
    offered.attemptId === expected.attemptId &&
    offered.checkId === expected.checkId &&
    offered.executorId === expected.executorId &&
    offered.executorGeneration === expected.executorGeneration &&
    offered.candidateDigest === expected.candidateDigest
  );
}

// Use the identical evidence rule for timely delivery and for reconciliation after a timeout.
const matchesOutcome =
  (passed: boolean) =>
  ({ context, event: { receipt } }: { context: CheckBinding; event: ReceiptEvent }) =>
    receipt?.passed === passed && matchesBinding(context, receipt);

const settle = [
  { guard: matchesOutcome(true), target: 'reviewReady' },
  { guard: matchesOutcome(false), target: 'checkFailed' },
] as const;

export function taskCheckBehavior(admitted: CheckBinding) {
  const machine = setup({
    types: { context: {} as CheckBinding, events: {} as Event },
  }).createMachine({
    id: 'taskCheck',
    initial: 'ready',
    context: Object.freeze({ ...admitted }),
    states: {
      ready: { on: { DISPATCH_CHECK: 'awaitingReceipt' } },
      awaitingReceipt: {
        on: {
          HOST_RECEIPT: settle,
          RECEIPT_TIMEOUT: {
            guard: ({ context, event }) => event.attemptId === context.attemptId,
            target: 'unknown',
          },
        },
      },
      unknown: { on: { HOST_RECEIPT: settle } },
      reviewReady: {},
      checkFailed: {},
    },
  });
  return defineBehavior<Event>().withMachine(machine).build();
}
