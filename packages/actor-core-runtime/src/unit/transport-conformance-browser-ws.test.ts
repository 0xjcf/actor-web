import NodeWebSocket from 'ws';
import { createBrowserWebSocketMessageTransport } from '../browser-websocket-message-transport.js';
import { createNodeWebSocketMessageTransport } from '../node-websocket-message-transport.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';

function browserSocket(url: string): WebSocket {
  return new NodeWebSocket(url) as unknown as WebSocket;
}

// Browser WebSocket transport is client-only (it cannot listen), so its
// conformance pair is browser-ws (client, a) <-> node-ws (server, b). The browser
// global WebSocket is supplied via webSocketFactory (the ws package), matching
// browser-websocket-message-transport.test.ts so the suite runs in plain node.
// Heartbeats disabled for timing stability; safeDispatch is false — like every
// transport today it dispatches listeners unguarded, until the transport core (P2).
describeTransportConformance({
  name: 'browser-websocket',
  capabilities: {
    ordering: true,
    safeDispatch: false,
  },
  async createPair() {
    const addrA = 'conformance-browser';
    const addrB = 'conformance-node';

    const b = createNodeWebSocketMessageTransport({
      nodeAddress: addrB,
      incarnation: `${addrB}-boot`,
      heartbeatIntervalMs: 0,
      listen: { port: 0 },
    });
    await b.start();
    const urlB = b.getListeningUrl();
    if (!urlB) {
      throw new Error('browser-ws conformance: node peer failed to start a listener');
    }

    const a = createBrowserWebSocketMessageTransport({
      nodeAddress: addrA,
      incarnation: `${addrA}-boot`,
      heartbeatIntervalMs: 0,
      webSocketFactory: browserSocket,
      peers: { [addrB]: urlB },
    });
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
