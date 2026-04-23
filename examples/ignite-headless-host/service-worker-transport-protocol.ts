import type { ActorMessage } from '@actor-core/runtime/browser';

export interface ServiceWorkerTransportBindMessage {
  __actorWebServiceWorkerTransport: true;
  kind: 'bind';
  source: string;
}

export interface ServiceWorkerTransportBindAckMessage {
  __actorWebServiceWorkerTransport: true;
  kind: 'bind-ack';
  source: string;
}

export interface ServiceWorkerTransportConnectMessage {
  __actorWebServiceWorkerTransport: true;
  kind: 'connect';
  source: string;
  destination: string;
}

export interface ServiceWorkerTransportDisconnectMessage {
  __actorWebServiceWorkerTransport: true;
  kind: 'disconnect';
  source: string;
  destination: string;
}

export interface ServiceWorkerTransportFrameMessage {
  __actorWebServiceWorkerTransport: true;
  kind: 'frame';
  source: string;
  destination: string;
  message: ActorMessage;
}

export interface ServiceWorkerRuntimeShutdownMessage {
  __actorWebServiceWorkerTransport: true;
  kind: 'shutdown';
  source: string;
}

export type ServiceWorkerTransportEnvelope =
  | ServiceWorkerTransportBindMessage
  | ServiceWorkerTransportBindAckMessage
  | ServiceWorkerTransportConnectMessage
  | ServiceWorkerTransportDisconnectMessage
  | ServiceWorkerTransportFrameMessage
  | ServiceWorkerRuntimeShutdownMessage;

export function isServiceWorkerTransportEnvelope(
  value: unknown
): value is ServiceWorkerTransportEnvelope {
  return (
    value !== null &&
    typeof value === 'object' &&
    '__actorWebServiceWorkerTransport' in value &&
    (value as { __actorWebServiceWorkerTransport?: boolean }).__actorWebServiceWorkerTransport ===
      true &&
    'kind' in value
  );
}
