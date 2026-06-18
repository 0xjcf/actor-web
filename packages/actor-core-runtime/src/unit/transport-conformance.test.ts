import { createInMemoryMessageTransportNetwork } from '../testing/in-memory-message-transport.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';

// In-memory transport: synchronous in-process delivery. It preserves send order.
// safeDispatch is now true: deliver() routes each listener through the shared
// safeDispatchListener (PR 4), so a throwing or async-rejecting subscriber no
// longer escapes or starves siblings.
describeTransportConformance({
  name: 'in-memory',
  capabilities: {
    ordering: true,
    safeDispatch: true,
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
