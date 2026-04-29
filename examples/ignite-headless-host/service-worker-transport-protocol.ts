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

export interface ServiceWorkerRuntimeShutdownMessage {
  __actorWebServiceWorkerTransport: true;
  kind: 'shutdown';
  source: string;
}

export type ServiceWorkerTransportEnvelope =
  | ServiceWorkerTransportBindMessage
  | ServiceWorkerTransportBindAckMessage
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
