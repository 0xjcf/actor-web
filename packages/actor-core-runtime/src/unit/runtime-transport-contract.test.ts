import { describe, expect, it } from 'vitest';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportFrame,
  createRuntimeTransportHandshakeAccept,
  createRuntimeTransportHandshakeHello,
  createRuntimeTransportHeartbeatPing,
  RUNTIME_TRANSPORT_PROTOCOL_VERSION,
  validateRuntimeNodeIdentity,
  validateRuntimeTransportFrame,
  validateRuntimeTransportHandshake,
  validateRuntimeTransportHeartbeatFrame,
} from '../runtime-transport-contract.js';

const fixedNow = () => new Date('2026-04-24T14:00:00.000Z');

function node(nodeAddress: string, overrides: { nodeId?: string; incarnation?: string } = {}) {
  return createRuntimeNodeIdentity({
    nodeAddress,
    nodeId: overrides.nodeId ?? `${nodeAddress}-id`,
    incarnation: overrides.incarnation ?? 'boot-1',
    capabilities: ['runtime-control'],
  });
}

describe('runtime transport contract', () => {
  it('accepts complete node identity and rejects missing identity fields', () => {
    expect(validateRuntimeNodeIdentity(node('node-a'))).toEqual({ ok: true });

    expect(
      validateRuntimeNodeIdentity({
        nodeAddress: 'node-a',
        nodeId: '',
        incarnation: 'boot-1',
        protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
      })
    ).toMatchObject({
      ok: false,
      code: 'missing_identity',
    });
  });

  it('rejects incompatible protocol versions', () => {
    expect(
      validateRuntimeNodeIdentity({
        nodeAddress: 'node-a',
        nodeId: 'node-a-id',
        incarnation: 'boot-1',
        protocolVersion: 'actor-web-runtime/99',
      })
    ).toMatchObject({
      ok: false,
      code: 'incompatible_protocol',
    });
  });

  it('rejects self-connections during handshake', () => {
    const identity = node('node-a');
    const hello = createRuntimeTransportHandshakeHello(identity, fixedNow);

    expect(validateRuntimeTransportHandshake(hello, identity)).toMatchObject({
      ok: false,
      code: 'self_connection',
    });
  });

  it('accepts peer handshakes with matching protocol version', () => {
    const local = node('node-a');
    const remote = node('node-b');
    const hello = createRuntimeTransportHandshakeHello(remote, fixedNow);

    expect(validateRuntimeTransportHandshake(hello, local)).toEqual({ ok: true });
  });

  it('rejects accept handshakes addressed to a different local identity', () => {
    const local = node('node-a');
    const remote = node('node-b');
    const other = node('node-c');
    const accept = createRuntimeTransportHandshakeAccept(remote, other, fixedNow);

    expect(validateRuntimeTransportHandshake(accept, local)).toMatchObject({
      ok: false,
      code: 'malformed_frame',
    });
  });

  it('rejects malformed frame envelopes', () => {
    const local = node('node-a');
    const remote = node('node-b');

    expect(
      validateRuntimeTransportFrame(
        {
          protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
          source: remote,
          destination: local,
          sequence: -1,
          sentAt: '2026-04-24T14:00:00.000Z',
          message: { type: '__runtime.directory.sync.request', requestId: 'sync-1' },
        },
        local
      )
    ).toMatchObject({
      ok: false,
      code: 'malformed_frame',
    });
  });

  it('accepts valid runtime frame envelopes for the local destination', () => {
    const local = node('node-a');
    const remote = node('node-b');
    const frame = createRuntimeTransportFrame({
      source: remote,
      destination: local,
      sequence: 1,
      now: fixedNow,
      message: {
        type: '__runtime.directory.sync.request',
        requestId: 'sync-1',
      },
    });

    expect(validateRuntimeTransportFrame(frame, local)).toEqual({ ok: true });
  });

  it('accepts app-level heartbeat frames for browser transports', () => {
    const local = node('node-a');
    const remote = node('node-b');
    const ping = createRuntimeTransportHeartbeatPing(remote, local, fixedNow);

    expect(validateRuntimeTransportHeartbeatFrame(ping, local)).toEqual({ ok: true });
  });

  it('rejects heartbeat frames addressed to a different local identity', () => {
    const local = node('node-a');
    const remote = node('node-b');
    const other = node('node-c');
    const ping = createRuntimeTransportHeartbeatPing(remote, other, fixedNow);

    expect(validateRuntimeTransportHeartbeatFrame(ping, local)).toMatchObject({
      ok: false,
      code: 'malformed_frame',
    });
  });
});
