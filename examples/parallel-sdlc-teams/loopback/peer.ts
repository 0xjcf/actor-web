import type { RuntimeTransportAuthProvider } from '@actor-web/runtime/node';
import type { ExecuteCheck } from '../check-protocol.js';
import { type Lane, topology } from './topology.js';

// The verified node address comes from the WebSocket handshake, not an actor envelope.
export function peerAuth(
  token: string,
  peers: ReadonlyMap<string, string>
): RuntimeTransportAuthProvider {
  if (!token || [...peers.values()].some((key) => !key)) throw new Error('Missing peer credential');
  return {
    token,
    verifyToken(input) {
      const source = 'source' in input && input.source;
      return (
        !!source &&
        typeof source === 'object' &&
        'nodeAddress' in source &&
        typeof source.nodeAddress === 'string' &&
        !!input.token &&
        peers.get(source.nodeAddress) === input.token
      );
    },
  };
}

export type CheckPacket = ExecuteCheck & { label: string };
export type ControlConfig = {
  // Fixture-only cut after committing the decision, before handing it to the team.
  deferReview?: Lane;
  ports?: { transport: number; gateway: number };
  directory: string;
  role: 'control';
  token: string;
  peers: Record<Lane, string>;
  viewers: Record<Lane, string>;
};
export type WorkerConfig = {
  // Fixture-only cut after checking the bytes, before storing an outcome.
  deferReceipt?: boolean;
  directory: string;
  role: Lane;
  token: string;
  controlToken: string;
  controlUrl: string;
};
export const address = (role: Lane | 'control') => topology.nodes[role].address;

export function loopbackUrl(text: string) {
  const url = new URL(text);
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password
  )
    throw new Error('Expected a loopback WebSocket URL');
  return url.href;
}
