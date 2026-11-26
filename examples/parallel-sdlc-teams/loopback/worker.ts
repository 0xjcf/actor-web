import type { ActorMessage } from '@actor-web/runtime';
import { serveNode } from '@actor-web/runtime/node';
import type { LookupReceipt, ReceiptLookupReply } from '../check-protocol.js';
import { startMemoryExecutor } from '../memory-executor.js';
import { checkout, profile } from '../scenario.js';
import { address, type CheckPacket, loopbackUrl, peerAuth, type WorkerConfig } from './peer.js';
import { targets, topology } from './topology.js';

export async function startWorker(config: WorkerConfig) {
  const role = config.role;
  const control = address('control');
  const node = await serveNode(topology, {
    node: role,
    peers: { control: loopbackUrl(config.controlUrl) },
    transport: { auth: peerAuth(config.token, new Map([[control, config.controlToken]])) },
    gateway: false,
  });
  const target = targets[role];
  const task = { checkout, profile }[role];
  let slot: Awaited<ReturnType<typeof startMemoryExecutor>> | undefined;
  async function receive(message: ActorMessage) {
    if (message.type !== 'EXECUTE_CHECK' && message.type !== 'LOOKUP_RECEIPT') return;
    const request = message as CheckPacket | LookupReceipt;
    const b = request.binding;
    if (
      b?.taskId !== role ||
      b.taskRevision !== task.revision ||
      b.workspaceId !== target.workspaceId ||
      b.executorId !== target.executorId ||
      b.executorGeneration !== target.executorGeneration ||
      b.checkId !== 'expected-label'
    )
      return;
    let reply: ReceiptLookupReply;
    if (request.type === 'LOOKUP_RECEIPT') {
      reply = slot ? await slot.lookup(request) : { type: 'RECEIPT_UNAVAILABLE', binding: b };
    } else {
      if (request.expectedLabel !== task.expectedLabel || typeof request.label !== 'string') return;
      slot ??= await startMemoryExecutor(
        node.system,
        b,
        task.expectedLabel,
        new TextEncoder().encode(request.label)
      );
      const result = await slot.execute(request);
      // Hold delivery, not execution. A later lookup can read the original receipt.
      if (!result.ok || role === 'checkout') return;
      reply = result.value;
    }
    await node.transport.send(control, reply);
  }
  let mailbox = Promise.resolve();
  const unsubscribe = node.transport.subscribe(({ source, message }) => {
    if (source !== control) return;
    mailbox = mailbox
      .then(() => receive(message))
      .catch(() => console.error('Host could not deliver check response'));
  });
  return {
    stats: () => ({ executions: slot?.executions() ?? 0 }),
    async stop() {
      unsubscribe();
      await mailbox;
      await node.stop();
    },
  };
}
