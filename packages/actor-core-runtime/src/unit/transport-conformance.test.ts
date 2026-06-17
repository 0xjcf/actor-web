import { createInMemoryMessageTransportNetwork } from '../testing/in-memory-message-transport.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';

// In-memory transport: synchronous in-process delivery. It supports ordering but
// has no ack/retry, no heartbeat, no idempotency window, and dispatches listeners
// without error isolation (see in-memory-message-transport.ts deliver()), so
// safeDispatch is declared false here. The shared transport core will flip
// safeDispatch to true once it owns guarded dispatch.
describeTransportConformance({
  name: 'in-memory',
  capabilities: {
    ordering: true,
    idempotency: false,
    ack: false,
    heartbeat: false,
    safeDispatch: false,
  },
  async createPair() {
    const network = createInMemoryMessageTransportNetwork();
    const addrA = 'actor://conformance-a';
    const addrB = 'actor://conformance-b';
    const a = network.createTransport(addrA);
    const b = network.createTransport(addrB);
    await a.connect(addrB);
    return {
      a,
      b,
      addrA,
      addrB,
      async teardown() {
        await a.disconnect(addrB);
      },
    };
  },
});
