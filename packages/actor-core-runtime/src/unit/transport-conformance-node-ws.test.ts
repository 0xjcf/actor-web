import { createNodeWebSocketMessageTransport } from '../node-websocket-message-transport.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';

// Node WebSocket transport over a localhost loopback pair (ephemeral ports). It
// preserves send order. Heartbeats are disabled here so the universal cases stay
// timing-stable; heartbeat/ack/idempotency are internal reliability behaviors
// covered by node-websocket-message-transport.test.ts (white-box), not the
// black-box conformance suite. safeDispatch is now true: the node transport routes
// dispatch through TransportCore's safeDispatchListener (PR 2), so a throwing or
// rejecting subscriber no longer escapes or starves siblings.
describeTransportConformance({
  name: 'node-websocket',
  capabilities: {
    ordering: true,
    safeDispatch: true,
  },
  async createPair() {
    const addrA = 'conformance-a';
    const addrB = 'conformance-b';

    const b = createNodeWebSocketMessageTransport({
      nodeAddress: addrB,
      incarnation: `${addrB}-boot`,
      heartbeatIntervalMs: 0,
      listen: { port: 0 },
    });
    await b.start();
    const urlB = b.getListeningUrl();
    if (!urlB) {
      throw new Error('node-ws conformance: peer transport failed to start a listener');
    }

    const a = createNodeWebSocketMessageTransport({
      nodeAddress: addrA,
      incarnation: `${addrA}-boot`,
      heartbeatIntervalMs: 0,
      listen: { port: 0 },
      peers: { [addrB]: urlB },
    });
    await a.start();
    await a.connect(addrB);

    return {
      a,
      b,
      addrA,
      addrB,
      async teardown() {
        await Promise.allSettled([a.stop(), b.stop()]);
      },
    };
  },
});
