import { type ActorSystem, defineBehavior } from '@actor-web/runtime/browser';
import {
  type ExecuteCheck,
  type LookupReceipt,
  matchesCandidateBytes,
  type ReceiptLookupReply,
} from './check-protocol.js';
import { expectOk, ok, type Result, refuse } from './definitions.js';
import {
  type CheckBinding,
  type HostReceipt,
  matchesBinding,
  type ReceiptEvent,
} from './task-check.js';

type Command = ExecuteCheck | LookupReceipt;
type Store = { executions: number; receipt: HostReceipt | null };
const found = (receipt: HostReceipt): ReceiptEvent => ({
  type: 'HOST_RECEIPT',
  receipt: { ...receipt },
});

// One trusted in-memory host slot for one admitted binding. Neither the incoming
// request nor its trace can replace the approved check, expected label or bytes.
export async function startMemoryExecutor(
  system: ActorSystem,
  admitted: CheckBinding,
  expectedLabel: string,
  candidateBytes: Uint8Array
) {
  const binding = { ...admitted };
  const bytes = Uint8Array.from(candidateBytes);
  const verified = await matchesCandidateBytes(binding, bytes);
  const expected = new TextEncoder().encode(expectedLabel);
  const behavior = defineBehavior<Command>()
    .withContext<Store>({ executions: 0, receipt: null })
    .onMessage(({ context, message }) => {
      if (message.type === 'LOOKUP_RECEIPT') {
        const reply: ReceiptLookupReply =
          matchesBinding(binding, message.binding) && context.receipt
            ? found(context.receipt)
            : { type: 'RECEIPT_UNAVAILABLE', binding: { ...message.binding } };
        return { reply: ok(reply) };
      }
      if (
        message.type !== 'EXECUTE_CHECK' ||
        !matchesBinding(binding, message.binding) ||
        binding.checkId !== 'expected-label' ||
        message.expectedLabel !== expectedLabel
      ) {
        return { reply: refuse('CHECK_NOT_ADMITTED') };
      }
      if (!verified) return { reply: refuse('CANDIDATE_DIGEST_MISMATCH') };
      if (context.receipt) return { reply: ok(found(context.receipt)) };
      const passed =
        bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
      const receipt = { ...binding, passed };
      return {
        context: { executions: context.executions + 1, receipt },
        reply: ok(found(receipt)),
      };
    });
  const ref = await system.spawn<Command, unknown, Store>(behavior, {
    id: `executor-${binding.executorId}-${binding.attemptId}`,
    supervision: { strategy: 'stop' },
  });
  return {
    execute: (request: ExecuteCheck) => ref.ask<Result<ReceiptEvent>>(request),
    lookup: async (request: LookupReceipt) =>
      expectOk(await ref.ask<Result<ReceiptLookupReply>>(request)),
    executions: () => ref.getSnapshot().context.executions,
  };
}
