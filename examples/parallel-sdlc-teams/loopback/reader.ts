import { createGatewayReadModelSource } from '@actor-web/runtime/browser';
import { type Lane, views } from './topology.js';

export function observeLane(url: string, token: string, lane: Lane) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1')
    throw new Error('Only a loopback gateway is supported');
  return createGatewayReadModelSource(views.actors[lane], { gateway: { url, auth: { token } } });
}
