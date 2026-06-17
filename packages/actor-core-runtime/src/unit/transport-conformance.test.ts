import { createInMemoryMessageTransportNetwork } from '../testing/in-memory-message-transport.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';

// In-memory transport: synchronous in-process delivery. It preserves send order
// but dispatches listeners without error isolation (see
// in-memory-message-transport.ts deliver()), so safeDispatch is declared false.
// The shared transport core (P2) will own guarded dispatch and flip it to true.
describeTransportConformance({
  name: 'in-memory',
  capabilities: {
    ordering: true,
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
